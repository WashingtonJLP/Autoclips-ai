# Provedores de IA

| Modo       | Configuração                                                                                                        | Limitações                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Mock       | `LLM_PROVIDER=mock`, `LLM_MODEL=mock-v1`                                                                            | Simulação determinística; sem análise semântica                         |
| Heurística | `LLM_FALLBACK=heuristic` ou opção da produção                                                                       | Fallback local identificado; não é inferência LLM                       |
| Gemini     | Provedor `gemini`, modelo explícito, `GEMINI_API_KEY`, `LLM_ALLOW_EXTERNAL=true`, `GEMINI_FREE_TIER_CONFIRMED=true` | Gratuidade depende do projeto/modelo; quota e erros continuam possíveis |
| OpenAI     | Provedor `openai`, modelo/chave, permissão externa/paga e preços                                                    | Pode gerar cobrança; não habilitado nesta entrega                       |
| Ollama     | Provedor `ollama`, modelo local, `LLM_OLLAMA_URL`                                                                   | Servidor/modelo previamente instalados; consumo local de CPU/RAM        |

O exemplo usa mock, acesso externo/pago desabilitado. A configuração local existente foi preservada. Nenhuma cobrança é habilitada e os testes desta refatoração não chamam APIs externas de IA. Use override temporário mock para integração.

Gemini usa REST `generateContent` e JSON estruturado; OpenAI usa chat com schema; Ollama usa chat local. Zod valida respostas antes de gerar cortes. Resultados registram provedor efetivo, modelo, `simulated`, fallback, notas, justificativas e consumo informado. Não deduza o provedor antigo pela configuração atual.

## Orçamentos

`LLM_MAX_INPUT_TOKENS`, `LLM_MAX_OUTPUT_TOKENS`, `LLM_MAX_CHUNKS`, `LLM_MAX_CLIPS`, `LLM_MIN_DURATION`, `LLM_MAX_DURATION`, `LLM_MIN_SCORE` e `LLM_MAX_RETRIES` limitam execuções. `LLM_RUN_TOKEN_BUDGET`, `LLM_DAILY_TOKEN_BUDGET`, `LLM_RUN_COST_MICROS`, `LLM_DAILY_COST_MICROS` controlam reservas de consumo. OpenAI requer `LLM_ALLOW_PAID=true` e preços explícitos (`LLM_INPUT_USD_PER_MILLION`, `LLM_OUTPUT_USD_PER_MILLION`). Gemini tem `GEMINI_DAILY_REQUEST_LIMIT`.

Não zere ledger nem aumente orçamento para contornar quota. HTTP 400 pede revisão de contrato/modelo; 429 pede respeito ao limite. Diagnósticos Gemini anteriores não comprovam seleção semântica bem-sucedida. Nesta entrega, os adaptadores externos têm testes de contrato; Whisper e FFmpeg executam de verdade.

Contexto e clareza acompanham os critérios de gancho, valor, humor, emoção e engajamento. Notas não preveem alcance, monetização ou viralização. Veja [validação](validation.md).
