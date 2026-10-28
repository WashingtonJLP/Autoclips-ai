'use client';
import { api, useAction } from '../shared/api';
import { Source } from '../shared/models';
import { Feedback } from './ui';
export default function SourceForm({ onSaved }: { onSaved: () => void }) {
  const action = useAction();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      fields = new FormData(form);
    const source = await action.run(
      () =>
        api<Source>('sources', {
          ...Object.fromEntries(fields),
          commercialUseVerified: fields.get('commercialUseVerified') === 'on',
        }),
      'Fonte cadastrada com evidência de direitos.',
    );
    if (source) {
      form.reset();
      onSaved();
    }
  }
  return (
    <form className="panel" onSubmit={(e) => void submit(e)}>
      <h2>Cadastrar fonte autorizada</h2>
      <p className="panel-intro">
        Registre a origem, os créditos e a evidência da permissão.
      </p>
      <Feedback error={action.error} message={action.message} />
      <div className="form-grid">
        <label>
          Nome da fonte
          <input
            name="name"
            required
            maxLength={200}
            placeholder="Nome para identificar esta fonte"
          />
        </label>
        <label>
          Licença
          <select name="license">
            <option value="CC0">CC0</option>
            <option value="CC-BY-4.0">CC BY 4.0</option>
            <option value="PERMISSION">Permissão expressa</option>
          </select>
        </label>
        <label className="span-all">
          URL de origem
          <input name="url" type="url" required placeholder="https://" />
        </label>
        <label className="span-all">
          Evidência dos direitos
          <input
            name="evidenceUrl"
            type="url"
            required
            placeholder="https://"
          />
          <small>Link para a licença ou autorização de uso comercial.</small>
        </label>
        <label className="span-all">
          Créditos e atribuição
          <textarea
            name="attribution"
            required
            maxLength={2000}
            placeholder="Autor, origem e condições de uso"
          />
        </label>
        <label className="check-label span-all">
          <input name="commercialUseVerified" type="checkbox" required />
          Revisei a origem e confirmei a autorização de reutilização comercial
          desta mídia.
        </label>
      </div>
      <button
        className="button primary"
        style={{ marginTop: 24 }}
        disabled={action.busy}
      >
        {action.busy ? 'Salvando…' : 'Salvar fonte'}
      </button>
    </form>
  );
}
