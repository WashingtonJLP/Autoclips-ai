export type Source = {
  id: string;
  name: string;
  url: string;
  license: string;
  evidenceUrl: string;
  attribution: string;
  commercialUseVerified: boolean;
  verifiedAt: string;
  evidence?: unknown;
  mediaUrl?: string;
};
export type Task = {
  id: string;
  sourceId: string;
  operation: string;
  status: string;
  payload: {
    path?: string;
    start?: number;
    end?: number;
    [key: string]: unknown;
  };
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  updatedAt?: string;
  editorial?: {
    title: string;
    description: string;
    candidateId?: string;
    simulated?: boolean;
  } | null;
  autoRun?: boolean;
  continuationDone?: boolean;
  parentId?: string | null;
};
export type Publication = {
  id: string;
  taskId: string;
  platform: string;
  status: string;
  scheduledAt: string;
  result?: unknown;
};
export type Platforms = {
  mode: string;
  realPublishingEnabled: boolean;
  accounts: { platform: string; updatedAt: string }[];
  publications: Publication[];
};
export type LlmSettings = {
  provider: string;
  model: string;
  simulated: boolean;
  maxInputTokens: number;
  maxOutputTokens: number;
  dailyTokenBudget: number;
  dailyCostMicros: number;
  budget: { committedTokens: string; committedCostMicros: string; day: string };
  [key: string]: unknown;
};
export const statusNames: Record<string, string> = {
  QUEUED: 'Na fila',
  PROCESSING: 'Processando',
  RETRYING: 'Nova tentativa',
  COMPLETED: 'Concluído',
  FAILED: 'Falhou',
  CANCELLED: 'Cancelado',
  SCHEDULED: 'Agendado',
  SIMULATED: 'Simulado',
};
export const operationNames: Record<string, string> = {
  download: 'Coleta de mídia',
  transcribe: 'Transcrição',
  select: 'Seleção de trechos',
  clip: 'Corte vertical',
};
export const active = (task: Task) =>
  ['QUEUED', 'PROCESSING', 'RETRYING'].includes(task.status);
export function title(task: Task, sources: Source[] = []) {
  return (
    task.editorial?.title ||
    sources.find((s) => s.id === task.sourceId)?.name ||
    task.payload.path?.split('/').at(-1) ||
    operationNames[task.operation] ||
    'Produção'
  );
}
export function matchesTask(task: Task, sources: Source[], query: string) {
  const search = query.trim().toLocaleLowerCase('pt-BR');
  return [
    title(task, sources),
    sources.find((source) => source.id === task.sourceId)?.name ?? '',
  ].some((value) => value.toLocaleLowerCase('pt-BR').includes(search));
}
export function duration(task: Task) {
  const value =
    Number(task.result?.end ?? task.payload.end) -
    Number(task.result?.start ?? task.payload.start);
  return Number.isFinite(value) && value > 0
    ? `${value.toFixed(1).replace('.', ',')} s`
    : typeof task.result?.duration === 'number'
      ? `${task.result.duration.toFixed(1).replace('.', ',')} s`
      : '—';
}
export function date(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}
export function paginate<T>(items: T[], page: number, size = 8) {
  const pages = Math.max(1, Math.ceil(items.length / size)),
    current = Math.min(Math.max(1, page), pages);
  return {
    items: items.slice((current - 1) * size, current * size),
    current,
    pages,
    total: items.length,
  };
}
export function descendants(tasks: Task[], rootId: string) {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks)
      if (task.parentId && ids.has(task.parentId) && !ids.has(task.id)) {
        ids.add(task.id);
        changed = true;
      }
    for (const task of tasks) {
      const reused = task.result?.reusedTaskId;
      if (ids.has(task.id) && typeof reused === 'string' && !ids.has(reused)) {
        ids.add(reused);
        changed = true;
      }
    }
  }
  return tasks.filter((t) => ids.has(t.id));
}
