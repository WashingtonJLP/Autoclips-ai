import Link from 'next/link';
import { Task, Source, date, title, operationNames } from '../shared/models';
import { Badge, Advanced } from './ui';
export default function TaskList({
  tasks,
  sources = [],
}: {
  tasks: Task[];
  sources?: Source[];
}) {
  return (
    <div className="task-list">
      {tasks.map((task) => (
        <article key={task.id} className="task-row">
          <div className="task-symbol">
            {task.operation === 'clip'
              ? '▶'
              : task.operation === 'select'
                ? '✦'
                : '↗'}
          </div>
          <div className="task-main">
            <h3>{title(task, sources)}</h3>
            <p className="muted small">
              {operationNames[task.operation]} · {date(task.createdAt)}
            </p>
            {task.error && <p className="inline-error">{task.error}</p>}
          </div>
          <Badge status={task.status} />
          <Link
            className="button subtle"
            href={`/criar?producao=${task.id}`}
            prefetch={false}
          >
            Acompanhar
          </Link>
          <Advanced value={task} title="Detalhes técnicos" />
        </article>
      ))}
    </div>
  );
}
