# Ativação e teste real do Gemini — 29/10/2026

**Estado atual:** `gemini-3.5-flash-lite` configurado como modelo principal, mas geração
bloqueada até confirmar a elegibilidade do projeto e da chave. Nenhuma solicitação
Gemini adicional foi enviada após o HTTP 404 do 2.5 Flash.

O operador confirmou projeto gratuito e cota de vinte requisições/dia para
`gemini-2.5-flash`. A chave foi preenchida localmente no `.env` da raiz do repositório,
sem ser impressa, incluída em relatórios ou versionada.

## Configuração do primeiro teste (2.5 Flash)

- Provedor principal: `gemini`; modelo: `gemini-2.5-flash`; `simulated=false`.
- `LLM_ALLOW_EXTERNAL=true`, `GEMINI_FREE_TIER_CONFIRMED=true` e `LLM_ALLOW_PAID=false`.
- `GEMINI_DAILY_REQUEST_LIMIT=2`: limite persistido por dia UTC no ledger existente.
  Reservas falhas/ambíguas também contam conservadoramente. Cache não consome reserva
  nova; os outros provedores não são afetados. Não há polling SQL nem migração nova.
- Uma única divisão de transcrição e zero retries: `LLM_MAX_CHUNKS=1`,
  `LLM_MAX_RETRIES=0`, `LLM_FALLBACK=none`. Nenhum mock ou fallback se passa por IA.
- Entrada até 12.000 tokens estimados; saída até 3.000; orçamento de 20.000 tokens
  por execução e 40.000/dia. Orçamentos financeiros permanecem em zero.
- Nenhum faturamento ou publicação foi habilitado. Não foram feitas chamadas ao
  endpoint de listagem de modelos, preservando a cota do teste.

O ledger verifica a quantidade de reservas Gemini dentro da transação serializável
já existente, antes de permitir o transporte. O teste unitário verifica bloqueio da
terceira reserva, reaproveitamento de cache e independência de outros provedores.

## Primeira tentativa real

Foi reutilizada uma transcrição real de faster-whisper da mídia educativa autorizada
`fixtures/semantic-speech.mp4`. A solicitação cabia em um único bloco, com estimativa
de 3.905 tokens de entrada. A API recebeu **uma** solicitação `generateContent`.

Resposta oficial: **HTTP 404**. Mensagem recebida:

> This model models/gemini-2.5-flash is no longer available to new users.

O Google recomendou outro modelo, mas ele não foi adotado automaticamente: a
autorização de gratuidade recebida se referia ao 2.5 Flash. Foi solicitado ao operador
somente o identificador e a cota de um modelo de texto disponível no nível gratuito
do seu projeto, sem pedir a chave novamente.

- Chamadas HTTP ao Gemini nesta tentativa: **1**.
- Inferências concluídas: **0**.
- Tokens efetivamente informados pelo Google: **nenhum**; a resposta não trouxe métricas
  de uso. A reserva local de 6.905 tokens foi mantida como proteção, não como consumo
  medido. O limite diário local registra uma tentativa utilizada.
- Resultado: nenhuma seleção por IA foi produzida; portanto não foi gerado novo
  MP4/SRT a partir de Gemini nem declarado sucesso de origem IA na Biblioteca.
- Resta uma tentativa dentro do teto de duas autorizado para a validação.

Um erro do modelo não deve ser confundido com falha de transcrição, renderização ou
chave exposta. O adaptador preserva o diagnóstico oficial e remove a chave se ela
aparecer no texto do erro. Esse comportamento também tem teste unitário sem rede.

## Retomar

Após o operador confirmar um modelo gratuito acessível, ajuste `LLM_MODEL` localmente
e recrie somente a API. Não aumente o limite de duas requisições para concluir o teste.
`scripts/gemini-activation-smoke.mjs` faz uma análise, valida timestamps/notas/títulos/
justificativas e então renderiza/baixa MP4 e SRT sem novas chamadas ao Gemini.
O parâmetro de ambiente `GEMINI_VALIDATION_MODEL` precisa coincidir com o modelo
explicitamente autorizado; o padrão continua sendo `gemini-2.5-flash`.

Os relatórios e a mídia ficam em `artifacts/`, fora do Git. Apenas configurações de
exemplo, código e documentação são versionados.

## Mudança para 3.5 Flash-Lite

O operador solicitou `gemini-3.5-flash-lite`. Foram consultadas as páginas oficiais
de [preços](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite) e do
[modelo](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), que
confirmam entrada/saída de texto gratuitas no Free Tier e suporte a saída estruturada.

Isso confirma a oferta pública, não o tier efetivo do projeto associado à chave.
A [documentação de faturamento](https://ai.google.dev/gemini-api/docs/billing#verify-billing-status)
orienta consultar Billing Tier em Projects no AI Studio. A chave de inferência e a
resposta de metadados de um modelo não comprovam, sozinhas, essa condição financeira.

Foi tentada consulta de leitura à sessão autenticada do navegador. O host de acesso
ao navegador estava indisponível; a página Projects pela ferramenta web redirecionou
para login. Não foi possível confirmar o tier do projeto ou a disponibilidade do
modelo para essa chave. Não foram solicitadas credenciais de login nem dados de pagamento.

Conforme a condição expressa do operador, **nenhuma chamada Gemini nova foi enviada**,
inclusive consultas de metadados que consumiriam outra tentativa sem comprovar o tier.
Foi solicitado somente confirmar que o mesmo projeto da chave aparece como Free e
que o modelo tem cota de requisições maior que zero no AI Studio.

Configuração local atual:

```dotenv
LLM_PROVIDER=gemini
LLM_MODEL=gemini-3.5-flash-lite
GEMINI_FREE_TIER_CONFIRMED=false
GEMINI_DAILY_REQUEST_LIMIT=2
LLM_ALLOW_PAID=false
LLM_MAX_RETRIES=0
LLM_FALLBACK=none
```

`GEMINI_FREE_TIER_CONFIRMED=false` é um bloqueio deliberado enquanto a verificação
está pendente. Com faturamento não autorizado, o provedor rejeita o envio antes do
transporte; a aplicação continua disponível, fora do modo mock. A chave local foi
preservada. Não houve mudança de billing, reset do contador ou alteração dos outros
provedores. Continua registrada uma tentativa Gemini falha; resta uma do teste original.

Depois da confirmação do projeto, a retomada usa `GEMINI_VALIDATION_MODEL=gemini-3.5-flash-lite`,
mantendo o teto persistente e sem repetir a chamada ao modelo 2.5 descontinuado.
