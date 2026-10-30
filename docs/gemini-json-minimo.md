# Próxima validação: JSON mínimo de um corte

## Estado atual

Em 30/10/2026 às 00:22 UTC, a quota persistida continua **2/2**, com 6.913
tokens comprometidos. Nenhuma chamada Gemini foi feita nesta etapa. Contadores,
limites e configuração de faturamento não foram alterados. O sucesso anterior
foi somente texto simples (`OK`), não seleção editorial estruturada.

O operador autorizou uma única tentativa JSON após renovação natural. A tarefa
Windows `AutoClips-Gemini-Json-Minimo-UmaVez` está registrada para **30/10/2026
às 21h01 de São Paulo**, equivalente a 31/10/2026 às 00h01 UTC. É um gatilho
único, sem recorrência e com zero reinicializações. Usa a sessão interativa do
usuário, sem salvar senha ou chave. Depende do usuário conectado, Docker Desktop
e serviços existentes disponíveis. Se a máquina não estiver disponível, o
agendador permite início posterior; não há novas tentativas automáticas se o
processo falhar.

Não há polling PostgreSQL: o Windows desperta uma execução e o roteiro consulta
o ledger sob demanda. Antes da rede, o `PrismaUsageLedger` existente reserva
quota e tokens com transação serializável. Se o orçamento já estiver ocupado,
a execução é bloqueada e não é reagendada. Uma chave persistente específica
do JSON mínimo, independente do dia, também impede repetir uma tentativa
falha/ambígua por simples mudança da data. Cache não envia nova chamada.

## Payload mínimo

Mantivemos `GeminiProvider`, endpoint
`v1beta/models/gemini-3.5-flash-lite:generateContent`, modelo, autenticação,
timeout e redirecionamentos bloqueados do teste simples bem-sucedido.

O prompt usa a primeira frase completa da transcrição real da fixture
autorizada. Pede somente título e seus timestamps exatos em segundos. É um
diagnóstico de estrutura; não representa análise dos melhores momentos do vídeo.

Configuração enviada:

```json
{
  "maxOutputTokens": 256,
  "responseMimeType": "application/json",
  "responseJsonSchema": {
    "type": "object",
    "properties": {
      "title": { "type": "string" },
      "start": { "type": "number" },
      "end": { "type": "number" }
    },
    "required": ["title", "start", "end"]
  }
}
```

Nenhum thinkingConfig, temperature, systemInstruction, ferramenta, enum,
responseSchema alternativo ou outro parâmetro opcional foi incluído. A validação
local exige título não vazio, tempos finitos e exatamente iguais aos enviados,
fim posterior ao início e ausência de propriedades extras. Essas restrições
locais não aumentam o schema enviado ao servidor.

O preflight estimou 688 tokens de entrada conservadores + 256 de saída máxima:
944 tokens, dentro dos limites de 20.000 por execução e 40.000 diários. O
bloqueio atual é exclusivamente a quota de requisições, não tokens. O consumo
efetivo só poderá ser informado após a resposta real. Erros HTTP preservam o
corpo sanitizado em `LlmCall.response.httpError`, mantendo reservas de consumo
desconhecido. Não há retries, fallback ou substituição por mock.

## Comparação offline

| Item                    | Texto simples aprovado | JSON mínimo preparado | Seleção completa atual                          |
| ----------------------- | ---------------------- | --------------------- | ----------------------------------------------- |
| maxOutputTokens         | 64                     | 256                   | 3.000                                           |
| responseMimeType        | ausente                | application/json      | application/json                                |
| responseJsonSchema      | ausente                | objeto simples        | objeto com clips e scores                       |
| temperature             | ausente                | ausente               | 0                                               |
| systemInstruction       | ausente                | ausente               | instruções editoriais                           |
| thinkingConfig          | ausente                | ausente               | ausente em 3.5                                  |
| Campos de corte         | nenhum                 | title, start, end     | first, last, title, description, reason, scores |
| Timestamps              | nenhum                 | segundos fornecidos   | IDs convertidos em timestamps reais localmente  |
| Estrutura               | texto                  | objeto plano          | objeto → array → objeto → scores                |
| Array                   | nenhum                 | nenhum                | clips, maxItems 20                              |
| Limites numéricos       | nenhum                 | nenhum no schema      | IDs 0–13 neste lote; sete notas 0–10            |
| Comprimentos de strings | nenhum                 | nenhum no schema      | título 5–100; descrição/justificativa 10–600    |
| additionalProperties    | ausente                | ausente no schema     | false em objetos                                |

Inspecionamos também enums, referências e uniões: o schema completo enviado
não contém enum, `$ref`, `$defs`, `anyOf` ou `oneOf`. `$schema` é removido no
adaptador. Tipos presentes são object, array, integer, number e string,
documentados pelo Google. Os limites de IDs já correspondem ao lote, não a
MAX_SAFE_INTEGER.

A documentação informa que comprimento de strings é ignorado pelo servidor;
portanto não constitui causa comprovada de rejeição. Limites numéricos, arrays
e complexidade da gramática continuam hipóteses a isolar. MIME e schema devem
ser testados primeiro; se o mínimo falhar, investigar a aceitação de
responseJsonSchema/MIME nesse modelo e a representação REST de saída estruturada,
sem mudar vários fatores simultaneamente. Se funcionar, o schema completo,
temperature e instruções editoriais continuam pendentes de teste separado.
Não há conclusão antecipada sobre o campo causador.

Referências oficiais:

- [GenerationConfig REST](https://ai.google.dev/api/generate-content)
- [Schema suportado e limitações](https://ai.google.dev/gemini-api/docs/structured-output)

## Verificações e resultados futuros

51 testes API, build, lint e formatação aprovados. A sintaxe do wrapper
PowerShell e a passagem de argumentos Docker foram verificadas usando apenas
`docker compose version`. Não foi iniciado o teste externo para validar o
agendamento. O cliente e os contratos de produção permanecem intactos.

Arquivos locais ignorados pelo Git:

- `artifacts/gemini-json-minimo-payloads.json`: payloads comparados offline.
- `artifacts/gemini-json-minimo-preflight.json`: orçamento e reserva prevista.
- `artifacts/gemini-json-minimo-resultado.json`: resultado após execução agendada.
- `artifacts/gemini-json-minimo-agendado.log`: log sanitizado da execução única.

O roteiro encerra após JSON mínimo, com sucesso ou falha. Não renderiza,
publica nem chama o schema completo. Essa próxima etapa depende de nova
autorização explícita, mesmo se houver saldo diário.
