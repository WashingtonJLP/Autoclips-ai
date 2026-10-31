import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pipeline } from '../src/pipeline';

function fixture() {
  const tasks = [
    {
      id: 'root',
      parentId: null,
      status: 'COMPLETED',
      operation: 'transcribe',
      result: { segments: [] },
      error: null,
      autoRun: true,
      deletedAt: null,
      updatedAt: new Date(),
    },
    {
      id: 'clip',
      parentId: 'root',
      status: 'FAILED',
      operation: 'clip',
      result: null,
      error: 'Falha transitória',
      autoRun: false,
      deletedAt: null,
      updatedAt: new Date(),
    },
  ];
  const writes: unknown[] = [],
    queued: unknown[] = [];
  const pipeline = {
    db: {
      task: {
        findUnique: async () => tasks[0],
        findMany: async () => tasks,
        updateMany: async (value: unknown) => {
          writes.push(value);
          return { count: 1 };
        },
      },
    },
    queue: {
      getJob: async (): Promise<null | { getState: () => Promise<string> }> =>
        null,
      add: async (...args: unknown[]) => {
        queued.push(args);
      },
    },
  };
  return { pipeline, tasks, writes, queued };
}

test('recuperação reenfileira somente a etapa falha e preserva transcrição concluída', async () => {
  const { pipeline, writes, queued } = fixture();
  assert.deepEqual(
    await Pipeline.prototype.retryProduction.call(
      pipeline as unknown as Pipeline,
      'root',
    ),
    { id: 'root', retried: 1 },
  );
  assert.equal(writes.length, 1);
  assert.equal((writes[0] as { where: { id: string } }).where.id, 'clip');
  assert.equal((queued[0] as unknown[])[0], 'clip');
});

test('recuperação respeita pausa do 429 externo sem alterar tarefas', async () => {
  const { pipeline, tasks, writes, queued } = fixture();
  tasks[1].error = 'Limite da origem (429)';
  await assert.rejects(
    () =>
      Pipeline.prototype.retryProduction.call(
        pipeline as unknown as Pipeline,
        'root',
      ),
    /um minuto/,
  );
  assert.equal(writes.length, 0);
  assert.equal(queued.length, 0);
});

test('recuperação aguarda job antigo ativo antes de modificar qualquer etapa', async () => {
  const { pipeline, writes, queued } = fixture();
  pipeline.queue.getJob = async () => ({ getState: async () => 'active' });
  await assert.rejects(
    () =>
      Pipeline.prototype.retryProduction.call(
        pipeline as unknown as Pipeline,
        'root',
      ),
    /encerrando/,
  );
  assert.equal(writes.length, 0);
  assert.equal(queued.length, 0);
});
