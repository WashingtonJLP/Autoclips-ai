'use client';
import { useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Task, title } from '../shared/models';
import Icon from './glyph';
const VideoPlayer = dynamic(() => import('./video-player'), {
  ssr: false,
  loading: () => <p role="status">Carregando vídeo…</p>,
});
export default function Preview({
  task,
  onClose,
}: {
  task: Task | null;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!task) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [task]);
  if (!task) return null;
  return (
    <dialog
      ref={dialog}
      className="preview-dialog"
      aria-labelledby="preview-title"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id="preview-title">{title(task)}</h2>
        <button
          autoFocus
          className="icon-button"
          onClick={onClose}
          aria-label="Fechar prévia"
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="preview-body">
        <VideoPlayer id={task.id} title={title(task)} />
        <div className="preview-details">
          <span className="eyebrow">PRONTO PARA REVISÃO</span>
          <h3>{title(task)}</h3>
          {task.editorial?.selectionOrigin === 'heuristic' && (
            <p className="notice">
              Heurística local: sem análise semântica por IA.
            </p>
          )}
          {task.editorial?.selectionProvider && (
            <p>
              Seleção: {task.editorial.selectionProvider} ·{' '}
              {task.editorial.selectionModel} · Nota:{' '}
              {task.editorial.score?.toFixed(2) ?? '—'}/10
            </p>
          )}
          {task.editorial?.reason && <p>{task.editorial.reason}</p>}
          {task.editorial?.selectionWarnings?.map((w) => (
            <p className="notice" key={w}>
              {w}
            </p>
          ))}
          {task.editorial?.simulated && (
            <p className="notice">
              Seleção simulada para teste; não é análise semântica real.
            </p>
          )}
          <p className="description">
            {task.editorial?.description ??
              'Revise o vídeo e suas legendas antes de agendar.'}
          </p>
          <div className="stack">
            <a
              className="button primary"
              href={`/api/backend/jobs/${task.id}/artifacts/video`}
              download
            >
              Baixar MP4
            </a>
            {task.result?.subtitle_path ? (
              <a
                className="button secondary"
                href={`/api/backend/jobs/${task.id}/artifacts/subtitles`}
                download
              >
                Baixar SRT
              </a>
            ) : null}
            <Link
              className="button secondary"
              href={`/criar?fonte=${task.sourceId}`}
              prefetch={false}
            >
              Gerar novos cortes
            </Link>
            <Link
              className="button secondary"
              href={`/publicacoes?video=${task.id}`}
              prefetch={false}
            >
              Agendar simulação
              <Icon name="arrow" size={16} />
            </Link>
          </div>
        </div>
      </div>
    </dialog>
  );
}
