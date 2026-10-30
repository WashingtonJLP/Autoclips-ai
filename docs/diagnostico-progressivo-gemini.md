# Diagnóstico progressivo Gemini 3.5 Flash-Lite

## Comparação com a documentação oficial

O cliente existente usa REST `v1beta/models/gemini-3.5-flash-lite:generateContent`,
autenticação por `x-goog-api-key` e JSON com `contents`, `systemInstruction` e
`generationConfig`. A referência REST ainda documenta esse endpoint. O modelo
estável possui saída de texto e suporte a saídas estruturadas.

Os exemplos atuais do SDK oficial `@google/genai` e de REST no guia de geração
usam **Interactions**: `ai.interactions.create({model, input})`, endpoint
`v1beta/interactions`, com `response_format` para schema. Esses campos não devem
ser misturados com `generationConfig.responseJsonSchema` do generateContent.
Não instalamos SDK nem migramos o cliente: trocar endpoint e formato junto com
as opções impediria isolar a diferença. A migração permanece uma possibilidade
posterior, não uma causa comprovada do HTTP 400.

O guia específico de 3.5/3.6 também proíbe terminar a conversa com papel `model`.
Nosso payload termina com `user`; não foi encontrada essa incompatibilidade.
Não há `candidateCount` nem `thinkingConfig` no payload 3.5.

Referências consultadas:

- [Modelo 3.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)
- [Exemplos atuais REST e SDK](https://ai.google.dev/gemini-api/docs/text-generation)
- [Referência generateContent](https://ai.google.dev/api/generate-content)
- [Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)
- [Mudanças específicas de 3.5/3.6](https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.6)

## Três estágios preparados localmente

1. Texto simples: somente `contents`, com `user` e texto `Responda apenas OK.`.
   Sem schema, system instruction, generationConfig, thinking ou parâmetros de
   amostragem. Endpoint e cabeçalhos permanecem os do cliente existente.
2. JSON Schema mínimo: objeto com uma propriedade booleana obrigatória `ok`;
   apenas MIME JSON e responseJsonSchema em generationConfig.
3. Seleção: payload capturado do próprio `GeminiProvider`, com a transcrição
   real existente, seus timestamps e schema corrigido. Transporte substituído
   por função local, sem consultar o Google durante a captura.

O comando não percorre automaticamente os estágios reais. Mesmo quando
habilitado, permite enviar **somente** o primeiro estágio, com um único fetch,
sem retries. A quota é reservada pelo `PrismaUsageLedger` existente antes da
rede; falhas preservam reserva e diagnóstico sanitizado. Não há polling SQL
em segundo plano. O script fecha a conexão ao terminar.

## Resultado do preflight em 30/10/2026 UTC

Preparação local concluída; **50 testes API**, build TypeScript, lint e
formatação aprovados. Os contratos e o cliente de produção não foram alterados.

O ledger informa 1/2 requisições, 6.905 tokens comprometidos e zero custo
reservado no dia UTC. Há saldo de requisições, mas o teste sem qualquer limite
opcional de saída não cabe no orçamento conservador: o modelo permite até
65.536 tokens de saída; os limites atuais são 20.000 por execução e 40.000
diários. A ausência de maxOutputTokens não fornece um teto menor verificável.
O prompt curto não é uma garantia de limite de consumo.

Nesse preflight sem teto explícito, nenhuma chamada real foi executada e
nenhuma reserva foi criada. Posteriormente, o operador autorizou exclusivamente
`maxOutputTokens: 64`, permitindo o teste descrito a seguir. Nenhum limite foi
alterado; a atualização dos contadores ocorreu apenas pelo ledger normal.
Não foram habilitados faturamento, fallback ou outros provedores.

## Teste real autorizado com teto de 64 tokens

Em 30/10/2026 às 00:12 UTC, foi enviado exatamente este corpo ao endpoint
generateContent existente, usando a chave local somente no cabeçalho:

```json
{
  "contents": [
    { "role": "user", "parts": [{ "text": "Responda apenas OK." }] }
  ],
  "generationConfig": { "maxOutputTokens": 64 }
}
```

**Sucesso:** resposta textual `OK`. Consumo efetivo informado pela API:
7 tokens de entrada, 1 token de saída, 8 no total. Custo registrado: zero.
Uma única chamada, sem retries, sem schema, thinkingConfig, systemInstruction,
responseMimeType, temperatura ou outras opções. A aplicação permanece com
nível gratuito confirmado e consumo pago bloqueado.

O ledger reservou inicialmente 177 tokens de entrada conservadores + 64 de
saída e ajustou a reserva aos 8 tokens efetivos após a resposta. O total diário
passou de 6.905 para 6.913 tokens comprometidos, pois a chamada anterior falha
continua reservada. A quota passou de **1/2 para 2/2**, sem apagar registros.
Tarefa diagnóstica: `cmvu7wstg0000j6pq44c95mkz`, operação separada sem fila de
produção ou publicação.

Isso confirma funcionamento de chave, modelo, endpoint v1beta e envelope
mínimo no ambiente atual. O HTTP 400 anterior depende de alguma diferença do
payload de seleção; ainda não é possível atribuí-lo a um parâmetro específico.
Não houve teste real de schema mínimo, seleção, MP4/SRT ou Biblioteca nesta
etapa. Esses estágios permanecem pendentes de decisão/autorização posterior.
Não haverá progressão automática nem nova tentativa quando o dia mudar.

Artefatos locais ignorados pelo Git:

- `artifacts/gemini-progressive-payloads.json`
- `artifacts/gemini-progressive-preflight.json`
- `artifacts/gemini-progressive-simple-real.json`

## Reproduzir a preparação

Com os serviços locais existentes em execução:

```powershell
npm run build -w @autoclips/api
docker compose cp apps/api/dist/selection/diagnostics.js api:/app/apps/api/dist/selection/diagnostics.js
docker compose cp scripts/gemini-progressive-diagnostic.cjs api:/app/scripts/gemini-progressive-diagnostic.cjs
docker compose exec -T api node scripts/gemini-progressive-diagnostic.cjs
```

O modo padrão prepara arquivos em `/tmp/gemini-progressive` no container e
consulta o orçamento, sem chamada externa. `--live-simple` existe para uma
execução explicitamente autorizada e ainda aplica os bloqueios de orçamento;
não deve ser usado como tentativa de superar o bloqueio de tokens descrito.
O teto de 64 tokens é ativado apenas com `--output-cap-64`. A combinação
`--output-cap-64 --live-simple` foi usada uma vez nesta validação autorizada;
não deve ser repetida sem nova autorização e saldo persistido suficiente.
