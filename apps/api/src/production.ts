import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  Candidate,
  Connectors,
  hash,
  normalizedUrl,
  identityForUrl,
  thumbnailUrl,
} from './connectors';
import { parse, sourceSchema } from './contracts';
import type { Pipeline } from './pipeline';
import { UnavailableProvider } from './selection/provider';
import { criteriaSchema, selectionPolicy } from './selection/contracts';

export const productionOptions = z
  .object({
    maxClips: z.number().int().min(1).max(10).default(3),
    minDuration: z.number().min(1).max(60).default(5),
    maxDuration: z.number().min(1).max(180).default(60),
    language: z.enum(['auto', 'pt', 'en', 'es']).default('auto'),
    criteria: criteriaSchema.optional(),
    minScore: z.number().min(0).max(10).optional(),
    fallback: z.enum(['none', 'heuristic']).optional(),
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
    confirmPermission: z.boolean().default(false),
    authorization: sourceSchema.omit({ name: true, url: true }).optional(),
    options: productionOptions.default({
      maxClips: 3,
      minDuration: 5,
      maxDuration: 60,
      language: 'auto',
    }),
  })
  .strict();
export function describeMedia<
  T extends {
    platform: string;
    path?: string | null;
    accessible: boolean;
    rightsConfirmed: boolean;
    metadata: unknown;
  },
>(asset: T) {
  const metadata = (asset.metadata ?? {}) as {
    thumbnailUrl?: unknown;
    catalog?: unknown;
    metadataUnavailable?: boolean;
  };
  const kind = asset.path
    ? 'imported'
    : !asset.accessible
      ? 'upload_required'
      : asset.rightsConfirmed || metadata.catalog
        ? 'available'
        : 'permission_required';
  const message =
    kind === 'imported'
      ? 'O arquivo já está importado. Vamos reutilizá-lo, sem baixar novamente.'
      : kind === 'available'
        ? 'Arquivo disponível para importação automática. O acesso e a integridade serão conferidos no processamento.'
        : kind === 'permission_required'
          ? 'O arquivo pode ser importado. Se não houver permissão registrada, confirme que possui os direitos para este vídeo.'
          : asset.platform === 'twitch' && metadata.metadataUnavailable
            ? 'A conexão com a Twitch ainda não está configurada. Envie o original autorizado para continuar.'
            : `Podemos identificar o vídeo, mas a integração ${asset.platform === 'youtube' ? 'YouTube' : asset.platform === 'twitch' ? 'Twitch' : asset.platform === 'vimeo' ? 'Vimeo' : 'desta plataforma'} não fornece o arquivo original. Envie o original autorizado para criar os cortes.`;
  return {
    ...asset,
    thumbnailUrl: thumbnailUrl(metadata.thumbnailUrl),
    availability: { kind, message },
  };
}
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
        reason: data.reason,
        ...(source
          ? { sourceId: source.id, rightsConfirmed: true, reason: data.reason }
          : {}),
      },
    });
  }
  async inspect(body: unknown) {
    const { url } = parse(z.object({ url: z.url().max(2000) }).strict(), body);
    const identity = identityForUrl(url);
    const imported = identity
      ? await this.p.db.mediaAsset.findUnique({ where: { identity } })
      : null;
    if (imported?.path) return describeMedia(imported);
    return describeMedia(
      await this.remember(await this.connectors.resolve(url)),
    );
  }
  async start(body: unknown) {
    const request = parse(productionRequest, body);
    const asset = await this.p.db.mediaAsset.findUnique({
      where: { id: request.assetId },
    });
    if (!asset) throw new NotFoundException('Vídeo importado não encontrado');
    if (!asset.path && (!asset.accessible || !asset.mediaUrl))
      throw new BadRequestException({
        code: 'ORIGINAL_REQUIRED',
        message: describeMedia(asset).availability.message,
      });
    const sourceId = request.sourceId ?? asset.sourceId;
    let source = sourceId
      ? await this.p.db.source.findUnique({ where: { id: sourceId } })
      : await this.p.db.source.findFirst({
          where: { url: asset.url, commercialUseVerified: true },
        });
    if (source && !source.commercialUseVerified) source = null;
    if (
      !source &&
      (request.authorization ||
        request.confirmPermission ||
        (asset.metadata as Record<string, unknown>).catalog)
    ) {
      const catalog = (asset.metadata as Record<string, unknown>).catalog;
      const c = catalog as
        | { license?: unknown; evidenceUrl?: unknown; attribution?: unknown }
        | undefined;
      const rights =
        request.authorization ??
        (c
          ? sourceSchema.omit({ name: true, url: true }).parse({
              license: c.license,
              evidenceUrl: c.evidenceUrl,
              attribution: c.attribution,
              commercialUseVerified: true,
            })
          : request.confirmPermission
            ? {
                license: 'PERMISSION' as const,
                evidenceUrl: asset.url,
                attribution:
                  asset.author ||
                  'Autorização declarada pelo operador para esta mídia.',
                commercialUseVerified: true as const,
              }
            : null);
      if (rights) {
        const data = sourceSchema.parse({
          name: asset.title.slice(0, 200),
          url: asset.url,
          ...rights,
        });
        source = await this.p.db.source.upsert({
          where: { connectorKey: `authorization-${asset.identity}` },
          update: {},
          create: {
            ...data,
            purpose: 'media',
            verifiedAt: new Date(),
            connectorKey: `authorization-${asset.identity}`,
            mediaUrl: asset.mediaUrl,
            evidence: {
              confirmedAt: new Date().toISOString(),
              metadata: asset.metadata,
              method: request.authorization
                ? 'documented-authorization'
                : c
                  ? 'catalog-license'
                  : 'operator-declaration',
              scope: asset.identity,
            },
          },
        });
      }
    }
    if (!source?.commercialUseVerified)
      throw new BadRequestException({
        code: 'AUTHORIZATION_REQUIRED',
        message:
          'Confirme que esta mídia é sua ou que você tem autorização para criar cortes. Nenhuma fonte precisa ser cadastrada.',
      });
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
        'A autorização informada pertence a outro vídeo. Use a autorização desta mídia.',
      );
    await this.p.db.mediaAsset.update({
      where: { id: asset.id },
      data: { sourceId: source.id, rightsConfirmed: true },
    });
    const effective = { ...this.p.selection.config, ...request.options };
    const options = {
      ...request.options,
      criteria: effective.criteria,
      minScore: effective.minScore,
      fallback: effective.fallback,
    };
    const key = hash([
      selectionPolicy(effective),
      asset.identity,
      source.id,
      options.language,
      !(this.p.selection.provider instanceof UnavailableProvider),
      request.autoRun,
    ]);
    const renderKey = request.reprocess ? `${key}-${randomUUID()}` : key;
    const reused = asset.path
      ? await this.findTranscript(
          source.id,
          asset.path,
          request.options.language,
        )
      : null;
    const task = await this.p.db.task.upsert({
      where: { renderKey },
      update: {},
      create: {
        testContent: asset.testContent,
        sourceId: source.id,
        operation: asset.path ? 'transcribe' : 'download',
        ...(reused
          ? {
              status: 'COMPLETED',
              result: reused.result as Prisma.InputJsonValue,
            }
          : {}),
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
              ...(asset.platform === 'direct'
                ? { public_file_authorized: true }
                : {}),
              ...(asset.platform === 'commons' && catalog?.evidence?.sha1
                ? { expected_sha1: catalog.evidence.sha1 }
                : {}),
            },
        editorial: {
          mediaTitle: asset.title,
          options,
          assetId: asset.id,
          reprocess: request.reprocess,
          ...(reused ? { reusedTranscriptionId: reused.id } : {}),
        },
        autoRun: request.autoRun,
      },
    });
    if (
      task.status === 'QUEUED' ||
      (task.status === 'COMPLETED' && task.autoRun && !task.continuationDone)
    )
      await this.p.queue.add(task.operation, {}, { jobId: task.id });
    return task;
  }
  findTranscript(sourceId: string, path: string, language = 'auto') {
    return this.p.db.task.findFirst({
      where: {
        deletedAt: null,
        sourceId,
        operation: 'transcribe',
        status: 'COMPLETED',
        AND: [
          { payload: { path: ['path'], equals: path } },
          language === 'auto'
            ? { payload: { equals: { path } } }
            : { payload: { path: ['language'], equals: language } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  async registerUpload(
    sourceId: string | undefined,
    result: { path: string; sha256: string; duration: number },
    title = 'Vídeo enviado',
    testContent = false,
  ) {
    const source = sourceId
      ? await this.p.db.source.findUnique({
          where: { id: sourceId },
        })
      : null;
    if (sourceId && !source?.commercialUseVerified)
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
        url:
          source?.url ??
          `https://local.autoclips.invalid/uploads/${result.sha256}`,
        title: source?.name ?? title.slice(0, 200),
        author: source?.attribution,
        sourceId: source?.id,
        ...result,
        rightsConfirmed: !!source,
        testContent:
          testContent ||
          (!!source &&
            /fixture|sintétic|System.Speech/i.test(source.attribution)),
        accessible: true,
        metadata: {
          method: 'upload',
          testContent:
            testContent ||
            (!!source &&
              /fixture|sintétic|System.Speech/i.test(source.attribution)),
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
