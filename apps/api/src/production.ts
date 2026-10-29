import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Candidate, Connectors, hash, normalizedUrl } from './connectors';
import { parse, sourceSchema } from './contracts';
import type { Pipeline } from './pipeline';

export const productionOptions = z
  .object({
    maxClips: z.number().int().min(1).max(10).default(3),
    minDuration: z.number().min(1).max(60).default(5),
    maxDuration: z.number().min(1).max(180).default(60),
    language: z.enum(['auto', 'pt', 'en', 'es']).default('auto'),
  })
  .strict()
  .refine(
    (v) => v.minDuration <= v.maxDuration,
    'Duração mínima maior que a máxima',
  );
export const productionRequest = z
  .object({
    assetId: z.string().min(1),
    sourceId: z.string().optional(),
    autoRun: z.boolean().default(true),
    reprocess: z.boolean().default(false),
    confirmCatalogRights: z.boolean().default(false),
    authorization: sourceSchema.omit({ name: true, url: true }).optional(),
    options: productionOptions.default({
      maxClips: 3,
      minDuration: 5,
      maxDuration: 60,
      language: 'auto',
    }),
  })
  .strict();
export class Production {
  readonly connectors = new Connectors();
  constructor(private readonly p: Pipeline) {}
  async remember(candidate: Candidate) {
    const source = await this.p.db.source.findFirst({
      where: { url: candidate.url, commercialUseVerified: true },
    });
    const data = {
      ...candidate,
      publishedAt: candidate.publishedAt
        ? new Date(candidate.publishedAt)
        : undefined,
      metadata: candidate.metadata as Prisma.InputJsonValue,
      ...(source
        ? {
            sourceId: source.id,
            rightsConfirmed: true,
            reason: candidate.accessible
              ? 'Direitos confirmados; disponível para processamento.'
              : 'Direitos confirmados, mas o arquivo original ainda precisa ser enviado por um método autorizado.',
          }
        : {}),
    };
    // Nunca sobrescreve confirmação explícita ou arquivo já importado com descoberta.
    return this.p.db.mediaAsset.upsert({
      where: { identity: data.identity },
      create: data,
      update: {
        title: data.title,
        author: data.author,
        duration: data.duration,
        metadata: data.metadata,
        ...(source
          ? { sourceId: source.id, rightsConfirmed: true, reason: data.reason }
          : {}),
      },
    });
  }
  async inspect(body: unknown) {
    const { url } = parse(z.object({ url: z.url().max(2000) }).strict(), body);
    return this.remember(await this.connectors.resolve(url));
  }
  async start(body: unknown) {
    const request = parse(productionRequest, body);
    const asset = await this.p.db.mediaAsset.findUnique({
      where: { id: request.assetId },
    });
    if (!asset) throw new NotFoundException('Vídeo importado não encontrado');
    const sourceId = request.sourceId ?? asset.sourceId;
    let source = sourceId
      ? await this.p.db.source.findUnique({ where: { id: sourceId } })
      : await this.p.db.source.findFirst({
          where: { url: asset.url, commercialUseVerified: true },
        });
    if (!source && (request.authorization || request.confirmCatalogRights)) {
      const catalog = (asset.metadata as Record<string, unknown>).catalog;
      const c = catalog as
        | { license?: unknown; evidenceUrl?: unknown; attribution?: unknown }
        | undefined;
      const rights =
        request.authorization ??
        (request.confirmCatalogRights && c
          ? sourceSchema.omit({ name: true, url: true }).parse({
              license: c.license,
              evidenceUrl: c.evidenceUrl,
              attribution: c.attribution,
              commercialUseVerified: true,
            })
          : null);
      if (rights) {
        const data = sourceSchema.parse({
          name: asset.title,
          url: asset.url,
          ...rights,
        });
        source = await this.p.db.source.upsert({
          where: { connectorKey: `authorization-${asset.identity}` },
          update: {},
          create: {
            ...data,
            verifiedAt: new Date(),
            connectorKey: `authorization-${asset.identity}`,
            mediaUrl: asset.mediaUrl,
            evidence: {
              confirmedAt: new Date().toISOString(),
              metadata: asset.metadata,
            },
          },
        });
      }
    }
    if (!source?.commercialUseVerified)
      throw new BadRequestException(
        'Este vídeo não possui autorização de reutilização registrada. Cadastre uma fonte com evidência.',
      );
    const catalog = (asset.metadata as Record<string, unknown>).catalog as
      | { url?: string; mediaUrl?: string; evidence?: { sha1?: string } }
      | undefined;
    // A autorização de uma fonte não pode ser aplicada a um vídeo de outra origem.
    if (
      !sameResource(source.url, asset.url) &&
      !(
        source.mediaUrl &&
        asset.mediaUrl &&
        sameResource(source.mediaUrl, asset.mediaUrl)
      ) &&
      !(catalog?.url && sameResource(source.url, catalog.url))
    )
      throw new BadRequestException(
        'A autorização selecionada pertence a outra origem. Cadastre a fonte com a URL deste vídeo.',
      );
    if (!asset.path && (!asset.accessible || !asset.mediaUrl))
      throw new BadRequestException(
        'Não foi possível acessar o arquivo original por um método autorizado. Envie o original; links públicos não autorizam extração.',
      );
    await this.p.db.mediaAsset.update({
      where: { id: asset.id },
      data: { sourceId: source.id, rightsConfirmed: true },
    });
    const key = hash([
      'production-v1',
      asset.identity,
      request.options,
      this.p.selection.config.provider,
      this.p.selection.config.model,
      request.autoRun,
    ]);
    const renderKey = request.reprocess ? `${key}-${randomUUID()}` : key;
    const task = await this.p.db.task.upsert({
      where: { renderKey },
      update: {},
      create: {
        sourceId: source.id,
        operation: asset.path ? 'transcribe' : 'download',
        renderKey,
        payload: asset.path
          ? {
              path: asset.path,
              ...(request.options.language === 'auto'
                ? {}
                : { language: request.options.language }),
            }
          : {
              url: asset.mediaUrl!,
              key: hash(asset.identity),
              ...(asset.platform === 'commons' && catalog?.evidence?.sha1
                ? { expected_sha1: catalog.evidence.sha1 }
                : {}),
            },
        editorial: {
          options: request.options,
          assetId: asset.id,
          reprocess: request.reprocess,
        },
        autoRun: request.autoRun,
      },
    });
    if (task.status === 'QUEUED')
      await this.p.queue.add(task.operation, {}, { jobId: task.id });
    return task;
  }
  async registerUpload(
    sourceId: string,
    result: { path: string; sha256: string; duration: number },
  ) {
    const source = await this.p.db.source.findUnique({
      where: { id: sourceId },
    });
    if (!source?.commercialUseVerified)
      throw new BadRequestException('Fonte autorizada não encontrada');
    const existing = await this.p.db.mediaAsset.findUnique({
      where: { sha256: result.sha256 },
    });
    if (existing) return existing;
    return this.p.db.mediaAsset.upsert({
      where: { identity: hash(['upload', result.sha256]) },
      update: {},
      create: {
        identity: hash(['upload', result.sha256]),
        platform: 'upload',
        url: source.url,
        title: source.name,
        author: source.attribution,
        sourceId,
        ...result,
        rightsConfirmed: true,
        accessible: true,
        metadata: {
          method: 'upload',
          testContent: /teste|fixture|sintétic/i.test(source.attribution),
        },
      },
    });
  }
}

export function sameResource(a: string, b: string) {
  const canonical = (value: string) => {
    const u = normalizedUrl(value);
    if (
      ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(
        u.hostname,
      )
    ) {
      const id =
        u.hostname === 'youtu.be'
          ? u.pathname.slice(1)
          : (u.searchParams.get('v') ??
            u.pathname.match(/^\/(?:shorts|embed)\/([^/]+)$/)?.[1]);
      if (id && /^[\w-]{11}$/.test(id)) return `youtube:${id}`;
    }
    if (u.hostname === 'commons.wikimedia.org')
      return `commons:${decodeURIComponent(u.pathname).replaceAll('_', ' ')}`;
    return u.href;
  };
  try {
    return canonical(a) === canonical(b);
  } catch {
    return a === b;
  }
}
