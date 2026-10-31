'use client';
import { useEffect, useState } from 'react';
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
  const blocked =
    asset.availability?.kind === 'upload_required' ||
    (!asset.path && !asset.accessible);
  return (
    <article className="notice" aria-label="Análise do vídeo">
      {asset.thumbnailUrl && (
        <img
          src={asset.thumbnailUrl}
          alt={`Miniatura de ${asset.title}`}
          width={240}
          height={135}
          loading="lazy"
          referrerPolicy="no-referrer"
          style={{ objectFit: 'cover', maxWidth: '100%', borderRadius: 8 }}
        />
      )}
      <h3>{asset.title}</h3>
      <p>
        {(
          {
            youtube: 'YouTube',
            twitch: 'Twitch',
            vimeo: 'Vimeo',
            direct: 'Arquivo direto',
            commons: 'Wikimedia Commons',
            upload: 'Arquivo enviado',
          } as Record<string, string>
        )[asset.platform] ?? asset.platform}
        {asset.author ? ` · ${asset.author}` : ''}
      </p>
      <p>
        {asset.duration
          ? `Duração: ${Math.floor(Math.round(asset.duration) / 60)}:${String(Math.round(asset.duration) % 60).padStart(2, '0')}`
          : 'Duração ainda não informada'}
      </p>
      <strong>
        {asset.path
          ? 'Arquivo já importado'
          : blocked
            ? asset.platform === 'youtube'
              ? 'Apenas metadados · vincule um original autorizado'
              : 'Apenas metadados · envio do original necessário'
            : 'Importação disponível'}
      </strong>
      <p role="status">
        {asset.availability?.message ??
          (asset.path
            ? 'Vamos reutilizar o arquivo já importado.'
            : asset.reason)}
      </p>
      {blocked && (
        <button className="button primary" type="button" onClick={onUpload}>
          Enviar o original autorizado
        </button>
      )}
    </article>
  );
}
type Request = {
  assetId: string;
  autoRun: boolean;
  reprocess: boolean;
  options: Record<string, unknown>;
};
export default function ProductionForm({
  onCreated,
  initialAsset,
}: {
  onCreated: (task: Task) => void;
  initialAsset?: string;
}) {
  const [mode, setMode] = useState(initialAsset ? 'imported' : 'link');
  const [link, setLink] = useState('');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selected, setSelected] = useState(initialAsset ?? '');
  const [filter, setFilter] = useState('');
  const [showTests, setShowTests] = useState(false);
  const [inspected, setInspected] = useState<Asset | null>(null);
  const [pending, setPending] = useState<Request | null>(null);
  const [originalUrl, setOriginalUrl] = useState('');
  const [originalAsset, setOriginalAsset] = useState('');
  const [originalPermission, setOriginalPermission] = useState(false);
  const [llm, setLlm] = useState<{
    provider: string;
    model: string;
    simulated: boolean;
  } | null>(null);
  const action = useAction();
  async function analyze() {
    setPending(null);
    setOriginalUrl('');
    setOriginalAsset('');
    setOriginalPermission(false);
    const asset = await api<Asset>('media/inspect', { url: link.trim() });
    setInspected(asset);
    return asset;
  }
  useEffect(() => {
    const controller = new AbortController();
    void api<Asset[]>('media', undefined, controller.signal)
      .then((items) => {
        setAssets(items);
        if (items.find((a) => a.id === initialAsset)?.testContent)
          setShowTests(true);
      })
      .catch(() => {});
    void api<typeof llm>('llm/config', undefined, controller.signal)
      .then(setLlm)
      .catch(() => {});
    return () => controller.abort();
  }, [initialAsset]);
  async function start(asset: Asset, request: Request) {
    if (!asset.rightsConfirmed) {
      const response = await fetch('/api/backend/productions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await response.json();
      if (data.code === 'AUTHORIZATION_REQUIRED') {
        setPending(request);
        return;
      }
      if (!response.ok)
        throw new Error(
          typeof data.message === 'string'
            ? data.message
            : 'Confira a mídia e tente novamente.',
        );
      onCreated(data);
    } else onCreated(await api<Task>('productions', request));
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(null);
    await action.run(async () => {
      let asset: Asset;
      if (mode === 'link') {
        asset = inspected ?? (await analyze());
        if (!asset.path && !asset.accessible)
          throw new Error(
            asset.availability?.message ??
              'Vincule um original autorizado para continuar.',
          );
      } else if (mode === 'upload') {
        const file = form.get('file') as File;
        const extension = file?.name.split('.').at(-1)?.toLowerCase();
        if (!file?.size || file.size > 512 * 1024 ** 2)
          throw new Error('Escolha um vídeo de até 512 MB.');
        if (!['mp4', 'webm', 'mov'].includes(extension ?? ''))
          throw new Error('Escolha um arquivo MP4, WebM ou MOV.');
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
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.message ?? 'Não foi possível enviar o vídeo.');
        asset = result;
        setAssets((items) => [
          asset,
          ...items.filter((a) => a.id !== asset.id),
        ]);
        setSelected(asset.id);
      } else {
        const found = assets.find((a) => a.id === selected);
        if (!found) throw new Error('Selecione um vídeo da lista.');
        asset = found;
      }
      setInspected(asset);
      const criteria = form.getAll('criteria');
      if (!criteria.length)
        throw new Error('Escolha pelo menos um critério de seleção.');
      await start(asset, {
        assetId: asset.id,
        autoRun: true,
        reprocess: form.get('reprocess') === 'on',
        options: {
          maxClips: Number(form.get('maxClips')),
          minDuration: Number(form.get('minDuration')),
          maxDuration: Number(form.get('maxDuration')),
          language: form.get('language'),
          criteria,
          ...(form.get('minScore')
            ? { minScore: Number(form.get('minScore')) }
            : {}),
          ...(form.get('fallback') ? { fallback: form.get('fallback') } : {}),
        },
      });
    }, 'Mídia conferida. Acompanhe a produção ou confirme a autorização abaixo.');
  }
  return (
    <form
      className="panel"
      onSubmit={(e) => void submit(e)}
      onChange={() => setPending(null)}
    >
      <Feedback error={action.error} message={action.message} />
      <section className="form-section">
        <h2>Escolha seu vídeo</h2>
        <div className="row">
          {(
            [
              ['link', 'Colar link'],
              ['upload', 'Enviar arquivo'],
              ['imported', 'Escolher vídeo'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              disabled={action.busy}
              className={`button ${mode === value ? 'primary' : ''}`}
              onClick={() => {
                setMode(value);
                setPending(null);
                setInspected(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === 'link' && (
          <div>
            <label>
              Link do vídeo
              <input
                name="url"
                type="url"
                required
                placeholder="https://…"
                maxLength={2000}
                value={link}
                disabled={action.busy}
                onChange={(e) => {
                  setLink(e.target.value);
                  setInspected(null);
                  setPending(null);
                }}
              />
              <small>
                Cole o link para conferir os dados e saber se podemos importar o
                vídeo.
              </small>
            </label>
            <button
              className="button secondary"
              disabled={action.busy}
              type="button"
              onClick={() => void action.run(analyze, 'Análise atualizada.')}
            >
              {action.busy
                ? 'Analisando…'
                : inspected
                  ? 'Analisar novamente'
                  : 'Analisar vídeo'}
            </button>
          </div>
        )}
        {mode === 'upload' && (
          <label>
            Arquivo original
            <input
              name="file"
              type="file"
              required
              accept=".mp4,.webm,.mov"
              disabled={action.busy}
            />
            <small>MP4, WebM ou MOV, até 512 MB e duas horas.</small>
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
                placeholder="Título ou plataforma"
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={showTests}
                onChange={(e) => setShowTests(e.target.checked)}
              />
              Mostrar mídias sintéticas de teste
            </label>
            <label>
              Vídeo importado
              <select
                required
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setPending(null);
                }}
              >
                <option value="">Selecione um vídeo</option>
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
                      {a.title} · {a.platform}
                      {a.duration ? ` · ${Math.round(a.duration)} s` : ''}
                    </option>
                  ))}
              </select>
            </label>
            {!assets.some((a) => a.path && (showTests || !a.testContent)) && (
              <p>
                Você ainda não tem vídeos nesta lista. Envie um arquivo ou cole
                um link.
              </p>
            )}
          </>
        )}
        {inspected && (
          <MediaAnalysis
            asset={inspected}
            onUpload={() => {
              setMode('upload');
              setPending(null);
              setInspected(null);
            }}
          />
        )}
        {mode === 'link' &&
          inspected?.platform === 'youtube' &&
          inspected.availability?.kind === 'upload_required' && (
            <details className="advanced">
              <summary>Usar um original autorizado sem novo upload</summary>
              <p>
                O YouTube não fornece um link de download pela Data API. Se o
                titular disponibilizou o original fora da plataforma, vincule
                esse arquivo. Você também pode reutilizar um vídeo já importado.
                Esta associação é uma declaração sua, não uma verificação
                automática de identidade.
              </p>
              <label>
                Link HTTPS do original fornecido pelo titular
                <input
                  type="url"
                  value={originalUrl}
                  placeholder="https://seu-site/video.mp4"
                  disabled={action.busy}
                  onChange={(e) => {
                    setOriginalUrl(e.target.value);
                    setOriginalAsset('');
                    setOriginalPermission(false);
                  }}
                />
              </label>
              <label>
                Ou um arquivo já importado
                <select
                  value={originalAsset}
                  disabled={action.busy}
                  onChange={(e) => {
                    setOriginalAsset(e.target.value);
                    setOriginalUrl('');
                    setOriginalPermission(false);
                  }}
                >
                  <option value="">Selecione</option>
                  {assets
                    .filter((a) => a.path && a.id !== inspected.id)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.title}
                        {a.testContent ? ' (teste sintético)' : ''}
                      </option>
                    ))}
                </select>
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={originalPermission}
                  onChange={(e) => setOriginalPermission(e.target.checked)}
                />
                Tenho autorização para criar cortes e confirmo que este arquivo
                é o original ou uma versão licenciada correspondente ao vídeo
                analisado.
              </label>
              <button
                className="button primary"
                type="button"
                disabled={
                  action.busy ||
                  !originalPermission ||
                  (!originalUrl && !originalAsset)
                }
                onClick={() =>
                  void action.run(async () => {
                    const asset = await api<Asset>(
                      `media/${inspected.id}/original`,
                      {
                        ...(originalUrl
                          ? { mediaUrl: originalUrl }
                          : { importedAssetId: originalAsset }),
                        confirmPermission: true,
                      },
                    );
                    setInspected(asset);
                    setPending(null);
                  }, 'Original autorizado vinculado. Agora clique em Gerar cortes.')
                }
              >
                Vincular original autorizado
              </button>
              <p className="muted small">
                Para vídeos próprios, o titular também pode obter o arquivo pelo
                YouTube Studio ou Google Takeout e disponibilizá-lo por HTTPS.
                Não acessamos sua conta nem contornamos restrições.
              </p>
            </details>
          )}
      </section>
      <section className="form-section">
        <h2>Preferências dos cortes</h2>
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
        <details className="advanced">
          <summary>Mais opções</summary>
          <label>
            Duração mínima (segundos)
            <input
              name="minDuration"
              type="number"
              min="1"
              max="60"
              defaultValue="5"
              required
            />
          </label>
          <label className="check-label">
            <input name="reprocess" type="checkbox" />
            Gerar uma nova versão, mesmo se já houver cortes
          </label>
          {mode === 'upload' && (
            <label className="check-label">
              <input name="testContent" type="checkbox" />
              Este arquivo é conteúdo sintético de teste
            </label>
          )}
          {llm && (
            <p className="muted small">
              Seleção: {llm.provider} · {llm.model}.{' '}
              {llm.simulated
                ? 'Mock de teste, sem análise semântica.'
                : 'Resultados sujeitos à disponibilidade e revisão.'}
            </p>
          )}
        </details>
        <SelectionCriteria defaultFallback="heuristic" />
        <p className="muted small">
          A transcrição, os cortes e as legendas continuam automaticamente. Se
          faltar autorização, você poderá confirmá-la apenas para este vídeo. Se
          a IA estiver indisponível, usaremos heurística local identificada, sem
          análise semântica. Você pode alterar essa opção acima.
        </p>
        {
          <button
            className="button primary"
            type="submit"
            disabled={
              action.busy ||
              (mode === 'link' &&
                inspected?.availability?.kind === 'upload_required')
            }
          >
            {action.busy ? 'Preparando vídeo…' : 'Gerar cortes'}
          </button>
        }
      </section>
      {pending && (
        <section
          className="notice"
          role="region"
          aria-label="Autorização desta mídia"
        >
          <h3>Você pode usar este vídeo?</h3>
          <p>
            Confirme que o vídeo é seu ou que você tem autorização para criar
            cortes e para o uso pretendido. Um link público não concede direitos
            de republicação. A declaração será registrada apenas para esta
            mídia.
          </p>
          <button
            className="button primary"
            type="button"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const task = await api<Task>('productions', {
                  ...pending,
                  confirmPermission: true,
                });
                setPending(null);
                onCreated(task);
              }, 'Produção iniciada.')
            }
          >
            Tenho autorização — gerar cortes
          </button>
          <button
            className="button subtle"
            type="button"
            onClick={() => setPending(null)}
          >
            Cancelar
          </button>
        </section>
      )}
    </form>
  );
}
