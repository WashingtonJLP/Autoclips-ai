import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { parse } from './contracts';
import { productionOptions } from './production';
import type { Pipeline } from './pipeline';
import { Candidate, hash } from './connectors';

export const searchConfig = z
  .object({
    platforms: z
      .array(z.enum(['youtube', 'twitch', 'commons', 'manifest', 'rss']))
      .min(1)
      .max(5),
    keywords: z.string().trim().min(1).max(200),
    channel: z.string().min(1).max(2000).optional(),
    categories: z.array(z.string().max(80)).max(10).default([]),
    languages: z.array(z.string().max(10)).max(5).default([]),
    minDuration: z.number().min(0).max(7200).default(0),
    maxDuration: z.number().min(1).max(7200).default(7200),
    maxVideos: z.number().int().min(1).max(10).default(5),
    recentDays: z.number().int().min(1).max(365).optional(),
    autoProcess: z.boolean().default(false),
    catalogRightsConfirmed: z.boolean().default(false),
    sourceId: z.string().optional(),
    licenses: z
      .array(z.enum(['CC0', 'CC-BY-4.0', 'PERMISSION']))
      .min(1)
      .default(['CC0', 'CC-BY-4.0', 'PERMISSION']),
    options: productionOptions.default({
      maxClips: 3,
      minDuration: 5,
      maxDuration: 60,
      language: 'auto',
    }),
  })
  .strict()
  .refine(
    (v) => v.minDuration <= v.maxDuration,
    'Intervalo de duração inválido',
  );
export const automationSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    kind: z.enum(['source', 'topic']),
    enabled: z.boolean().default(true),
    intervalMinutes: z.number().int().min(60).max(43200).default(360),
    config: searchConfig,
  })
  .strict();
export class Automations {
  constructor(private readonly p: Pipeline) {}
  async schedule(item: {
    id: string;
    enabled: boolean;
    intervalMinutes: number;
  }) {
    if (!item.enabled) {
      await this.p.queue.removeJobScheduler(`search-${item.id}`);
      return;
    }
    await this.p.queue.upsertJobScheduler(
      `search-${item.id}`,
      { every: item.intervalMinutes * 60000 },
      {
        name: 'discovery-run',
        data: { automationId: item.id },
        opts: { attempts: 1 },
      },
    );
  }
  async create(body: unknown) {
    const data = parse(automationSchema, body);
    if ((await this.p.db.automation.count()) >= 50)
      throw new BadRequestException(
        'Limite de 50 monitoramentos; reutilize ou pause configurações existentes',
      );
    const item = await this.p.db.automation.create({
      data: { ...data, config: data.config as Prisma.InputJsonValue },
    });
    await this.schedule(item);
    return item;
  }
  async toggle(id: string, body: unknown) {
    const { enabled } = parse(
      z.object({ enabled: z.boolean() }).strict(),
      body,
    );
    const item = await this.p.db.automation.update({
      where: { id },
      data: { enabled },
    });
    await this.schedule(item);
    return item;
  }
  async search(body: unknown) {
    const config = parse(searchConfig, body);
    const found = [];
    const errors: string[] = [];
    for (const platform of [...new Set(config.platforms)]) {
      try {
        const redis = await this.p.queue.getBackend().client;
        const query = [config.keywords, ...config.categories].join(' ');
        const cacheKey = `discovery-cache:${hash([platform, query, config.maxVideos, config.channel ?? null])}`;
        const cached = await redis.get(cacheKey);
        let candidates: Candidate[];
        if (cached) candidates = JSON.parse(cached);
        else {
          const dayKey = `discovery-quota:${platform}:${new Date().toISOString().slice(0, 10)}`;
          redis.defineCommand('autoclipsSearchQuota', {
            numberOfKeys: 1,
            lua: "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], 172800) end; return n",
          });
          const count = Number(
            await redis.runCommand('autoclipsSearchQuota', [dayKey]),
          );
          if (count > 50)
            throw new BadRequestException(
              'Limite diário de 50 buscas desta plataforma atingido',
            );
          candidates = await this.p.production.connectors.search(
            platform,
            query,
            config.maxVideos,
            config.channel,
          );
          await redis.set(cacheKey, JSON.stringify(candidates), { EX: 900 });
        }
        for (const item of candidates) {
          if (found.length >= config.maxVideos) break;
          // Metadados ausentes não satisfazem filtros restritivos.
          if (
            (config.minDuration > 0 || config.maxDuration < 7200) &&
            (item.duration === undefined ||
              item.duration < config.minDuration ||
              item.duration > config.maxDuration)
          )
            continue;
          if (
            config.languages.length &&
            !config.languages.some((l) =>
              item.language?.toLowerCase().startsWith(l.toLowerCase()),
            )
          )
            continue;
          if (
            config.recentDays &&
            (!item.publishedAt ||
              Date.parse(item.publishedAt) <
                Date.now() - config.recentDays * 86400000)
          )
            continue;
          found.push(await this.p.production.remember(item));
        }
      } catch (error) {
        errors.push(
          `${platform}: ${error instanceof Error ? error.message : 'Falha na busca'}`,
        );
      }
    }
    return { items: found, errors };
  }
  async run(id: string) {
    const item = await this.p.db.automation.findUniqueOrThrow({
      where: { id },
    });
    if (!item.enabled) return { paused: true };
    const config = parse(searchConfig, item.config);
    const run = await this.p.db.searchRun.create({
      data: { automationId: id },
    });
    try {
      const result = await this.search(config);
      let processed = 0;
      for (const asset of result.items) {
        if (
          config.autoProcess &&
          config.catalogRightsConfirmed &&
          asset.accessible &&
          !asset.rightsConfirmed
        ) {
          const catalog = (asset.metadata as Record<string, unknown>).catalog;
          if (catalog && typeof catalog === 'object') {
            const c = parse(importCatalogSchema, catalog);
            if (config.licenses.includes(c.license)) {
              const source = await this.p.db.source.upsert({
                where: { connectorKey: asset.identity },
                update: {},
                create: {
                  connectorKey: asset.identity,
                  name: c.name,
                  url: c.url,
                  license: c.license,
                  evidenceUrl: c.evidenceUrl,
                  attribution: c.attribution,
                  verifiedAt: new Date(),
                  commercialUseVerified: true,
                  mediaUrl: c.mediaUrl,
                  evidence: {
                    catalog: catalog as Prisma.InputJsonValue,
                    automationId: item.id,
                    policyConfirmedAt: item.createdAt.toISOString(),
                  },
                },
              });
              await this.p.db.mediaAsset.update({
                where: { id: asset.id },
                data: { sourceId: source.id, rightsConfirmed: true },
              });
              asset.sourceId = source.id;
              asset.rightsConfirmed = true;
            }
          }
        }
        // Apenas direitos previamente confirmados; descoberta nunca é autorização.
        if (
          !config.autoProcess ||
          !asset.rightsConfirmed ||
          !asset.accessible ||
          !asset.sourceId
        )
          continue;
        const source = await this.p.db.source.findUnique({
          where: { id: asset.sourceId },
        });
        if (
          !source ||
          !config.licenses.includes(
            source.license as 'CC0' | 'CC-BY-4.0' | 'PERMISSION',
          )
        )
          continue;
        await this.p.production.start({
          assetId: asset.id,
          options: config.options,
        });
        processed++;
      }
      return this.p.db.searchRun.update({
        where: { id: run.id },
        data: {
          status: result.errors.length ? 'PARTIAL' : 'COMPLETED',
          found: result.items.length,
          processed,
          error: result.errors.join('\n') || null,
          completedAt: new Date(),
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Falha na automação';
      await this.p.db.searchRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', error: message, completedAt: new Date() },
      });
      throw new BadRequestException(message);
    }
  }
}

const importCatalogSchema = z.object({
  name: z.string().max(200),
  url: z.url(),
  license: z.enum(['CC0', 'CC-BY-4.0', 'PERMISSION']),
  evidenceUrl: z.url(),
  attribution: z.string().min(1).max(2000),
  mediaUrl: z.url(),
});
