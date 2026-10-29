'use client';
import { api, useAction, useResources } from '../shared/api';
import { LlmSettings } from '../shared/models';
import { PageHeader, Refresh, Feedback, Advanced } from '../components/ui';
export default function Settings() {
  const { data, loading, error, refresh } = useResources(['llm/config']),
    action = useAction(),
    settings = data['llm/config'] as LlmSettings | undefined;
  return (
    <>
      <PageHeader
        eyebrow="PREFERÊNCIAS DO ESTÚDIO"
        title="Configurações"
        description="Consulte o modo de IA, os limites e as informações do ambiente."
      >
        <Refresh onClick={() => void refresh()} disabled={loading} />
      </PageHeader>
      <Feedback
        error={error || action.error}
        message={action.message}
        loading={loading}
      />
      <div className="two-columns">
        <div className="stack">
          <section className="panel">
            <div className="section-heading">
              <h2>Inteligência artificial</h2>
              {settings && (
                <span
                  className={`badge ${settings.simulated ? 'warning' : 'success'}`}
                >
                  {settings.simulated
                    ? 'Modo mock'
                    : settings.available === false
                      ? 'IA não configurada'
                      : 'Provedor real'}
                </span>
              )}
            </div>
            <p className="panel-intro">
              Configuração atual do servidor. Esta tela não habilita consumo
              pago.
            </p>
            <dl className="definition-list">
              <dt>Provedor</dt>
              <dd>{settings?.provider ?? '—'}</dd>
              <dt>Modelo</dt>
              <dd>{settings?.model ?? '—'}</dd>
              <dt>Fallback configurado</dt>
              <dd>
                {settings?.fallback === 'heuristic'
                  ? 'Heurística local identificada'
                  : 'Interromper sem simular IA'}
              </dd>
              <dt>Orçamento diário</dt>
              <dd>
                {settings
                  ? `${(settings.dailyCostMicros / 1000000).toFixed(6)} USD`
                  : '—'}
              </dd>
              <dt>Orçamento comprometido</dt>
              <dd>
                {settings
                  ? `${(Number(settings.budget.committedCostMicros) / 1000000).toFixed(6)} USD`
                  : '—'}
              </dd>
            </dl>
            <p className="muted small">
              Gemini real exige GEMINI_API_KEY, modelo explícito e
              LLM_ALLOW_EXTERNAL=true no servidor. Confirme o nível gratuito do
              projeto ou configure autorização, preços e orçamento. A chave não
              é enviada pelo navegador.
            </p>
            <Advanced
              value={settings ?? {}}
              title="Limites de tokens e consumo detalhado"
            />
          </section>
          <section className="panel">
            <h2>Configurações gerais</h2>
            <dl className="definition-list">
              <dt>Atualizações</dt>
              <dd>Manuais, sem polling</dd>
              <dt>Publicação</dt>
              <dd>Somente simulação</dd>
              <dt>Acesso</dt>
              <dd>Operador autenticado</dd>
              <dt>Vídeos</dt>
              <dd>Vertical · 9:16</dd>
            </dl>
          </section>
        </div>
        <aside className="stack">
          <section className="info-card">
            <h3>Gerenciadas no servidor</h3>
            <p>
              Provedor, credenciais e orçamentos são configurados por ambiente.
              Não há alteração de segredos pelo navegador.
            </p>
            <p>
              Os limites e a autorização são validados pela API antes do
              processamento.
            </p>
          </section>
          <section className="panel">
            <h2>Diagnóstico avançado</h2>
            <p className="panel-intro">
              Verificação manual da API, banco, fila e worker.
            </p>
            <button
              className="button secondary"
              disabled={action.busy}
              onClick={() =>
                void action.run(
                  () => api('ready'),
                  'API, PostgreSQL, Redis e worker responderam à verificação.',
                )
              }
            >
              {action.busy ? 'Verificando…' : 'Verificar dependências'}
            </button>
            <p className="muted small" style={{ marginTop: 14 }}>
              Esta ação consulta as dependências uma única vez e pode acordar o
              banco.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
