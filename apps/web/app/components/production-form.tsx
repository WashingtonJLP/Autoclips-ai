'use client';
import { useEffect, useRef, useState } from 'react';
import { api, useAction } from '../shared/api';
import { Task } from '../shared/models';
import { Feedback } from './ui';
import SelectionCriteria from './selection-criteria';

export type Asset = {
  id: string;
  title: string;
  platform: string;
  author?: string;
  path?: string;
  accessible: boolean;
  rightsConfirmed: boolean;
  duration?: number;
  reason?: string;
  testContent?: boolean;
  thumbnailUrl?: string;
  availability?: { kind: string; message: string };
};
export function MediaAnalysis({
  asset,
  onUpload,
}: {
  asset: Asset;
  onUpload: () => void;
}) {
  return (
    <article className="notice" aria-label="Vídeo selecionado">
      {asset.thumbnailUrl && (
        <img
          src={asset.thumbnailUrl}
          alt={`Miniatura de ${asset.title}`}
          width={240}
          height={135}
        />
      )}
      <h3>{asset.title}</h3>
      <p>
        {asset.platform}
        {asset.author ? ` · ${asset.author}` : ''}
        {asset.duration
          ? ` · ${Math.floor(asset.duration / 60)}:${String(Math.round(asset.duration) % 60).padStart(2, '0')}`
          : ''}
      </p>
      <p>
        {asset.path
          ? 'Arquivo já importado'
          : asset.accessible
            ? 'O arquivo será obtido durante a produção.'
            : 'Arquivo não disponível nesta origem.'}
      </p>
      {!asset.path && !asset.accessible && (
        <button type="button" className="button" onClick={onUpload}>
          Enviar arquivo
        </button>
      )}
    </article>
  );
}
const defaults = {
  maxClips: 3,
  maxDuration: 60,
  language: 'auto',
  burnSubtitles: true,
};
export default function ProductionForm({
  onCreated,
  initialAsset,
  inProgress = false,
}: {
  onCreated: (task: Task) => void;
  initialAsset?: string;
  inProgress?: boolean;
}) {
  const [mode, setMode] = useState(initialAsset ? 'imported' : 'link');
  const [link, setLink] = useState('');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selected, setSelected] = useState(initialAsset ?? '');
  const [filter, setFilter] = useState('');
  const [showTests, setShowTests] = useState(false);
  const [prefs, setPrefs] = useState(defaults);
  const [edited, setEdited] = useState(false);
  const [inspected, setInspected] = useState<Asset | null>(null);
  const locked = useRef(false);
  const action = useAction();
  useEffect(() => {
    const controller = new AbortController();
    void api<Asset[]>('media', undefined, controller.signal)
      .then((items) => {
        setAssets(items);
        if (items.find((a) => a.id === initialAsset)?.testContent)
          setShowTests(true);
      })
      .catch(() => {});
    try {
      const saved = JSON.parse(
        localStorage.getItem('autoclips:preferences') ?? 'null',
      );
      if (saved) setPrefs({ ...defaults, ...saved });
    } catch {}
    return () => controller.abort();
  }, [initialAsset]);
  function preference(value: Partial<typeof defaults>) {
    const next = { ...prefs, ...value };
    setPrefs(next);
    localStorage.setItem('autoclips:preferences', JSON.stringify(next));
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    locked.current = true;
    const form = new FormData(event.currentTarget);
    try {
      await action.run(async () => {
        let assetId = selected;
        if (mode === 'upload') {
          const file = form.get('file') as File;
          const extension = file?.name.split('.').at(-1)?.toLowerCase();
          if (!file?.size || file.size > 512 * 1024 ** 2)
            throw Error('Escolha um vídeo de até 512 MB.');
          if (!['mp4', 'webm', 'mov'].includes(extension ?? ''))
            throw Error('Escolha MP4, WebM ou MOV.');
          const query = new URLSearchParams({
            extension: extension!,
            name: file.name,
            testContent: String(form.get('testContent') === 'on'),
          });
          const response = await fetch(`/api/backend/media/upload?${query}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: file,
          });
          const asset = await response.json();
          if (!response.ok)
            throw Error(asset.message ?? 'Não foi possível enviar o arquivo.');
          assetId = asset.id;
          setInspected(asset);
          setSelected(asset.id);
          setAssets((items) => [
            asset,
            ...items.filter((a) => a.id !== asset.id),
          ]);
        }
        const task = await api<Task>('productions', {
          ...(mode === 'link' ? { url: link.trim() } : { assetId }),
          autoRun: true,
          reprocess: form.get('reprocess') === 'on',
          options: {
            ...prefs,
            minDuration: Number(form.get('minDuration') ?? 5),
            criteria: form.getAll('criteria'),
            fallback: form.get('fallback') || 'heuristic',
            ...(form.get('minScore')
              ? { minScore: Number(form.get('minScore')) }
              : {}),
          },
        });
        setEdited(false);
        onCreated(task);
      }, '');
    } finally {
      locked.current = false;
    }
  }
  return (
    <form
      className="panel"
      onSubmit={(e) => void submit(e)}
      onChange={() => setEdited(true)}
      aria-label="Configuração da produção"
    >
      <h2>Configuração</h2>
      <Feedback error={action.error} />
      <div className="row">
        {[
          ['link', 'Colar URL'],
          ['upload', 'Enviar arquivo'],
          ['imported', 'Escolher vídeo existente'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className="button"
            aria-pressed={mode === value}
            disabled={action.busy}
            onClick={() => {
              setMode(value);
              setEdited(true);
              setInspected(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === 'link' && (
        <label>
          URL do vídeo
          <input
            name="url"
            type="url"
            required
            value={link}
            maxLength={2000}
            placeholder="https://www.youtube.com/watch?v=…"
            disabled={action.busy}
            onChange={(e) => setLink(e.target.value)}
          />
        </label>
      )}
      {mode === 'upload' && (
        <label>
          Arquivo de vídeo
          <input
            name="file"
            type="file"
            accept=".mp4,.webm,.mov"
            required
            disabled={action.busy}
          />
          <small>MP4, WebM ou MOV, até 512 MB.</small>
        </label>
      )}
      {mode === 'imported' && (
        <>
          <label>
            Buscar vídeo
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
          <label>
            Vídeo existente
            <select
              required
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Selecione</option>
              {assets
                .filter(
                  (a) =>
                    a.path &&
                    (showTests || !a.testContent) &&
                    `${a.title} ${a.platform}`
                      .toLowerCase()
                      .includes(filter.toLowerCase()),
                )
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                  </option>
                ))}
            </select>
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={showTests}
              onChange={(e) => setShowTests(e.target.checked)}
            />
            Mostrar testes sintéticos
          </label>
        </>
      )}
      {inspected && (
        <MediaAnalysis asset={inspected} onUpload={() => setMode('upload')} />
      )}
      <div className="form-grid">
        <label>
          Quantidade de cortes
          <input
            name="maxClips"
            type="number"
            min={1}
            max={10}
            required
            value={prefs.maxClips}
            onChange={(e) => preference({ maxClips: Number(e.target.value) })}
          />
        </label>
        <label>
          Duração máxima
          <select
            name="maxDuration"
            value={prefs.maxDuration}
            onChange={(e) =>
              preference({ maxDuration: Number(e.target.value) })
            }
          >
            {[30, 60, 90, 180].map((n) => (
              <option key={n} value={n}>
                {n} segundos
              </option>
            ))}
          </select>
        </label>
        <label>
          Idioma
          <select
            name="language"
            value={prefs.language}
            onChange={(e) => preference({ language: e.target.value })}
          >
            <option value="auto">Detectar</option>
            <option value="pt">Português</option>
            <option value="en">Inglês</option>
            <option value="es">Espanhol</option>
          </select>
        </label>
        <label>
          Legendas no vídeo
          <select
            name="burnSubtitles"
            value={String(prefs.burnSubtitles)}
            onChange={(e) =>
              preference({ burnSubtitles: e.target.value === 'true' })
            }
          >
            <option value="true">Com legendas</option>
            <option value="false">Sem legendas</option>
          </select>
        </label>
      </div>
      <details className="advanced">
        <summary>Opções avançadas</summary>
        <label>
          Duração mínima (segundos)
          <input
            type="number"
            name="minDuration"
            min={1}
            max={60}
            defaultValue={5}
            required
          />
        </label>
        <label className="check-label">
          <input name="reprocess" type="checkbox" />
          Gerar nova versão após a produção anterior
        </label>
        {mode === 'upload' && (
          <label className="check-label">
            <input name="testContent" type="checkbox" />
            Conteúdo sintético de teste
          </label>
        )}
        <SelectionCriteria defaultFallback="heuristic" />
      </details>
      <button
        className="button primary"
        type="submit"
        disabled={action.busy || (inProgress && !edited)}
      >
        {action.busy
          ? 'Iniciando produção...'
          : inProgress && !edited
            ? 'Produção em andamento'
            : 'Gerar cortes'}
      </button>
      <p className="muted small">
        As etapas continuam automaticamente.{' '}
        <a href="/configuracoes">Informações de uso e publicação</a>
      </p>
    </form>
  );
}
