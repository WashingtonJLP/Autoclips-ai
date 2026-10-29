export default function SelectionCriteria() {
  return (
    <details className="advanced">
      <summary>Critérios da seleção e fallback</summary>
      <fieldset>
        <legend>Priorizar (contexto e clareza são sempre exigidos)</legend>
        {(
          [
            ['hook', 'Gancho forte'],
            ['value', 'Informação útil'],
            ['humor', 'Humor'],
            ['emotion', 'Emoção'],
            ['engagement', 'Potencial de engajamento'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="check-label">
            <input
              type="checkbox"
              name="criteria"
              value={value}
              defaultChecked={value === 'hook' || value === 'value'}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <label>
        Nota mínima (0–10)
        <input
          type="number"
          name="minScore"
          min="0"
          max="10"
          step="0.5"
          placeholder="Padrão do servidor"
        />
      </label>
      <label>
        Se a IA estiver indisponível
        <select name="fallback" defaultValue="">
          <option value="">Usar política do servidor</option>
          <option value="none">Interromper com explicação</option>
          <option value="heuristic">Usar heurística local identificada</option>
        </select>
      </label>
      <small>
        Heurísticas não avaliam significado nem garantem engajamento. A origem
        será registrada no resultado.
      </small>
    </details>
  );
}
