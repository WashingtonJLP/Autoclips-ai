'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api, useAction } from '../shared/api';
import { Source, Task } from '../shared/models';
import { Feedback } from './ui';
import Icon from './glyph';
export default function ProductionForm({
  sources,
  tasks,
  onCreated,
  initialSource,
}: {
  sources: Source[];
  tasks: Task[];
  onCreated: (task: Task) => void;
  initialSource?: string;
}) {
  const [sourceId, setSourceId] = useState(initialSource ?? ''),
    [manual, setManual] = useState(false),
    action = useAction();
  const paths = [
    ...new Set(
      tasks
        .filter((t) => !sourceId || t.sourceId === sourceId)
        .map((t) => t.payload.path)
        .filter((p): p is string => !!p),
    ),
  ];
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const task = await action.run(() => {
      const body: Record<string, unknown> = {
        sourceId: form.get('sourceId'),
        path: String(form.get('path')).trim(),
        operation: manual ? 'clip' : 'transcribe',
      };
      if (manual) {
        body.start = Number(form.get('start'));
        body.end = Number(form.get('end'));
        const segments = String(form.get('segments') ?? '').trim();
        if (segments) body.segments = JSON.parse(segments);
        body.burn_subtitles = form.get('burn_subtitles') === 'on';
      } else body.autoRun = form.get('autoRun') === 'on';
      return api<Task>('jobs', body);
    }, 'Produção iniciada. Acompanhe as etapas ao lado.');
    if (task) onCreated(task);
  }
  return (
    <form className="panel" onSubmit={(e) => void submit(e)}>
      <Feedback error={action.error} message={action.message} />
      <section className="form-section">
        <h2>
          <span className="step-number">1</span>Escolha a fonte
        </h2>
        <label>
          Fonte autorizada
          <select
            name="sourceId"
            required
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
          >
            <option value="">Selecione uma fonte</option>
            {sources
              .filter((s) => s.commercialUseVerified)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.license}
                </option>
              ))}
          </select>
        </label>
        <p className="muted small" style={{ marginTop: 12 }}>
          Ainda não cadastrou?{' '}
          <Link href="/fontes" className="text-link" prefetch={false}>
            Gerenciar fontes →
          </Link>
        </p>
      </section>
      <section className="form-section">
        <h2>
          <span className="step-number">2</span>Selecione sua mídia
        </h2>
        <label>
          Arquivo da produção
          <input
            name="path"
            list="known-media"
            placeholder="fixtures/meu-video.mp4"
            required
            maxLength={500}
            autoComplete="off"
          />
          <datalist id="known-media">
            {paths.map((path) => (
              <option key={path} value={path} />
            ))}
          </datalist>
          <small>
            Escolha um caminho já utilizado ou informe um arquivo na pasta
            media. Para descobrir e baixar vídeos autorizados, use Fontes.
          </small>
        </label>
      </section>
      <section className="form-section">
        <h2>
          <span className="step-number">3</span>Como deseja produzir?
        </h2>
        <label>
          Processamento
          <select
            value={manual ? 'clip' : 'transcribe'}
            onChange={(e) => setManual(e.target.value === 'clip')}
          >
            <option value="transcribe">Transcrever e criar cortes</option>
            <option value="clip">Corte manual por intervalo</option>
          </select>
        </label>
        {!manual ? (
          <label className="check-label" style={{ marginTop: 18 }}>
            <input name="autoRun" type="checkbox" defaultChecked />
            <span>
              Concluir automaticamente
              <small>
                Selecionar trechos, sugerir títulos e renderizar com legendas.
                Desmarque para revisar a transcrição primeiro.
              </small>
            </span>
          </label>
        ) : (
          <>
            <div className="form-grid" style={{ marginTop: 18 }}>
              <label>
                Início (segundos)
                <input
                  name="start"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                />
              </label>
              <label>
                Fim (segundos)
                <input
                  name="end"
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                />
              </label>
            </div>
            <details className="advanced">
              <summary>Legendas do corte manual</summary>
              <label style={{ marginTop: 12 }}>
                Segmentos revisados (JSON)
                <textarea
                  name="segments"
                  placeholder={
                    '[{"start":0,"end":3,"text":"Legenda revisada"}]'
                  }
                />
              </label>
              <label className="check-label">
                <input name="burn_subtitles" type="checkbox" />
                Inserir legendas no vídeo
              </label>
            </details>
          </>
        )}
      </section>
      <button
        className="button primary"
        disabled={action.busy || !sources.length}
      >
        <Icon name="create" size={17} />
        {action.busy ? 'Enviando produção…' : 'Iniciar produção'}
      </button>
    </form>
  );
}
