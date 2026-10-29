import { Task, title, duration, date } from '../shared/models';
import Thumbnail from './thumbnail';
import { Badge } from './ui';
export default function ClipCard({
  task,
  onPreview,
}: {
  task: Task;
  onPreview: (task: Task) => void;
}) {
  return (
    <article className="clip-card">
      <Thumbnail
        id={task.id}
        label={title(task)}
        onClick={() => onPreview(task)}
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
        {task.editorial?.simulated && (
          <span className="badge">Seleção de teste (mock)</span>
        )}
        <p className="muted small">{date(task.createdAt)}</p>
      </div>
    </article>
  );
}
