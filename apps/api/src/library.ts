import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaClient, Task } from '@prisma/client';

type Node = Pick<Task, 'id' | 'parentId' | 'result'>;
export function chainIds(tasks: Node[], root: string, followReuse = true) {
  const ids = new Set([root]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) {
      if (task.parentId && ids.has(task.parentId) && !ids.has(task.id)) {
        ids.add(task.id);
        changed = true;
      }
      const reused = (task.result as { reusedTaskId?: unknown } | null)
        ?.reusedTaskId;
      if (
        followReuse &&
        ids.has(task.id) &&
        typeof reused === 'string' &&
        !ids.has(reused)
      ) {
        ids.add(reused);
        changed = true;
      }
    }
  }
  return ids;
}

export async function library(db: PrismaClient) {
  const tasks = await db.task.findMany({
    where: { deletedAt: null },
    include: { source: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const clips = tasks.filter((t) => t.operation === 'clip');
  const productions = tasks
    .filter(
      (t) =>
        !t.parentId && ['download', 'transcribe', 'clip'].includes(t.operation),
    )
    .map((root) => {
      const ids = chainIds(tasks, root.id);
      const chain = tasks.filter((t) => ids.has(t.id));
      const error = chain.find((t) => t.error)?.error ?? null;
      const results = chain.filter((t) => t.operation === 'clip');
      const active = chain.find(
        (t) =>
          ['QUEUED', 'PROCESSING', 'RETRYING'].includes(t.status) ||
          (t.autoRun &&
            t.status === 'COMPLETED' &&
            !t.continuationDone &&
            !t.error),
      );
      const editorial = root.editorial as { mediaTitle?: string } | null;
      return {
        id: root.id,
        title: editorial?.mediaTitle ?? root.source.name,
        createdAt: root.createdAt,
        testContent: root.testContent,
        status:
          (active
            ? active.status === 'COMPLETED'
              ? 'PROCESSING'
              : active.status
            : null) ??
          (chain.some((t) => t.status === 'FAILED') || error
            ? 'FAILED'
            : root.status),
        error,
        clips: results,
        steps: chain.map((t) => ({
          id: t.id,
          operation: t.operation,
          status: t.status,
        })),
      };
    });
  return { productions, clips };
}

// Only owned descendants are removed. Shared steps referenced by another production survive.
export async function removeItem(db: PrismaClient, id: string) {
  return db.$transaction(
    async (tx) => {
      const task = await tx.task.findUnique({ where: { id } });
      if (!task || task.deletedAt)
        throw new NotFoundException('Item não encontrado na Biblioteca');
      if (task.parentId && task.operation !== 'clip')
        throw new BadRequestException(
          'Exclua a produção ou um corte individual.',
        );
      if (!['download', 'transcribe', 'clip'].includes(task.operation))
        throw new BadRequestException(
          'Este registro não é uma produção ou corte da Biblioteca.',
        );
      const all = await tx.task.findMany({
        where: { deletedAt: null },
        select: { id: true, parentId: true, result: true },
      });
      const owned =
        task.operation === 'clip' ? new Set([id]) : chainIds(all, id, false);
      const protectedIds = new Set<string>();
      if (task.operation !== 'clip') {
        for (const external of all.filter((t) => !owned.has(t.id))) {
          const reused = (external.result as { reusedTaskId?: unknown } | null)
            ?.reusedTaskId;
          if (typeof reused === 'string' && owned.has(reused))
            for (const shared of chainIds(all, reused))
              protectedIds.add(shared);
        }
      }
      const ids = [...owned].filter((value) => !protectedIds.has(value));
      const deletedAt = new Date();
      await tx.task.updateMany({
        where: {
          id: { in: ids },
          status: { in: ['QUEUED', 'PROCESSING', 'RETRYING'] },
        },
        data: { status: 'CANCELLED', continuationDone: true },
      });
      for (const entry of await tx.task.findMany({
        where: { id: { in: ids } },
        select: { id: true, renderKey: true },
      }))
        await tx.task.update({
          where: { id: entry.id },
          data: {
            deletedAt,
            renderKey: entry.renderKey
              ? `${entry.renderKey}~deleted~${entry.id}`
              : null,
          },
        });
      await tx.publication.updateMany({
        where: { taskId: { in: ids }, status: 'SCHEDULED' },
        data: { status: 'CANCELLED' },
      });
      return {
        removed: true,
        id,
        removedCount: ids.length,
        undoToken: deletedAt.toISOString(),
      };
    },
    { isolationLevel: 'Serializable' },
  );
}

export async function restoreItem(db: PrismaClient, id: string, token: string) {
  const item = await db.task.findUnique({ where: { id } });
  if (!item?.deletedAt || item.deletedAt.toISOString() !== token)
    throw new NotFoundException('Exclusão não encontrada para desfazer');
  const ids = chainIds(
    await db.task.findMany({ where: { deletedAt: item.deletedAt } }),
    id,
    false,
  );
  await db.$transaction(
    async (tx) => {
      for (const entry of await tx.task.findMany({
        where: { id: { in: [...ids] }, deletedAt: item.deletedAt },
      })) {
        const previousKey = entry.renderKey?.split('~deleted~')[0];
        const collision = previousKey
          ? await tx.task.findUnique({ where: { renderKey: previousKey } })
          : null;
        await tx.task.update({
          where: { id: entry.id },
          data: {
            deletedAt: null,
            ...(previousKey && !collision ? { renderKey: previousKey } : {}),
          },
        });
      }
    },
    { isolationLevel: 'Serializable' },
  );
  return { restored: true };
}
