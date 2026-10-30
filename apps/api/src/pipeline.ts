import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  Post,
  ServiceUnavailableException,
  StreamableFile,
  Req,
  Res,
  Query,
} from '@nestjs/common';
import { IncomingMessage } from 'node:http';
import { Production } from './production';
import { Automations, automationSchema } from './automation';
import { hash } from './connectors';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Queue, Worker, UnrecoverableError } from 'bullmq';
import { jobSchema, parse, sourceSchema } from './contracts';
import { SelectionPipeline } from './selection/pipeline';
import { Discovery, discoveryRequest, importRequest } from './discovery';
import { Task } from '@prisma/client';
import { Readable } from 'node:stream';
import { Publishing } from './publication';
import { library, removeItem, restoreItem } from './library';
import { z } from 'zod';

@Injectable()
export class Pipeline implements OnModuleInit, OnModuleDestroy {
  readonly db = new PrismaClient({
    adapter: new PrismaPg({
      max: 3,
      application_name: 'autoclips-api',
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
      allowExitOnIdle: true,
      connectionString:
        process.env.DATABASE_URL ??
        'postgresql://autoclips:local_example@localhost:5432/autoclips',
    }),
  });
  readonly connection = {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
  };
  readonly queue = new Queue('media', {
    connection: this.connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  });
  readonly logger = new Logger(Pipeline.name);
  readonly selection = new SelectionPipeline(this.db, this.queue);
  readonly discovery = new Discovery();
  readonly publishing = new Publishing(this.db, this.queue);
  readonly production = new Production(this);
  readonly automations = new Automations(this);
  worker?: Worker;
  async onModuleInit() {
    await this.db.$connect();
    await this.queue.setGlobalConcurrency(1);
    this.worker = new Worker(
      'media',
      async (job) => {
        if (job.name === 'continuation') {
          const task = await this.db.task.findUniqueOrThrow({
            where: { id: job.data.taskId },
          });
          try {
            await this.continueTask(task);
          } catch (error) {
            await this.db.task.update({
              where: { id: task.id },
              data: {
                error:
                  error instanceof Error
                    ? error.message
                    : 'Falha na continuação',
              },
            });
            throw error;
          }
          return { continued: true };
        }
        if (job.name === 'discovery-run')
          return this.automations.run(job.data.automationId);
        if (job.name === 'publish-simulation')
          return this.publishing.simulate(job.data.publicationId);
        if (job.name === 'echo')
          return this.callWorker('/echo', { message: 'Teste BullMQ' });
        const record = await this.db.task.findUniqueOrThrow({
          where: { id: job.id },
          include: { source: true },
        });
        if (record.status === 'CANCELLED' || record.deletedAt)
          return { cancelled: true };
        if (record.parentId) {
          const parent = await this.db.task.findUnique({
            where: { id: record.parentId },
          });
          if (parent?.deletedAt || parent?.status === 'CANCELLED') {
            await this.db.task.update({
              where: { id: record.id },
              data: {
                status: 'CANCELLED',
                deletedAt: parent.deletedAt,
                continuationDone: true,
              },
            });
            return { cancelled: true };
          }
        }
        // BullMQ pode reentregar após reinício; reutiliza uma etapa já persistida.
        if (record.status === 'COMPLETED') {
          await this.advance(record);
          return record.result;
        }
        const claimed = await this.db.task.updateMany({
          where: {
            id: record.id,
            deletedAt: null,
            status: { not: 'CANCELLED' },
          },
          data: { status: 'PROCESSING', error: null },
        });
        if (!claimed.count) return { cancelled: true };
        try {
          const request = {
            ...(record.payload as Record<string, unknown>),
            rights: {
              license: record.source.license,
              evidence_url: record.source.evidenceUrl,
              attribution: record.source.attribution,
              commercial_use_verified: record.source.commercialUseVerified,
            },
          };
          const result =
            record.operation === 'select'
              ? await this.selection.execute(record)
              : await this.callWorker(
                  `/${record.operation}`,
                  request,
                  30 * 60 * 1000,
                );
          if (
            (await this.db.task.findUniqueOrThrow({ where: { id: record.id } }))
              .status === 'CANCELLED'
          )
            return { cancelled: true };
          await this.db.task.update({
            where: { id: record.id },
            data: {
              status: 'COMPLETED',
              result: result as Prisma.InputJsonValue,
            },
          });
          await this.advance({
            ...record,
            status: 'COMPLETED',
            result: result as Prisma.JsonValue,
          });
          return result;
        } catch (error) {
          if (
            (await this.db.task.findUniqueOrThrow({ where: { id: record.id } }))
              .status === 'CANCELLED'
          )
            return { cancelled: true };
          const retrying =
            record.operation !== 'select' &&
            !(error instanceof UnrecoverableError) &&
            job.attemptsMade + 1 < (job.opts.attempts ?? 1);
          await this.db.task.update({
            where: { id: record.id },
            data: {
              status: retrying ? 'RETRYING' : 'FAILED',
              error: error instanceof Error ? error.message : 'Falha no worker',
            },
          });
          if (record.operation === 'select')
            throw new UnrecoverableError(
              error instanceof Error ? error.message : 'Falha de seleção',
            );
          throw error;
        }
      },
      { connection: this.connection, concurrency: 1 },
    );
    this.worker.on('error', (error) => this.logger.error(error.message));
    this.queue.on('error', (error) => this.logger.error(error.message));
    // Recupera tarefas persistidas se Redis foi perdido ou houve falha ao enfileirar.
    for (const task of await this.db.task.findMany({
      where: {
        deletedAt: null,
        status: { in: ['QUEUED', 'PROCESSING', 'RETRYING'] },
      },
    })) {
      if (task.operation === 'select' && task.status !== 'QUEUED') {
        await this.db.task.update({
          where: { id: task.id },
          data: {
            status: 'FAILED',
            error:
              'Seleção interrompida. Revise o consumo antes de reprocessar; chamadas LLM não serão repetidas automaticamente.',
          },
        });
        continue;
      }
      const existing = await this.queue.getJob(task.id);
      if (
        existing &&
        ['failed', 'completed'].includes(await existing.getState())
      ) {
        await existing.remove();
      }
      await this.queue.add(
        task.operation,
        {},
        {
          jobId: task.id,
          ...(task.operation === 'select' ? { attempts: 1 } : {}),
        },
      );
    }
    // Recuperação apenas ao iniciar. Não há polling do PostgreSQL em inatividade.
    for (const task of await this.db.task.findMany({
      where: {
        deletedAt: null,
        autoRun: true,
        status: 'COMPLETED',
        continuationDone: false,
      },
    }))
      await this.advance(task);
    for (const entry of await this.db.publication.findMany({
      where: { status: 'SCHEDULED' },
    }))
      await this.publishing.enqueue(entry);
    for (const entry of await this.db.automation.findMany())
      await this.automations.schedule(entry);
    await this.db.searchRun.updateMany({
      where: { status: 'PROCESSING' },
      data: {
        status: 'INTERRUPTED',
        error:
          'Busca interrompida pelo reinício; próxima execução usará deduplicação.',
        completedAt: new Date(),
      },
    });
  }
  async advance(task: Task) {
    try {
      await this.continueTask(task);
    } catch (error) {
      const current = await this.db.task.findUnique({ where: { id: task.id } });
      if (current?.deletedAt || current?.status === 'CANCELLED') return;
      const message =
        error instanceof Error ? error.message : 'Falha ao continuar produção';
      this.logger.error(`Continuação ${task.id}: ${message}`);
      await this.db.task.update({
        where: { id: task.id },
        data: {
          error: message,
        },
      });
      await this.queue.add(
        'continuation',
        { taskId: task.id },
        { jobId: `continue-${task.id}`, attempts: 3 },
      );
    }
  }
  async continueTask(task: Task) {
    const current = await this.db.task.findUnique({ where: { id: task.id } });
    if (current?.deletedAt || current?.status === 'CANCELLED') return;
    if (!task.autoRun || task.continuationDone || task.status !== 'COMPLETED')
      return;
    if (task.operation === 'download') {
      const result = task.result as { path: string; sha256?: string };
      const editorial = task.editorial as {
        assetId?: string;
        options?: { language?: string };
        reprocess?: boolean;
      } | null;
      if (editorial?.assetId) {
        const existing = result.sha256
          ? await this.db.mediaAsset.findUnique({
              where: { sha256: result.sha256 },
            })
          : null;
        await this.db.mediaAsset.update({
          where: { id: editorial.assetId },
          data: {
            path: existing?.path ?? result.path,
            ...(existing ? {} : { sha256: result.sha256 }),
            accessible: true,
          },
        });
      }
      const nextKey = `auto-transcribe-${result.sha256 && !editorial?.reprocess ? hash([result.sha256, editorial?.options ?? null, this.selection.config]) : task.id}`;
      const reused = await this.production.findTranscript(
        task.sourceId,
        result.path,
        editorial?.options?.language ?? 'auto',
      );
      const next = await this.db.task.upsert({
        where: { renderKey: nextKey },
        create: {
          testContent: task.testContent,
          sourceId: task.sourceId,
          operation: 'transcribe',
          ...(reused
            ? {
                status: 'COMPLETED',
                result: reused.result as Prisma.InputJsonValue,
              }
            : {}),
          payload: {
            path: result.path,
            ...(editorial?.options?.language &&
            editorial.options.language !== 'auto'
              ? { language: editorial.options.language }
              : {}),
          },
          editorial: (task.editorial as Prisma.InputJsonValue) ?? undefined,
          autoRun: true,
          parentId: task.id,
          renderKey: nextKey,
        },
        update: {},
      });
      if (next.parentId !== task.id)
        await this.db.task.update({
          where: { id: task.id },
          data: { result: { ...result, reusedTaskId: next.id } },
        });
      if (
        next.status === 'QUEUED' ||
        (next.status === 'COMPLETED' && !next.continuationDone)
      )
        await this.queue.add('transcribe', {}, { jobId: next.id });
    } else if (task.operation === 'transcribe') {
      const result = task.result as { segments?: unknown[] } | null;
      if (Array.isArray(result?.segments) && !result.segments.length) {
        await this.db.task.update({
          where: { id: task.id },
          data: {
            continuationDone: true,
            error:
              'A transcrição terminou, mas nenhuma fala foi reconhecida. Não há trechos para selecionar; confira o áudio e o idioma.',
          },
        });
        return;
      }
      await this.selection.enqueue(task.id, true);
    } else if (task.operation === 'select') {
      const { clips } = task.result as unknown as { clips: { id: string }[] };
      if (!clips.length) {
        await this.db.task.update({
          where: { id: task.id },
          data: {
            continuationDone: true,
            error:
              'A transcrição terminou, mas nenhum trecho adequado foi encontrado. Revise a duração e o conteúdo.',
          },
        });
        return;
      }
      for (const clip of clips)
        await this.selection.render(task.id, { candidateId: clip.id });
    }
    await this.db.task.update({
      where: { id: task.id },
      data: { continuationDone: true, error: null },
    });
  }
  async callWorker(path: string, body?: unknown, timeout = 5000) {
    const response = await fetch(
      `${process.env.WORKER_URL ?? 'http://127.0.0.1:8000'}${path}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.WORKER_API_TOKEN ?? ''}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      },
    );
    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as {
        detail?: unknown;
      };
      const message =
        typeof detail.detail === 'string'
          ? detail.detail
          : `Worker rejeitou a tarefa (${response.status})`;
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 429
      )
        throw new UnrecoverableError(message);
      throw new ServiceUnavailableException(
        `Worker indisponível (${response.status})`,
      );
    }
    return response.json() as Promise<unknown>;
  }
  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue.close();
    await this.db.$disconnect();
  }
}

@Controller()
export class PipelineController {
  constructor(@Inject(Pipeline) private readonly pipeline: Pipeline) {}
  @Get('library')
  library() {
    return library(this.pipeline.db);
  }
  @Post('jobs/:id/remove')
  remove(@Param('id') id: string) {
    return removeItem(this.pipeline.db, id);
  }
  @Post('jobs/:id/restore')
  restore(@Param('id') id: string, @Body() body: unknown) {
    const value = body as { undoToken?: unknown };
    if (
      typeof value?.undoToken !== 'string' ||
      !Number.isFinite(Date.parse(value.undoToken))
    )
      throw new BadRequestException('Informe a exclusão que deseja desfazer.');
    return restoreItem(this.pipeline.db, id, value.undoToken);
  }
  @Get('media')
  media() {
    return this.pipeline.db.mediaAsset.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }
  @Post('media/inspect')
  inspect(@Body() body: unknown) {
    return this.pipeline.production.inspect(body);
  }
  @Post('productions')
  production(@Body() body: unknown) {
    return this.pipeline.production.start(body);
  }
  @Post('media/upload')
  async upload(
    @Req() request: IncomingMessage,
    @Query('sourceId') sourceId: string,
    @Query('extension') extension: string,
    @Query('name') name?: string,
    @Query('testContent') testContent?: string,
  ) {
    const source = sourceId
      ? await this.pipeline.db.source.findUnique({
          where: { id: sourceId ?? '' },
        })
      : null;
    if (sourceId && !source?.commercialUseVerified)
      throw new BadRequestException(
        'Cadastre e selecione uma fonte com autorização antes do upload',
      );
    if (!/^(mp4|webm|mov|mkv|ogv|wav|mp3|m4a)$/.test(extension ?? ''))
      throw new BadRequestException('Formato não permitido');
    const response = await fetch(
      `${process.env.WORKER_URL ?? 'http://127.0.0.1:8000'}/upload?extension=${extension}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.WORKER_API_TOKEN ?? ''}`,
          'Content-Type': 'application/octet-stream',
        },
        body: Readable.toWeb(request) as ReadableStream,
        duplex: 'half',
        signal: AbortSignal.timeout(600000),
      } as RequestInit,
    );
    const result = await response.json();
    if (!response.ok)
      throw new BadRequestException(
        typeof result.detail === 'string'
          ? result.detail
          : 'Não foi possível validar o arquivo enviado',
      );
    return this.pipeline.production.registerUpload(
      source?.id,
      result,
      name,
      testContent === 'true',
    );
  }
  @Post('discovery/multisearch')
  multiSearch(@Body() body: unknown) {
    return this.pipeline.automations.search(body);
  }
  @Get('automations')
  automations() {
    return this.pipeline.db.automation.findMany({
      include: { runs: { orderBy: { createdAt: 'desc' }, take: 10 } },
      orderBy: { createdAt: 'desc' },
    });
  }
  @Post('automations')
  createAutomation(@Body() body: unknown) {
    return this.pipeline.automations.create(body);
  }
  @Post('automations/:id/toggle')
  toggleAutomation(@Param('id') id: string, @Body() body: unknown) {
    return this.pipeline.automations.toggle(id, body);
  }
  @Post('automations/:id/run')
  async runAutomation(@Param('id') id: string) {
    await this.pipeline.db.automation.findUniqueOrThrow({ where: { id } });
    const job = await this.pipeline.queue.add(
      'discovery-run',
      { automationId: id },
      {
        jobId: `manual-search-${id}-${Math.floor(Date.now() / 3600000)}`,
        attempts: 1,
      },
    );
    return { id: job.id };
  }
  @Post('jobs/:id/cancel')
  async cancel(@Param('id') id: string) {
    const all = await this.pipeline.db.task.findMany({
      select: { id: true, parentId: true },
    });
    const ids = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const t of all)
        if (t.parentId && ids.has(t.parentId) && !ids.has(t.id)) {
          ids.add(t.id);
          changed = true;
        }
    }
    await this.pipeline.db.task.updateMany({
      where: { id: { in: [...ids] } },
      data: {
        status: 'CANCELLED',
        continuationDone: true,
        error: 'Produção cancelada pelo usuário',
      },
    });
    return { cancelled: true };
  }
  @Get('platforms')
  platforms() {
    return this.pipeline.publishing.status();
  }
  @Post('oauth/start')
  oauthStart(@Body() body: unknown) {
    return this.pipeline.publishing.start(body);
  }
  @Post('oauth/callback')
  oauthCallback(@Body() body: unknown) {
    return this.pipeline.publishing.callback(body);
  }
  @Post('oauth/refresh')
  oauthRefresh(@Body() body: unknown) {
    return this.pipeline.publishing.refresh(body);
  }
  @Post('jobs/:id/schedule')
  schedule(@Param('id') id: string, @Body() body: unknown) {
    return this.pipeline.publishing.schedule(id, body);
  }
  @Post('jobs/:id/continue')
  async resume(@Param('id') id: string) {
    const task = await this.status(id);
    if (!task.autoRun || task.status !== 'COMPLETED')
      throw new BadRequestException(
        'A continuação exige etapa automática concluída',
      );
    await this.pipeline.advance(task);
    return this.status(id);
  }
  @Post('discovery/search')
  discover(@Body() body: unknown) {
    const { connector, query } = parse(discoveryRequest, body);
    return this.pipeline.discovery.search(connector, query);
  }
  @Post('discovery/import')
  async importMedia(@Body() body: unknown) {
    const { connector, reference, autoRun } = parse(importRequest, body);
    const item = await this.pipeline.discovery.resolve(connector, reference);
    const source = await this.pipeline.db.source.upsert({
      where: { connectorKey: item.connectorKey },
      create: {
        name: item.name,
        url: item.url,
        license: item.license,
        evidenceUrl: item.evidenceUrl,
        attribution: item.attribution,
        commercialUseVerified: true,
        verifiedAt: new Date(),
        mediaUrl: item.mediaUrl,
        connectorKey: item.connectorKey,
        evidence: item.evidence as Prisma.InputJsonValue,
      },
      update: {},
    });
    const task = await this.pipeline.db.task.upsert({
      where: { renderKey: `download-${item.connectorKey}` },
      create: {
        sourceId: source.id,
        operation: 'download',
        payload: {
          url: item.mediaUrl,
          key: item.connectorKey,
          ...(connector === 'commons'
            ? { expected_sha1: item.evidence.sha1 as string }
            : {}),
        },
        renderKey: `download-${item.connectorKey}`,
        autoRun,
      },
      update: {},
    });
    if (task.status === 'QUEUED')
      await this.pipeline.queue.add('download', {}, { jobId: task.id });
    return task;
  }
  @Get('jobs/:id/artifacts/:kind')
  async artifact(
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true })
    reply: {
      status(code: number): unknown;
      setHeader(name: string, value: string): unknown;
    },
  ) {
    const task = await this.status(id);
    const keys: Record<string, string> = {
      video: 'video_path',
      subtitles: 'subtitle_path',
      transcript: 'transcript_path',
    };
    const path = (task.result as Record<string, unknown> | null)?.[keys[kind]];
    if (
      task.status !== 'COMPLETED' ||
      typeof path !== 'string' ||
      !/^outputs\/[a-f0-9]{32}\.(mp4|srt|json)$/.test(path)
    )
      throw new NotFoundException('Artefato não encontrado');
    const response = await fetch(
      `${process.env.WORKER_URL ?? 'http://127.0.0.1:8000'}/artifacts/${path.slice(8)}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.WORKER_API_TOKEN ?? ''}`,
          ...(request.headers.range ? { Range: request.headers.range } : {}),
        },
        signal: AbortSignal.timeout(600000),
      },
    );
    if (!response.ok || !response.body)
      throw new NotFoundException('Artefato indisponível');
    reply.status(response.status);
    for (const name of ['accept-ranges', 'content-range', 'content-length']) {
      const value = response.headers.get(name);
      if (value) reply.setHeader(name, value);
    }
    return new StreamableFile(
      Readable.fromWeb(
        response.body as import('node:stream/web').ReadableStream,
      ),
      {
        type:
          response.headers.get('content-type') ?? 'application/octet-stream',
        disposition: `inline; filename="${path.slice(8)}"`,
      },
    );
  }
  @Get('llm/config')
  llmConfiguration() {
    return this.pipeline.selection.configuration();
  }
  @Post('jobs/:id/select')
  select(@Param('id') id: string, @Body() body: unknown) {
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length
    )
      throw new BadRequestException(
        'Envie um objeto vazio; configuração LLM pertence ao servidor',
      );
    return this.pipeline.selection.enqueue(id);
  }
  @Post('jobs/:id/render-selection')
  renderSelection(@Param('id') id: string, @Body() body: unknown) {
    return this.pipeline.selection.render(id, body);
  }
  @Get('jobs/:id/llm-usage')
  async llmUsage(@Param('id') id: string) {
    await this.status(id);
    return this.pipeline.db.llmCall.findMany({
      where: { taskId: id },
      orderBy: { createdAt: 'asc' },
      select: {
        key: true,
        provider: true,
        model: true,
        state: true,
        day: true,
        inputReserved: true,
        outputReserved: true,
        costReservedMicros: true,
        inputTokens: true,
        outputTokens: true,
        costMicros: true,
        createdAt: true,
      },
    });
  }
  @Get('ready')
  async ready() {
    try {
      await this.pipeline.db.$queryRaw`SELECT 1`;
      await this.pipeline.queue.isPaused();
      await this.pipeline.callWorker('/health');
      return { status: 'ok', dependencies: ['postgres', 'redis', 'worker'] };
    } catch {
      throw new ServiceUnavailableException('Dependência indisponível');
    }
  }
  @Post('internal/echo')
  echo() {
    return this.pipeline.callWorker('/echo', { message: 'AutoClips AI' });
  }
  @Post('internal/queue-test')
  async queueTest() {
    const job = await this.pipeline.queue.add('echo', {});
    return { id: job.id };
  }
  @Get('internal/queue-test/:id')
  async queueTestStatus(@Param('id') id: string) {
    const job = await this.pipeline.queue.getJob(id);
    if (!job || job.name !== 'echo')
      throw new NotFoundException('Teste não encontrado');
    return { state: await job.getState(), result: job.returnvalue };
  }
  @Get('sources')
  sources() {
    return this.pipeline.db.source.findMany({
      where: { purpose: 'monitoring' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  @Post('sources')
  async source(@Body() body: unknown) {
    const { monitoring, ...data } = parse(
      sourceSchema
        .partial({
          license: true,
          evidenceUrl: true,
          attribution: true,
          commercialUseVerified: true,
        })
        .extend({
          commercialUseVerified: z.boolean().default(false),
          monitoring: automationSchema
            .omit({ name: true, kind: true })
            .optional(),
        }),
      body,
    );
    if (data.commercialUseVerified) parse(sourceSchema, data);
    const source = await this.pipeline.db.source.create({
      data: {
        ...data,
        license: data.commercialUseVerified ? data.license! : 'UNKNOWN',
        evidenceUrl: data.evidenceUrl ?? data.url,
        attribution:
          data.attribution ??
          'Direitos não informados; fonte cadastrada apenas para descoberta.',
        verifiedAt: new Date(),
        ...(monitoring
          ? { evidence: { monitoring: monitoring as Prisma.InputJsonValue } }
          : {}),
      },
    });
    if (monitoring)
      await this.pipeline.automations.create({
        ...monitoring,
        name: source.name,
        kind: 'source',
        config: { ...monitoring.config, sourceId: source.id },
      });
    return source;
  }
  @Post('jobs')
  async job(@Body() body: unknown) {
    const { sourceId, operation, autoRun, ...payload } = parse(jobSchema, body);
    const source = await this.pipeline.db.source.findUnique({
      where: { id: sourceId },
    });
    if (!source || !source.commercialUseVerified)
      throw new NotFoundException('Fonte autorizada não encontrada');
    const renderKey = hash([
      'technical',
      sourceId,
      operation,
      payload,
      autoRun ?? false,
    ]);
    const task = await this.pipeline.db.task.upsert({
      where: { renderKey },
      update: {},
      create: { sourceId, operation, payload, autoRun, renderKey },
    });
    try {
      await this.pipeline.queue.add(operation, {}, { jobId: task.id });
    } catch {
      throw new ServiceUnavailableException(
        'Tarefa persistida; reinicie a API para reenfileirar',
      );
    }
    return task;
  }
  @Get('jobs')
  jobs() {
    return this.pipeline.db.task.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  @Get('jobs/:id')
  async status(@Param('id') id: string) {
    const task = await this.pipeline.db.task.findUnique({ where: { id } });
    if (!task || task.deletedAt)
      throw new NotFoundException('Produção ou corte não encontrado');
    return task;
  }
  @Post('jobs/:id/publish')
  async publish(@Param('id') id: string) {
    const task = await this.status(id);
    return {
      mode: 'simulation',
      published: false,
      taskId: task.id,
      status: task.status,
    };
  }
}
