# Seleção de trechos e provedores LLM

O padrão é `LLM_PROVIDER=mock`: não envia dados a uma API e não representa uma
avaliação semântica real. Suas notas/títulos são heurísticas determinísticas para
validar o fluxo. Ollama é um adaptador opcional de chat local, com schema JSON,
limite de geração e duas threads. O adaptador foi testado com transporte HTTP
simulado; nenhuma inferência Ollama real ou API paga foi executada nesta etapa.
Referência do protocolo: [API oficial](https://github.com/ollama/ollama/blob/main/docs/api.md).

## Uso

Após uma transcrição concluída, clique em **Selecionar trechos** no dashboard.
A seleção aparece como tarefa e mostra títulos, descrições, tempos, nota final e
notas de gancho, contexto, valor e clareza. Revise a fala original e clique em
**Renderizar trecho com legendas** para criar uma tarefa `clip` no mesmo pipeline.
O resultado mantém os metadados editoriais no campo `editorial` da tarefa.

API local:

- `GET /llm/config`: configuração pública e orçamento comprometido do dia UTC.
- `POST /jobs/:id/select`, com `{}`: ID de uma transcrição concluída.
- `POST /jobs/:id/render-selection`, com `{"candidateId":"..."}`: ID da tarefa de seleção.
- `GET /jobs/:id`: resultado e consumo por chamada, quando informado.
- `GET /jobs/:id/llm-usage`: reservas e consumo, inclusive quando a seleção falha,
  sem retornar os prompts ou respostas brutas.

Seleções usam uma tentativa. Falhas não geram novas chamadas automaticamente.
O cache de respostas é persistido por tarefa, bloco e conteúdo do pedido; retomar
a mesma tarefa pode reutilizar respostas já obtidas. Criar outra seleção é uma
nova análise, sujeita ao orçamento. Não há cache global de transcrições privadas.

## Configuração no servidor

As opções são variáveis de ambiente; o cliente não escolhe modelo, preços ou limites.
Compose usa os mesmos padrões de `.env.example`. O NestJS local lê variáveis do
processo; não carrega `.env` automaticamente.

| Variável                            | Padrão                            | Significado                                  |
| ----------------------------------- | --------------------------------- | -------------------------------------------- |
| LLM_PROVIDER                        | mock                              | mock, ollama ou openai                       |
| LLM_MODEL                           | mock-v1                           | Modelo explícito do provedor                 |
| LLM_ALLOW_EXTERNAL                  | false                             | Habilita provedor fora do mock               |
| LLM_OLLAMA_URL                      | http://host.docker.internal:11434 | Serviço local, não provisionado pelo Compose |
| LLM_MAX_INPUT_TOKENS                | 6000                              | Limite estimado por chamada                  |
| LLM_MAX_OUTPUT_TOKENS               | 1600                              | Máximo de geração por chamada                |
| LLM_RUN_TOKEN_BUDGET                | 30000                             | Reserva máxima por seleção                   |
| LLM_DAILY_TOKEN_BUDGET              | 100000                            | Orçamento global por dia UTC                 |
| LLM_RUN_COST_MICROS                 | 0                                 | Reserva monetária máxima por seleção         |
| LLM_DAILY_COST_MICROS               | 0                                 | Orçamento monetário diário                   |
| LLM_MAX_CHUNKS                      | 8                                 | Máximo de blocos                             |
| LLM_MAX_CLIPS                       | 5                                 | Máximo de trechos finais                     |
| LLM_MIN_DURATION / LLM_MAX_DURATION | 5 / 60                            | Duração em segundos                          |
| LLM_MIN_SCORE                       | 4.5                               | Nota mínima                                  |

O simulador continua sendo o padrão. Não habilite um serviço externo/pago sem
autorização específica. O adaptador Ollama aceita apenas hosts locais previstos,
rejeita redirecionamentos e modelos com indicação `cloud`; não inclui credenciais,
API key ou provisionamento de modelos. O serviço local deve usar modelos já
disponíveis e inferência local. Ollama não é instalado automaticamente e não é
recomendado como requisito no i5-2310: o custo de CPU/RAM precisa de benchmark.

O adaptador OpenAI usa credencial exclusivamente por ambiente e saída estruturada,
sem SDK adicional. Exige autorização `LLM_ALLOW_PAID=true`, modelo explícito,
preços conservadores positivos e orçamento monetário positivo. Sem isso não envia
chamadas. Configure conforme [operação](operacao.md#ia-por-api-desabilitada-por-padrão).

## Economia, precisão e custos

Somente IDs, texto e timestamps são enviados. Palavras individuais, mídia,
evidências e credenciais ficam fora do prompt. O texto é tratado como dado não
confiável. O LLM retorna IDs `first`/`last`; tempos são derivados dos segmentos e
validados novamente antes da renderização. Uma ideia que cruza um limite de bloco
pode não ser encontrada; blocos têm sobreposição de até metade de sua capacidade.
Segmentos individuais que não cabem são rejeitados, sem truncar a fala.

Bytes UTF-8 do prompt/schema mais margem são usados como limite conservador para
reserva, não como tokenização exata. Todo o pedido passa pelo orçamento da seleção
antes da primeira chamada. A reserva diária é atômica por chamada, em transação
serializável PostgreSQL. Um dia pode bloquear um bloco posterior de uma seleção;
consumo de blocos anteriores permanece registrado. Limites menores de blocos e
saída economizam tokens, mas podem reduzir qualidade ou causar resposta truncada.

Notas: gancho 35%, contexto 25%, valor 25%, clareza 15%. Classificação: destaque
a partir de 8, recomendado a partir de 6, demais em revisão. Sobreposição >=65%
do menor intervalo ou Jaccard textual >=80% remove redundâncias. Cortes existentes
da mesma fonte/arquivo são excluídos; a renderização tem chave única de intervalo
e protege contra solicitações concorrentes e sobreposição excessiva.

`LlmBudget` mantém o total comprometido; `LlmCall` mantém reservas, consumo real
opcional, provedor, modelo e resposta. Valores monetários são inteiros em
milionésimos de USD. `null` significa não informado, nunca custo zero presumido.
O simulador informa zeros, pois não há inferência. Ollama informa tokens quando
disponíveis, mas não informa custo monetário. Sem métricas, conserva-se a reserva;
falhas de rede também a conservam. O adaptador tem cotação de chamada local zero,
sem estimar eletricidade ou hardware. Novos provedores devem fornecer um teto de
custo confiável antes do envio; preço desconhecido bloqueia a chamada. Se o
provedor exceder a reserva, registra-se o consumo e interrompe-se a seleção. Isso
não desfaz um custo já ocorrido: o provedor deve respeitar os limites enviados.

## Testes de integração sem LLM real

Com Compose iniciado, PowerShell na raiz (usa arquivo novo para preservar mídia):

```powershell
$fixture = 'fixtures/selection-' + [guid]::NewGuid().ToString('N') + '.mp4'
Get-Content -Raw scripts/create-selection-fixture.py | docker compose exec -T -e "SELECTION_FIXTURE_PATH=$fixture" worker python -
docker compose exec -T -e "SELECTION_FIXTURE_PATH=$fixture" api node scripts/selection-integration.cjs
```

Esse teste cria mídia sintética e uma transcrição stub declarada, sem executar
Whisper ou LLM real. Exercita API, fila, PostgreSQL, corte/legenda FFmpeg real,
reservas concorrentes, cache, consumo ausente, falhas e bloqueio por custo.
