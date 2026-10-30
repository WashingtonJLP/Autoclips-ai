# Ativação e teste real do Gemini — 29/10/2026

**Estado atual:** elegibilidade gratuita confirmada pelo operador para `gemini-3.5-flash-lite`.
Foi enviada uma única nova chamada, recusada com HTTP 400. O teto de duas tentativas
de 29/10/2026 foi atingido; nenhuma seleção real ou MP4/SRT Gemini foi produzido.

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

Configuração local enquanto a verificação estava pendente:

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

## Retomada autorizada e resultado real do 3.5 Flash-Lite

O operador confirmou diretamente no AI Studio o nível gratuito e a disponibilidade
do modelo no projeto da chave, com RPM 15, TPM 250.000 e RPD 500. Foi aplicado
`GEMINI_FREE_TIER_CONFIRMED=true`, preservando `LLM_ALLOW_PAID=false`, limite local
persistente de duas tentativas por dia UTC, zero retries e nenhum fallback.

O script foi executado uma única vez com `GEMINI_VALIDATION_MODEL=gemini-3.5-flash-lite`.
Foram reutilizados vídeo e transcrição reais autorizados, sem solicitar nova inferência
de Whisper. A API oficial respondeu **HTTP 400**:

> Request contains an invalid argument.

Não houve resposta estruturada com candidatos, títulos, notas ou justificativas.
O erro não identificou qual argumento foi recusado; a causa específica não foi
comprovada. É necessária revisão do payload antes de outra validação autorizada.
Não foi feita nova chamada para investigar, listar modelos ou repetir a análise.

Resultados verificados no ledger e nas tarefas:

- Chamadas novas ao Gemini nesta retomada: **1**.
- Total de tentativas registradas em 29/10/2026: **2/2**, ambas falhas (404 do 2.5 Flash
  e 400 do 3.5 Flash-Lite).
- Tokens de entrada/saída efetivamente informados: **não disponíveis** nas respostas
  de erro; não foram apresentados como consumo zero medido.
- Reservas locais: 3.905 tokens de entrada + 3.000 de saída por tentativa, total
  conservador de 13.810 tokens reservados, distinto de consumo informado pelo Google.
- Seleção com `gemini-3.5-flash-lite`: tarefa `FAILED`, sem resultado e sem cortes filhos.
- MP4/SRT a partir desta seleção: **não gerados**, pois não existiu seleção válida.
- Biblioteca: nenhum novo corte desta seleção foi marcado como IA; os arquivos de
  testes anteriores não foram reapresentados como sucesso Gemini.
- Aplicação: provedor Gemini, `simulated=false`, sem mock, fallback ou publicação.
  Nenhum faturamento foi habilitado e a chave permaneceu somente no `.env` local.

O relatório local é `artifacts/gemini-35-validation-failed.json`. O limite foi mantido,
sem reset nem aumento, e o teste foi encerrado sem uma terceira tentativa.

# Nova validação do schema corrigido — 30/10/2026 UTC

O orçamento persistido foi consultado antes da execução: 0/2 no dia UTC
2026-10-30. Os dois registros FAILED de 2026-10-29 permaneceram intactos.
O ledger usa a data UTC; a renovação natural ocorreu às 21h de 29/10 em
America/Sao_Paulo. Nenhum contador foi reiniciado ou alterado.

A imagem da API foi reconstruída e somente esse serviço foi recriado para
carregar a correção `73f06eb`. Conferimos o schema corrigido dentro do container,
ausência de tarefas ativas e de automações habilitadas antes da execução.
Foi reutilizada uma transcrição real faster-whisper já concluída da fixture
autorizada `semantic-speech.mp4`, da outra fonte de teste existente, sem
apagar ou repetir automaticamente a seleção anterior que falhou. O roteiro
agora aceita `GEMINI_VALIDATION_TRANSCRIPT_ID` para selecionar explicitamente
essa transcrição; o limite diário continua global ao provedor.

Foi realizada **exatamente uma chamada nova** a `gemini-3.5-flash-lite`, sem
retries e sem fallback. A seleção `cmvu7p6ea00003epq5cyabqw4` falhou com HTTP 400.
O corpo completo sanitizado foi preservado em `LlmCall.response.httpError`:

```json
{
  "error": {
    "code": 400,
    "message": "Request contains an invalid argument.",
    "status": "INVALID_ARGUMENT"
  }
}
```

A resposta não contém `details`, `fieldViolations` ou outro identificador de
parâmetro. Portanto, **não foi possível identificar exatamente o campo rejeitado**.
O resultado demonstra que limitar os IDs do schema não foi suficiente para
resolver o erro; não confirma a hipótese anterior como causa raiz. Não houve
segunda chamada para testar outras variações de payload.

Após a tentativa: **1/2** reservas Gemini no dia UTC 2026-10-30; os registros
anteriores continuam presentes. Reserva conservadora de 6.905 tokens (3.905
entrada estimada + 3.000 saída máxima), não consumo medido. A resposta de erro
não informou tokens ou cobrança: campos de uso permanecem nulos. O custo
reservado pela aplicação é zero; nível gratuito confirmado pelo operador,
`LLM_ALLOW_PAID=false`, sem operação de ativação de faturamento.

Nenhum corte, MP4 ou SRT novo foi gerado, pois não houve seleção estruturada
válida. A identificação como IA na Biblioteca e o pipeline completo Gemini
**continuam sem validação real bem-sucedida**. Lint e formatação do roteiro
passaram. Relatório local detalhado em
`artifacts/gemini-corrected-schema-validation.json` (ignorado pelo Git).
Uma próxima chamada depende de nova autorização, apesar de restar uma reserva.
