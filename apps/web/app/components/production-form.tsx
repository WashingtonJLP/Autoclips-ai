'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, useAction } from '../shared/api';
import { Source, Task } from '../shared/models';
import { Feedback } from './ui';

type Asset = {
  id: string;
  title: string;
  url: string;
  platform: string;
  sourceId?: string;
  path?: string;
  accessible: boolean;
  rightsConfirmed: boolean;
  reason?: string;
  duration?: number;
  author?: string;
};
export default function ProductionForm({
  sources,
  tasks,
  onCreated,
  initialSource,
  initialAsset,
}: {
  sources: Source[];
  tasks: Task[];
  onCreated: (task: Task) => void;
  initialSource?: string;
  initialAsset?: string;
}) {
  const [mode, setMode] = useState(initialAsset ? 'imported' : 'link'),
    [sourceId, setSourceId] = useState(initialSource ?? ''),
    [assets, setAssets] = useState<Asset[]>([]),
    [selected, setSelected] = useState(initialAsset ?? ''),
    [inspected, setInspected] = useState<Asset | null>(null),
    [manual, setManual] = useState(false),
    action = useAction();
  useEffect(() => {
    if (!initialAsset) return;
    const controller = new AbortController();
    void api<Asset[]>('media', undefined, controller.signal)
      .then((items) => {
        setAssets(items);
        const source = items.find((a) => a.id === initialAsset)?.sourceId;
        if (source) setSourceId(source);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [initialAsset]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const task = await action.run(async () => {
      let asset: Asset;
      if (mode === 'link') {
        asset = await api<Asset>('media/inspect', {
          url: String(form.get('url')).trim(),
        });
        setInspected(asset);
      } else if (mode === 'upload') {
        const file = form.get('file') as File;
        if (!file?.size || file.size > 512 * 1024 ** 2)
          throw new Error('Escolha um arquivo de até 512 MB');
        const extension = file.name.split('.').at(-1)?.toLowerCase();
        const response = await fetch(
          `/api/backend/media/upload?sourceId=${encodeURIComponent(sourceId)}&extension=${extension}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: file,
          },
        );
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.message ?? 'Não foi possível enviar o arquivo',
          );
        asset = result;
      } else if (mode === 'advanced') {
        const body: Record<string, unknown> = {
          sourceId,
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
      } else {
        const found = assets.find((a) => a.id === selected);
        if (!found) throw new Error('Escolha um vídeo importado');
        asset = found;
      }
      return api<Task>('productions', {
        assetId: asset.id,
        ...(sourceId ? { sourceId } : {}),
        autoRun: form.get('autoRun') === 'on',
        reprocess: form.get('reprocess') === 'on',
        confirmCatalogRights: form.get('confirmCatalogRights') === 'on',
        ...(form.get('newAuthorization') === 'on'
          ? {
              authorization: {
                license: form.get('license'),
                evidenceUrl: form.get('evidenceUrl'),
                attribution: form.get('attribution'),
                commercialUseVerified: true,
              },
            }
          : {}),
        options: {
          maxClips: Number(form.get('maxClips')),
          minDuration: 5,
          maxDuration: Number(form.get('maxDuration')),
          language: form.get('language'),
        },
      });
    }, 'Produção localizada ou iniciada. Resultados existentes são reutilizados; acompanhe as etapas.');
    if (task) onCreated(task);
  }
  async function choose(value: string) {
    setMode(value);
    setInspected(null);
    if (value === 'imported')
      await action.run(async () => {
        setAssets(await api<Asset[]>('media'));
      }, 'Vídeos carregados.');
  }
  return (
    <form className="panel" onSubmit={(e) => void submit(e)}>
      <Feedback error={action.error} message={action.message} />
      <section className="form-section">
        <h2>1. Escolha sua mídia</h2>
        <div className="row">
          {[
            ['link', 'Colar link'],
            ['imported', 'Escolher vídeo'],
            ['upload', 'Enviar arquivo'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`button ${mode === value ? 'primary' : ''}`}
              onClick={() => void choose(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === 'link' && (
          <label>
            Link do vídeo
            <input
              name="url"
              type="url"
              required
              placeholder="https://…"
              maxLength={2000}
            />
            <small>
              Consulte metadados e importe arquivos autorizados. Links de
              plataformas podem exigir envio do original.
            </small>
          </label>
        )}
        {mode === 'imported' && (
          <label>
            Vídeo importado
            <select
              required
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                const a = assets.find((a) => a.id === e.target.value);
                if (a?.sourceId) setSourceId(a.sourceId);
              }}
            >
              <option value="">Selecione</option>
              {assets
                .filter((a) => a.path || a.accessible)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title} · {a.platform}
                  </option>
                ))}
            </select>
          </label>
        )}
        {mode === 'upload' && (
          <label>
            Arquivo original
            <input
              name="file"
              type="file"
              accept=".mp4,.mov,.webm,.mkv,.ogv,.mp3,.wav,.m4a"
              required
            />
            <small>
              Até 512 MB e duas horas; mantenha a evidência de autorização na
              fonte.
            </small>
          </label>
        )}
        {inspected && (
          <p role="status">
            {inspected.title} · {inspected.author}{' '}
            {inspected.duration ? `· ${Math.round(inspected.duration)} s` : ''}
            <br />
            {inspected.reason}
          </p>
        )}
      </section>
      <section className="form-section">
        <h2>2. Direitos de uso</h2>
        <label>
          Fonte autorizada
          <select
            name="sourceId"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            required={mode === 'upload' || mode === 'advanced'}
          >
            <option value="">Selecione a autorização da mesma origem</option>
            {sources
              .filter((s) => s.commercialUseVerified)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.license}
                </option>
              ))}
          </select>
        </label>
        {mode === 'link' && (
          <>
            <label className="check-label">
              <input name="confirmCatalogRights" type="checkbox" />
              Revisei os direitos do catálogo (Wikimedia / catálogo autorizado)
              e confirmo a reutilização com atribuição.
            </label>
            <details className="advanced">
              <summary>Registrar autorização expressa para este link</summary>
              <label className="check-label">
                <input name="newAuthorization" type="checkbox" />
                Confirmo os direitos documentados abaixo
              </label>
              <label>
                Licença
                <select name="license">
                  <option value="PERMISSION">Permissão expressa</option>
                  <option value="CC0">CC0</option>
                  <option value="CC-BY-4.0">CC BY 4.0</option>
                </select>
              </label>
              <label>
                Evidência dos direitos
                <input name="evidenceUrl" type="url" placeholder="https://" />
              </label>
              <label>
                Autor e atribuição
                <textarea name="attribution" maxLength={2000} />
              </label>
            </details>
          </>
        )}
        <p className="muted small">
          Registre a URL original, autoria e evidência em{' '}
          <Link href="/fontes" className="text-link">
            Cadastrar fonte
          </Link>
          . Vídeos públicos não implicam autorização.
        </p>
      </section>
      <section className="form-section">
        <h2>3. Preferências dos cortes</h2>
        <div className="form-grid">
          <label>
            Quantidade
            <input
              name="maxClips"
              type="number"
              min="1"
              max="10"
              defaultValue="3"
              required
            />
          </label>
          <label>
            Duração máxima
            <select name="maxDuration" defaultValue="60">
              <option value="30">30 segundos</option>
              <option value="60">60 segundos</option>
              <option value="90">90 segundos</option>
              <option value="180">180 segundos</option>
            </select>
          </label>
          <label>
            Idioma
            <select name="language" defaultValue="auto">
              <option value="auto">Detectar</option>
              <option value="pt">Português</option>
              <option value="en">Inglês</option>
              <option value="es">Espanhol</option>
            </select>
          </label>
        </div>
        <label className="check-label">
          <input name="autoRun" type="checkbox" defaultChecked />
          Concluir automaticamente com títulos, cortes e legendas
        </label>
        <details className="advanced">
          <summary>Opções avançadas</summary>
          <label className="check-label">
            <input name="reprocess" type="checkbox" />
            Reprocessar explicitamente, mesmo com resultados existentes
          </label>
          <button
            type="button"
            className="button"
            onClick={() => setMode('advanced')}
          >
            Usar arquivo interno (técnico)
          </button>
          {mode === 'advanced' && (
            <>
              <label>
                Caminho interno
                <input name="path" required list="known-media" />
                <datalist id="known-media">
                  {tasks
                    .filter((t) => typeof t.payload.path === 'string')
                    .map((t) => (
                      <option key={t.id} value={t.payload.path} />
                    ))}
                </datalist>
              </label>
              <label>
                Operação técnica
                <select
                  value={manual ? 'clip' : 'transcribe'}
                  onChange={(e) => setManual(e.target.value === 'clip')}
                >
                  <option value="transcribe">Transcrever e criar cortes</option>
                  <option value="clip">Corte manual por intervalo</option>
                </select>
              </label>
              {manual && (
                <>
                  <div className="form-grid">
                    <label>
                      Início (segundos)
                      <input
                        name="start"
                        type="number"
                        min="0"
                        step="0.01"
                        required
                      />
                    </label>
                    <label>
                      Fim (segundos)
                      <input
                        name="end"
                        type="number"
                        min="0.01"
                        step="0.01"
                        required
                      />
                    </label>
                  </div>
                  <label>
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
                </>
              )}
            </>
          )}
        </details>
      </section>
      <button className="button primary" disabled={action.busy}>
        {action.busy ? 'Preparando produção…' : 'Gerar cortes'}
      </button>
    </form>
  );
}
