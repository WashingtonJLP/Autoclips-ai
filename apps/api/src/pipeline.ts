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
} from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Queue, Worker, UnrecoverableError } from 'bullmq';
import { jobSchema, parse, sourceSchema } from './contracts';
import { SelectionPipeline } from './selection/pipeline';

@Injectable()
export class Pipeline implements OnModuleInit, OnModuleDestroy {
  readonly db = new PrismaClient({
    adapter: new PrismaPg({
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
  worker?: Worker;
  async onModuleInit() {
    await this.db.$connect();
    await this.queue.setGlobalConcurrency(1);
    this.worker = new Worker(
      'media',
      async (job) => {
        if (job.name === 'echo')
          return this.callWorker('/echo', { message: 'Teste BullMQ' });
        const record = await this.db.task.findUniqueOrThrow({
          where: { id: job.id },
          include: { source: true },
        });
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
  }
  async callWorker(path: string, body?: unknown, timeout = 5000) {
    const response = await fetch(
      `${process.env.WORKER_URL ?? 'http://127.0.0.1:8000'}${path}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    const { sourceId, operation, ...payload } = parse(jobSchema, body);
    const source = await this.pipeline.db.source.findUnique({
      where: { id: sourceId },
    });
    if (!source || !source.commercialUseVerified)
      throw new NotFoundException('Fonte autorizada não encontrada');
    const task = await this.pipeline.db.task.create({
      data: { sourceId, operation, payload },
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
