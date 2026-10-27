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
} from './contracts';
import { createProvider } from './provider';
import { PrismaUsageLedger, selectionTransaction } from './ledger';
import { overlap, SelectionService } from './service';

const selectionPayload = z
  .object({ transcriptionTaskId: z.string().min(1) })
  .strict();
export class SelectionPipeline {
  readonly config = readSelectionConfig();
  readonly provider = createProvider(this.config);
  readonly ledger: PrismaUsageLedger;
  readonly service: SelectionService;
  constructor(
    private readonly db: PrismaClient,
    private readonly queue: Queue,
  ) {
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
  async enqueue(transcriptionTaskId: string) {
    const { task } = await this.transcript(transcriptionTaskId);
    const selection = await this.db.task.create({
      data: {
        sourceId: task.sourceId,
        operation: 'select',
        payload: { transcriptionTaskId },
      },
    });
    // Uma tentativa: nenhuma chamada LLM repetida automaticamente após falha desconhecida.
    await this.queue.add('select', {}, { jobId: selection.id, attempts: 1 });
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
    const rendered = await this.db.task.findMany({
      where: {
        sourceId: task.sourceId,
        operation: 'clip',
        status: { in: ['QUEUED', 'PROCESSING', 'RETRYING', 'COMPLETED'] },
        payload: { path: ['path'], equals: path },
      },
      select: { payload: true },
    });
    const excluded = rendered.flatMap((r) => {
      const p = r.payload as Record<string, unknown>;
      return typeof p.start === 'number' &&
        typeof p.end === 'number' &&
        p.end > p.start
        ? [{ start: p.start, end: p.end }]
        : [];
    });
    return {
      transcriptionTaskId,
      ...(await this.service.select(task.id, transcript, excluded)),
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
    const result = selection.result as unknown as { clips: SelectedClip[] };
    const candidate = result.clips.find((c) => c.id === candidateId);
    if (!candidate) throw new NotFoundException('Trecho não encontrado');
    if (
      selection.sourceId !== task.sourceId ||
      transcript.segments[candidate.first]?.start !== candidate.start ||
      transcript.segments[candidate.last]?.end !== candidate.end
    )
      throw new BadRequestException('Seleção incompatível com a transcrição');
    const renderKey = createHash('sha256')
      .update(
        JSON.stringify([task.sourceId, path, candidate.start, candidate.end]),
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
      segments: transcript.segments.filter(
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
          },
          select: { payload: true },
        });
        if (
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
              description: candidate.description,
              selectionTaskId: selection.id,
              candidateId,
            },
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
