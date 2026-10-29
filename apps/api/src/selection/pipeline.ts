import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClient, Task } from '@prisma/client';
import { Queue } from 'bullmq';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { jobSchema, parse } from '../contracts';
import {
  readSelectionConfig,
  transcriptSchema,
  SelectedClip,
  selectionVersion,
  selectionPolicy,
} from './contracts';
import { createProvider, UnavailableProvider, LlmProvider } from './provider';
import { PrismaUsageLedger, selectionTransaction } from './ledger';
import { overlap, SelectionService } from './service';
import { captionSegments } from './captions';
import { productionOptions } from '../production';
import { hash } from '../connectors';
import { sentenceSegments } from './sentences';

const selectionPayload = z
  .object({ transcriptionTaskId: z.string().min(1) })
  .strict();
export class SelectionPipeline {
  readonly config = readSelectionConfig();
  readonly provider: LlmProvider;
  readonly ledger: PrismaUsageLedger;
  readonly service: SelectionService;
  constructor(
    private readonly db: PrismaClient,
    private readonly queue: Queue,
  ) {
    try {
      this.provider = createProvider(this.config);
    } catch (error) {
      this.provider = new UnavailableProvider(
        this.config.provider,
        error instanceof Error ? error.message : 'Provedor não configurado',
      );
    }
    this.ledger = new PrismaUsageLedger(db);
    this.service = new SelectionService(
      this.provider,
      this.ledger,
      this.config,
    );
  }
  async configuration() {
    return {
      ...this.config,
      simulated: this.provider.simulated,
      available: !(this.provider instanceof UnavailableProvider),
      selectionVersion,
      budget: await this.ledger.summary(),
    };
  }
  private async transcript(id: string) {
    const task = await this.db.task.findUnique({
      where: { id },
      include: { source: true },
    });
    if (!task || task.operation !== 'transcribe' || task.status !== 'COMPLETED')
      throw new NotFoundException('Transcrição concluída não encontrada');
    if (!task.source.commercialUseVerified)
      throw new BadRequestException('Autorização comercial ausente');
    const transcript = transcriptSchema.parse(task.result);
    const payload = parse(jobSchema, {
      sourceId: task.sourceId,
      operation: 'transcribe',
      ...(task.payload as Record<string, unknown>),
    });
    return { task, transcript, path: payload.path };
  }
  async enqueue(transcriptionTaskId: string, autoRun = false) {
    const { task, transcript, path } =
      await this.transcript(transcriptionTaskId);
    const editorial = task.editorial as {
      options?: unknown;
      reprocess?: boolean;
    } | null;
    const effectiveConfig = {
      ...this.config,
      ...(editorial?.options ? productionOptions.parse(editorial.options) : {}),
    };
    const renderKey = `selection-${hash([
      task.sourceId,
      path,
      transcript,
      selectionPolicy(effectiveConfig),
      !(this.provider instanceof UnavailableProvider),
      editorial?.reprocess ? task.id : null,
    ])}`;
    const data = {
      sourceId: task.sourceId,
      operation: 'select',
      payload: { transcriptionTaskId },
      autoRun,
      parentId: task.id,
      editorial:
        (task.editorial as import('@prisma/client').Prisma.InputJsonValue) ??
        undefined,
    };
    const selection = await this.db.task.upsert({
      where: { renderKey },
      create: { ...data, renderKey },
      update: autoRun ? { autoRun: true } : {},
    });
    if (selection.parentId !== task.id)
      await this.db.task.update({
        where: { id: task.id },
        data: {
          result: {
            ...(task.result as Record<
              string,
              import('@prisma/client').Prisma.InputJsonValue
            >),
            reusedTaskId: selection.id,
          },
        },
      });
    // Uma tentativa: nenhuma chamada LLM repetida automaticamente após falha desconhecida.
    if (selection.status === 'QUEUED')
      await this.queue.add('select', {}, { jobId: selection.id, attempts: 1 });
    if (
      autoRun &&
      selection.status === 'COMPLETED' &&
      !selection.continuationDone
    )
      await this.queue.add(
        'continuation',
        { taskId: selection.id },
        { jobId: `select-continue-${selection.id}` },
      );
    return selection;
  }
  async execute(task: Task) {
    const { transcriptionTaskId } = selectionPayload.parse(task.payload);
    const {
      task: original,
      transcript,
      path,
    } = await this.transcript(transcriptionTaskId);
    if (task.sourceId !== original.sourceId)
      throw new BadRequestException('Fonte incompatível');
    const options = (task.editorial as { options?: unknown } | null)?.options;
    const settingsKey = hash([
      selectionVersion,
      options ?? {},
      this.config.provider,
      this.config.model,
    ]);
    const rendered = await this.db.task.findMany({
      where: {
        sourceId: task.sourceId,
        operation: 'clip',
        status: { in: ['QUEUED', 'PROCESSING', 'RETRYING', 'COMPLETED'] },
        payload: { path: ['path'], equals: path },
        AND: [
          {
            editorial: {
              path: ['selectionOrigin'],
              equals: this.provider.simulated ? 'mock' : 'llm',
            },
          },
        ],
        ...(settingsKey
          ? { editorial: { path: ['settingsKey'], equals: settingsKey } }
          : {}),
      },
      select: { payload: true },
    });
    const reprocess = (task.editorial as { reprocess?: boolean } | null)
      ?.reprocess;
    const excluded = reprocess
      ? []
      : rendered.flatMap((r) => {
          const p = r.payload as Record<string, unknown>;
          return typeof p.start === 'number' &&
            typeof p.end === 'number' &&
            p.end > p.start
            ? [{ start: p.start, end: p.end }]
            : [];
        });
    const config = options
      ? { ...this.config, ...productionOptions.parse(options) }
      : this.config;
    const service = new SelectionService(this.provider, this.ledger, config);
    return {
      transcriptionTaskId,
      ...(await service.select(
        task.id,
        transcript,
        excluded,
        hash([
          selectionVersion,
          task.sourceId,
          path,
          reprocess ? task.id : null,
        ]),
      )),
    };
  }
  async render(selectionTaskId: string, body: unknown) {
    const { candidateId } = parse(
      z.object({ candidateId: z.string().regex(/^[a-f0-9]{16}$/) }).strict(),
      body,
    );
    const selection = await this.db.task.findUnique({
      where: { id: selectionTaskId },
    });
    if (
      !selection ||
      selection.operation !== 'select' ||
      selection.status !== 'COMPLETED'
    )
      throw new NotFoundException('Seleção concluída não encontrada');
    const { transcriptionTaskId } = selectionPayload.parse(selection.payload);
    const { task, transcript, path } =
      await this.transcript(transcriptionTaskId);
    const result = selection.result as unknown as {
      clips: SelectedClip[];
      version?: number;
      selectionOrigin?: string;
      provider?: string;
      model?: string;
      warnings?: string[];
    };
    const units =
      result.version === 2 ? sentenceSegments(transcript) : transcript.segments;
    const candidate = result.clips.find((c) => c.id === candidateId);
    if (!candidate) throw new NotFoundException('Trecho não encontrado');
    if (
      selection.sourceId !== task.sourceId ||
      units[candidate.first]?.start !== candidate.start ||
      units[candidate.last]?.end !== candidate.end
    )
      throw new BadRequestException('Seleção incompatível com a transcrição');
    const renderKey = createHash('sha256')
      .update(
        JSON.stringify([
          task.sourceId,
          path,
          candidate.start,
          candidate.end,
          selectionVersion,
          result.provider ?? this.config.provider,
          result.model ?? this.config.model,
          result.selectionOrigin ?? 'legacy',
          (selection.editorial as { options?: unknown } | null)?.options ??
            null,
          (selection.editorial as { reprocess?: boolean } | null)?.reprocess
            ? selection.id
            : null,
        ]),
      )
      .digest('hex');
    const existing = await this.db.task.findUnique({ where: { renderKey } });
    if (existing) {
      if (existing.status === 'QUEUED')
        await this.queue.add('clip', {}, { jobId: existing.id });
      return existing;
    }
    const payload = {
      path,
      start: candidate.start,
      end: candidate.end,
      segments: captionSegments(transcript).filter(
        (s) => s.start < candidate.end && s.end > candidate.start,
      ),
      burn_subtitles: true,
    };
    parse(jobSchema, {
      sourceId: task.sourceId,
      operation: 'clip',
      ...payload,
    });
    let clip: Task;
    try {
      clip = await selectionTransaction(this.db, async (tx) => {
        const exact = await tx.task.findUnique({ where: { renderKey } });
        if (exact) return exact;
        const previous = await tx.task.findMany({
          where: {
            sourceId: task.sourceId,
            operation: 'clip',
            status: { in: ['QUEUED', 'PROCESSING', 'RETRYING', 'COMPLETED'] },
            payload: { path: ['path'], equals: path },
            AND: [
              {
                editorial: {
                  path: ['selectionOrigin'],
                  equals:
                    result.selectionOrigin ??
                    (this.provider.simulated ? 'mock' : 'llm'),
                },
              },
            ],
            ...((selection.editorial as { options?: unknown } | null)?.options
              ? {
                  editorial: {
                    path: ['settingsKey'],
                    equals: hash([
                      selectionVersion,
                      (selection.editorial as { options: unknown }).options,
                      this.config.provider,
                      this.config.model,
                    ]),
                  },
                }
              : {}),
          },
          select: { payload: true },
        });
        if (
          !(selection.editorial as { reprocess?: boolean } | null)?.reprocess &&
          previous.some((p) => {
            const payload = p.payload as Record<string, unknown>;
            return (
              typeof payload.start === 'number' &&
              typeof payload.end === 'number' &&
              payload.end > payload.start &&
              overlap(candidate, { start: payload.start, end: payload.end }) >=
                0.65
            );
          })
        )
          throw new ConflictException(
            'Já existe um corte excessivamente semelhante para esta mídia',
          );
        return tx.task.create({
          data: {
            sourceId: task.sourceId,
            operation: 'clip',
            renderKey,
            payload,
            editorial: {
              title: candidate.title,
              description: `${candidate.description}\n\nFonte: ${task.source.url}\n${task.source.attribution}\nLicença: ${task.source.license}\nEvidência: ${task.source.evidenceUrl}`,
              selectionTaskId: selection.id,
              candidateId,
              settingsKey: hash([
                selectionVersion,
                (selection.editorial as { options?: unknown } | null)
                  ?.options ?? {},
                this.config.provider,
                this.config.model,
              ]),
              selectionOrigin:
                result.selectionOrigin ??
                (this.provider.simulated ? 'mock' : 'llm'),
              selectionProvider: result.provider ?? this.provider.name,
              selectionModel: result.model ?? this.config.model,
              selectionWarnings: result.warnings ?? [],
              reason:
                candidate.reason ??
                'Resultado legado sem justificativa registrada.',
              score: candidate.score,
              scores: candidate.scores,
              simulated:
                (selection.result as { simulated?: boolean } | null)
                  ?.simulated ?? this.provider.simulated,
            },
            parentId: selection.id,
          },
        });
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw new ConflictException('Não foi possível reservar a renderização');
    }
    if (clip.status === 'QUEUED')
      await this.queue.add('clip', {}, { jobId: clip.id });
    return clip;
  }
}
