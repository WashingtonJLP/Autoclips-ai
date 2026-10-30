# Diagnóstico local do HTTP 400 — Gemini 3.5 Flash-Lite

Nenhuma requisição Gemini foi executada neste diagnóstico. Não foram alterados
`.env`, orçamento persistente de duas tentativas diárias, retries, fallback ou
faturamento. A validação real continua pendente de nova autorização.

## Evidências e hipótese

O registro anterior contém somente:

```text
HTTP 400: Request contains an invalid argument.
```

O adaptador descartava o corpo completo e guardava apenas `error.message`.
Não é possível recuperar retrospectivamente `error.details` desse registro.
Os novos testes usam respostas artificiais de transporte, não respostas Google.

O payload reconstruído para `gemini-3.5-flash-lite` **já omitia thinkingConfig**.
`thinkingBudget: 0` era exclusivo da família 2.5 Flash; não foi identificado como
causa do erro 3.5. Mantivemos essa separação. Para 3.5, omitir a configuração usa
o padrão do modelo (minimal), sem misturar thinkingLevel e thinkingBudget.

Foi encontrado um risco concreto de complexidade no JSON Schema: Zod gerava
`maximum: 9007199254740991` para `first` e `last`. Agora o adaptador Gemini
limita ambos ao menor/maior ID do lote enviado, preservando o schema original
dos outros provedores e a validação semântica posterior dos IDs. Isso remove
uma hipótese plausível de HTTP 400 por gramática complexa; **não comprova a causa
raiz sem a resposta detalhada ou uma futura validação autorizada**.

O endpoint REST `v1beta/models/{model}:generateContent`, `systemInstruction`,
`contents`, `generationConfig`, `maxOutputTokens`, `responseMimeType:
application/json` e `responseJsonSchema` constam da referência oficial.
Não enviamos `responseSchema` simultaneamente nem `$schema` no documento remoto.
`temperature: 0` está no intervalo documentado para 3.5 e não foi identificado
como parâmetro inválido. `minLength`/`maxLength` são ignorados pelo servidor;
a aplicação continua validando os comprimentos localmente. Não houve troca
de endpoint, modelo ou provedor para tentar mascarar o erro.

## Diagnóstico de futuras falhas

O corpo JSON de erro, limitado pela leitura existente a 128 KB, passa a ser
sanitizado e persistido em `LlmCall.response.httpError` quando a reserva falha.
Chave configurada, padrões de chave Google, Bearer e campos de credenciais são
ocultados. Corpos não JSON são omitidos. A mensagem pública continua curta;
detalhes técnicos ficam no registro interno. Não são armazenados cabeçalhos
de requisição, chave ou payload de transcrição no diagnóstico. Reservas e
consumo desconhecido permanecem conservados, sem liberar tentativas.

## Validação local

- 47 testes da API aprovados, incluindo três novos testes de payload/diagnóstico.
- Transporte substituído por função local: URL, MIME, schema, IDs por lote,
  ausência de thinkingConfig em 3.5 e preservação de thinkingBudget em 2.5.
- Resposta estruturada local interpretada; erro 400 com detalhes sanitizado,
  persistido e classificado como não retentável.
- Testes existentes de quota, cache, retries e demais provedores preservados.

Nenhum MP4/SRT com seleção Gemini foi produzido nesta etapa. Os testes locais
não demonstram aceitação do payload pela API nem qualidade editorial real.

## Referências oficiais consultadas

- [REST generateContent e GenerationConfig](https://ai.google.dev/api/generate-content)
- [Thinking: níveis e padrão por modelo](https://ai.google.dev/gemini-api/docs/thinking)
- [Structured outputs: limitações e complexidade de schema](https://ai.google.dev/gemini-api/docs/structured-output)

A documentação de saídas estruturadas informa que limites numéricos e schemas
complexos podem causar `400 INVALID_ARGUMENT`; restrições de comprimento de
strings são ignoradas pelo servidor, não consideradas aqui causa comprovada.
