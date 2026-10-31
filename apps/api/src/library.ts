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
    include: { source: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const productions = tasks
    .filter(
      (t) =>
        !t.deletedAt &&
        !t.parentId &&
        ['download', 'transcribe', 'clip'].includes(t.operation),
    )
    .map((root) => {
      const ids = chainIds(tasks, root.id);
      const history = tasks.filter((t) => ids.has(t.id));
      const chain = history.filter((t) => !t.deletedAt);
      const failed = chain.find((t) => t.status === 'FAILED');
      const results = chain.filter(
        (t) =>
          t.operation === 'clip' &&
          t.status === 'COMPLETED' &&
          !!(t.result as { video_path?: string } | null)?.video_path,
      );
      const active = chain.find(
        (t) =>
          ['QUEUED', 'PROCESSING', 'RETRYING'].includes(t.status) ||
          (t.autoRun &&
            t.status === 'COMPLETED' &&
            !t.continuationDone &&
            !t.error),
      );
      const editorial = root.editorial as {
        mediaTitle?: string;
        assetId?: string;
        requestKey?: string;
        options?: Record<string, unknown>;
      } | null;
      const empty = chain.find(
        (t) =>
          ['NO_SPEECH', 'NO_ELIGIBLE'].includes(
            String((t.result as { outcome?: string } | null)?.outcome),
          ) || /nenhum(a)? (fala|trecho)/i.test(t.error ?? ''),
      );
      const interrupted = chain.find(
        (t) => t.error && t.status === 'COMPLETED' && !empty && !active,
      );
      const removed = history.filter(
        (t) => t.deletedAt && t.operation === 'clip',
      ).length;
      const status =
        root.status === 'CANCELLED'
          ? 'CANCELLED'
          : failed || interrupted
            ? 'FAILED'
            : active
              ? active.status === 'COMPLETED'
                ? 'PROCESSING'
                : active.status
              : results.length
                ? 'COMPLETED'
                : removed
                  ? 'CLIPS_REMOVED'
                  : 'EMPTY';
      const stage =
        failed ??
        interrupted ??
        active ??
        empty ??
        chain.find((t) => t.operation === 'clip') ??
        root;
      const message =
        status === 'EMPTY'
          ? (empty?.error ??
            (empty?.result as { message?: string } | null)?.message ??
            'Nenhum trecho elegível foi gerado. Ajuste as preferências ou escolha outro vídeo.')
          : status === 'CLIPS_REMOVED'
            ? 'Os cortes desta produção foram excluídos.'
            : status === 'CANCELLED'
              ? 'Produção cancelada.'
              : (failed?.error ?? interrupted?.error ?? active?.error ?? null);
      return {
        id: root.id,
        title: editorial?.mediaTitle ?? root.source.name,
        createdAt: root.createdAt,
        testContent: root.testContent,
        status,
        error: status === 'FAILED' ? message : null,
        message,
        currentStage: stage.operation,
        startOperation: root.operation,
        canRetry: ['FAILED', 'CANCELLED'].includes(status),
        hasActive: !!active,
        assetId: editorial?.assetId,
        options: editorial?.options,
        requestKey: editorial?.requestKey,
        clips: results,
        steps: chain.map((t) => ({
          id: t.id,
          operation: t.operation,
          status: t.status,
          error: t.error,
        })),
      };
    });
  const visibleIds = new Set(
    productions.flatMap((p) => p.clips.map((t) => t.id)),
  );
  const clips = tasks.filter((t) => !t.deletedAt && visibleIds.has(t.id));
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
