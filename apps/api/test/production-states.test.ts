import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { library } from '../src/library';
function task(
  id: string,
  operation: string,
  parentId: string | null = null,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    operation,
    parentId,
    status: 'COMPLETED',
    autoRun: false,
    continuationDone: true,
    deletedAt: null,
    error: null,
    source: { name: 'Vídeo' },
    result: null,
    editorial: null,
    createdAt: new Date(),
    ...extra,
  };
}
async function summarize(tasks: ReturnType<typeof task>[]) {
  return library({
    task: { findMany: async () => tasks },
  } as unknown as PrismaClient);
}
test('não confunde ausência de trechos, falha, cancelamento e cortes removidos com sucesso', async () => {
  const root = task('p', 'transcribe');
  const empty = await summarize([
    root,
    task('s', 'select', 'p', {
      result: { clips: [], outcome: 'NO_ELIGIBLE', message: 'Nenhum trecho.' },
    }),
  ]);
  assert.equal(empty.productions[0].status, 'EMPTY');
  assert.equal(empty.productions[0].clips.length, 0);
  const failed = await summarize([
    root,
    task('s', 'select', 'p'),
    task('c', 'clip', 's', { status: 'FAILED', error: 'Falha no FFmpeg' }),
  ]);
  assert.equal(failed.productions[0].status, 'FAILED');
  assert.equal(failed.productions[0].currentStage, 'clip');
  assert.equal(failed.productions[0].canRetry, true);
  const removed = await summarize([
    root,
    task('c', 'clip', 'p', {
      deletedAt: new Date(),
      result: { video_path: 'outputs/video.mp4' },
    }),
  ]);
  assert.equal(removed.productions[0].status, 'CLIPS_REMOVED');
  assert.equal(removed.clips.length, 0);
  const cancelled = await summarize([{ ...root, status: 'CANCELLED' }]);
  assert.equal(cancelled.productions[0].status, 'CANCELLED');
});
test('lista uma produção e conta apenas cortes disponíveis; histórico excluído não reaparece', async () => {
  const rows = [
    task('p', 'download'),
    task('t', 'transcribe', 'p'),
    task('s', 'select', 't'),
    task('c', 'clip', 's', { result: { video_path: 'outputs/a.mp4' } }),
    task('removed', 'clip', 's', {
      deletedAt: new Date(),
      result: { video_path: 'outputs/b.mp4' },
    }),
  ];
  const result = await summarize(rows);
  assert.equal(result.productions.length, 1);
  assert.equal(result.productions[0].status, 'COMPLETED');
  assert.equal(result.productions[0].clips.length, 1);
  assert.equal(result.clips.length, 1);
  const hidden = await summarize(
    rows.map((t) => ({ ...t, deletedAt: new Date() })),
  );
  assert.equal(hidden.productions.length, 0);
  assert.equal(hidden.clips.length, 0);
});
test('ocupação temporária mantém estado de espera em vez de falha', async () => {
  const result = await summarize([
    task('p', 'download', null, {
      status: 'RETRYING',
      error: 'Aguardando worker',
      autoRun: true,
    }),
  ]);
  assert.equal(result.productions[0].status, 'RETRYING');
  assert.equal(result.productions[0].hasActive, true);
  assert.equal(result.productions[0].error, null);
});
