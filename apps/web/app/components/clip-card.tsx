import { Task, title, duration, date } from '../shared/models';
import Thumbnail from './thumbnail';
import { Badge } from './ui';
export default function ClipCard({
  task,
  onPreview,
  onRemove,
}: {
  task: Task;
  onPreview: (task: Task) => void;
  onRemove?: (task: Task) => void;
}) {
  return (
    <article className="clip-card">
      <Thumbnail
        id={task.id}
        label={title(task)}
        onClick={() => {
          if (task.status === 'COMPLETED') onPreview(task);
        }}
      />
      <div className="clip-card-body">
        <div className="row">
          <Badge status={task.status} />
          <span className="muted small">{duration(task)}</span>
        </div>
        <h3>
          <button className="text-button" onClick={() => onPreview(task)}>
            {title(task)}
          </button>
        </h3>
        {task.editorial?.selectionOrigin === 'heuristic' && (
          <span className="badge">Heurística local · revisar</span>
        )}
        {task.editorial?.selectionOrigin === 'llm' && (
          <span className="badge">IA · {task.editorial.selectionProvider}</span>
        )}
        {task.editorial?.simulated && (
          <span className="badge">Seleção de teste (mock)</span>
        )}
        <p className="muted small">{date(task.createdAt)}</p>
        {task.status === 'COMPLETED' && (
          <a
            className="button subtle"
            href={`/api/backend/jobs/${task.id}/artifacts/video`}
            download
          >
            Baixar MP4
          </a>
        )}
        {onRemove && (
          <button className="button subtle" onClick={() => onRemove(task)}>
            Excluir corte
          </button>
        )}
        {task.status === 'COMPLETED' && !!task.result?.subtitle_path && (
          <a
            className="button subtle"
            href={`/api/backend/jobs/${task.id}/artifacts/subtitles`}
            download
          >
            Baixar SRT
          </a>
        )}
      </div>
    </article>
  );
}
