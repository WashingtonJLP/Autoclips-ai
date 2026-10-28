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
} from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Queue, Worker, UnrecoverableError } from 'bullmq';
import { jobSchema, parse, sourceSchema } from './contracts';
import { SelectionPipeline } from './selection/pipeline';
import { Discovery, discoveryRequest, importRequest } from './discovery';
import { Task } from '@prisma/client';
import { Readable } from 'node:stream';
import { Publishing } from './publication';

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
  worker?: Worker;
  async onModuleInit() {
    await this.db.$connect();
    await this.queue.setGlobalConcurrency(1);
    this.worker = new Worker(
      'media',
      async (job) => {
        if (job.name === 'publish-simulation')
          return this.publishing.simulate(job.data.publicationId);
        if (job.name === 'echo')
          return this.callWorker('/echo', { message: 'Teste BullMQ' });
        const record = await this.db.task.findUniqueOrThrow({
          where: { id: job.id },
          include: { source: true },
        });
        // BullMQ pode reentregar após reinício; reutiliza uma etapa já persistida.
        if (record.status === 'COMPLETED') {
          await this.advance(record);
          return record.result;
        }
        await this.db.task.update({
          where: { id: record.id },
          data: { status: 'PROCESSING', error: null },
        });
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
      where: { status: 'QUEUED' },
    })) {
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
      where: { autoRun: true, status: 'COMPLETED', continuationDone: false },
    }))
      await this.advance(task);
    for (const entry of await this.db.publication.findMany({
      where: { status: 'SCHEDULED' },
    }))
      await this.publishing.enqueue(entry);
  }
  async advance(task: Task) {
    try {
      await this.continueTask(task);
    } catch {
      await this.db.task.update({
        where: { id: task.id },
        data: {
          error:
            'Etapa concluída; continuação automática pendente. Verifique os limites, serviços e trechos; retome pelo dashboard.',
        },
      });
    }
  }
  async continueTask(task: Task) {
    if (!task.autoRun || task.continuationDone || task.status !== 'COMPLETED')
      return;
    if (task.operation === 'download') {
      const result = task.result as { path: string };
      const next = await this.db.task.upsert({
        where: { renderKey: `auto-transcribe-${task.id}` },
        create: {
          sourceId: task.sourceId,
          operation: 'transcribe',
          payload: { path: result.path },
          autoRun: true,
          parentId: task.id,
          renderKey: `auto-transcribe-${task.id}`,
        },
        update: {},
      });
      if (next.status === 'QUEUED')
        await this.queue.add('transcribe', {}, { jobId: next.id });
    } else if (task.operation === 'transcribe') {
      await this.selection.enqueue(task.id, true);
    } else if (task.operation === 'select') {
      const { clips } = task.result as unknown as { clips: { id: string }[] };
      if (!clips.length)
        throw new UnrecoverableError(
          'Nenhum trecho aprovado para renderização automática',
        );
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
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 429
      )
        throw new UnrecoverableError(
          `Worker rejeitou a tarefa (${response.status})`,
        );
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
  async artifact(@Param('id') id: string, @Param('kind') kind: string) {
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
        },
        signal: AbortSignal.timeout(600000),
      },
    );
    if (!response.ok || !response.body)
      throw new NotFoundException('Artefato indisponível');
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
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  @Post('sources')
  source(@Body() body: unknown) {
    return this.pipeline.db.source.create({
      data: { ...parse(sourceSchema, body), verifiedAt: new Date() },
    });
  }
  @Post('jobs')
  async job(@Body() body: unknown) {
    const { sourceId, operation, autoRun, ...payload } = parse(jobSchema, body);
    const source = await this.pipeline.db.source.findUnique({
      where: { id: sourceId },
    });
    if (!source || !source.commercialUseVerified)
      throw new NotFoundException('Fonte autorizada não encontrada');
    const task = await this.pipeline.db.task.create({
      data: { sourceId, operation, payload, autoRun },
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
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  @Get('jobs/:id')
  async status(@Param('id') id: string) {
    const task = await this.pipeline.db.task.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Tarefa não encontrada');
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
