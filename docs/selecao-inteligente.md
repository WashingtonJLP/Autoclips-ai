# Seleção inteligente de cortes

O pipeline existente agora solicita análise semântica estruturada ao Gemini (ou ao
provedor real configurado), com justificativa e notas de gancho, contexto, informação,
clareza, humor, emoção e engajamento. Contexto e clareza são obrigatórios; os outros
critérios podem ser priorizados no dashboard e na busca por temas. Notas não são
previsões de visualizações ou garantia de viralização.

**Validação Gemini real pendente:** não havia chave configurada. O operador escolheu
concluir a implementação sem credenciais e registrar essa pendência. Os testes REST
do Gemini usam transporte controlado, sem inferência. O teste ponta a ponta executado
usou Whisper e FFmpeg reais com **fallback heurístico explicitamente identificado**.
Não foi persistido um resultado Gemini fictício como se fosse análise real.

## Ativar Gemini

Configure o `.env` local, sem versionar nem enviar a chave pelo navegador:

```dotenv
LLM_PROVIDER=gemini
LLM_MODEL=gemini-2.5-flash
GEMINI_API_KEY=preencha_localmente
LLM_ALLOW_EXTERNAL=true
LLM_ALLOW_PAID=false
# Somente após confirmar que o projeto/modelo utiliza o nível gratuito:
GEMINI_FREE_TIER_CONFIRMED=true
LLM_FALLBACK=none
LLM_MAX_RETRIES=2
LLM_MAX_INPUT_TOKENS=12000
LLM_MAX_OUTPUT_TOKENS=2400
LLM_MAX_CHUNKS=8
LLM_RUN_TOKEN_BUDGET=100000
LLM_DAILY_TOKEN_BUDGET=300000
LLM_RUN_COST_MICROS=0
LLM_DAILY_COST_MICROS=0
```

O modelo acima é um exemplo; confirme disponibilidade, cota e modalidade no projeto
Google. Uma chave não comprova gratuidade. Projetos pagos continuam exigindo
`LLM_ALLOW_PAID=true`, preços positivos e orçamento explícito. A aplicação não verifica
o faturamento do projeto Google por conta própria e não habilita cobrança.

```powershell
docker compose up -d --build
```

Confira **Configurações → Inteligência artificial**. Sem chave, autorização externa
ou modalidade de consumo válida, a API continua disponível, mas informa que a IA não
está configurada. Uma produção sem fallback falha com a causa real. O `.env` existente
não foi convertido automaticamente para Gemini; permanece a configuração do operador.

## Uso e limites

Em **Criar cortes**, defina quantidade e duração mínima/máxima. Abra **Critérios da
seleção e fallback** para priorizar sinais, definir nota mínima e escolher a política
de indisponibilidade. **Fontes → Busca automática** oferece os mesmos critérios e
durações de cortes, separados dos filtros de duração do vídeo de origem. Importação,
elegibilidade, autoria e autorização continuam sendo verificadas pelos serviços existentes.

O modelo recebe unidades de frases com IDs. Quando há palavras do Whisper, os
limites vêm diretamente dos timestamps das palavras; sem palavras, agrupam-se segmentos
inteiros. Tempos nunca são interpolados pelo tamanho do texto nem aceitos como números
inventados pela IA. A renderização verifica os limites novamente contra a transcrição.
Caudas sem pontuação conclusiva são omitidas conservadoramente. Isso pode resultar em
nenhum corte quando o ASR não reconhece pontuação ou a fala termina incompleta.

O prompt trata a transcrição como dados não confiáveis, exige preparação/conclusão
das ideias e piadas e pede justificativas fundamentadas na fala. O backend valida
schema, IDs, duração, contexto/clareza mínimos e fala relevante. Candidatos inválidos
são descartados com avisos. Similaridade de texto e sobreposição temporal removem
repetições. A avaliação continua limitada ao texto: não analisa expressão facial,
tom acústico ou conteúdo visual. Revise os resultados antes de usar.

Gemini 2.5 Flash usa pensamento desativado para esta tarefa, limite de saída explícito
e contabilização dos tokens informados, inclusive pensamento quando reportado.
Respostas são limitadas a 128 KB. O ledger existente reserva tokens e custo antes de
chamar o provedor. Não houve substituição do controle financeiro.

Erros HTTP transitórios Gemini (`429`, `500`, `502`, `503`, `504`) admitem até duas
novas tentativas com backoff e `Retry-After` limitado a trinta segundos. Cada tentativa
tem reserva própria e deve caber no orçamento da execução e do dia. Falhas de rede ou
timeout com consumo desconhecido não são repetidas cegamente; a reserva é mantida.
Erros de credencial não têm retry automático. Resposta estruturada inválida, violação
de orçamento e falta de trechos não são apresentadas como análise bem-sucedida.

## Fallback transparente

`LLM_FALLBACK=heuristic` permite a regra local como política do servidor. Cada produção
pode escolher `none` ou `heuristic`; opção vazia no formulário herda o servidor.
O fallback só se aplica a indisponibilidade/configuração do provedor, não transforma
estouro de orçamento em uma chamada autorizada. Ausência de candidatos válidos não
aciona automaticamente uma seleção inventada.

Resultados registram `selectionOrigin` (`llm`, `heuristic`, `mock` ou `none`),
`semanticAnalysis`, provedor/modelo, justificativas, notas e avisos. Esses dados
acompanham os MP4 na Biblioteca. **Heurística local** aparece fora dos detalhes
avançados e não é apresentada como LLM. Mock continua disponível para testes e
identificado como simulação. Nenhuma frase completa significa nenhuma análise enviada.

Se uma indisponibilidade transitória gerou fallback, o resultado continua identificado
e pode ser reaproveitado. Para solicitar uma nova análise após a recuperação, use
**Reprocessar explicitamente**. Uma mudança de provedor/modelo ou de disponibilidade
de configuração também distingue o cache de uma produção nova.

## Reaproveitamento e banco sob demanda

Produções com novas preferências podem reutilizar uma transcrição concluída da mesma
fonte, arquivo e idioma. A análise tem chave de política versionada, conteúdo da
transcrição e identidade da mídia; uma seleção idêntica é reutilizada, inclusive na
solicitação manual. O cache do ledger considera a solicitação efetiva e o escopo da
mídia, permitindo aplicar outro limiar de nota sem repetir uma inferência equivalente.
Reprocessamento explícito cria um novo escopo de inferência, preservando a transcrição.

Nada disso depende de polling SQL: consultas ocorrem ao criar uma produção, consumir
um evento BullMQ, atender uma consulta do operador ou recuperar trabalho no startup.
Agendamentos e coordenação permanecem no Redis. `/health` continua sem consultar o
PostgreSQL; nenhuma configuração Neon real foi alterada. Não houve nova migração.

## Testar

```powershell
npm test
npm run lint
npm run build
apps/worker-python/.venv/Scripts/python.exe -m pytest apps/worker-python/tests -q -o pythonpath=apps/worker-python
powershell -NoProfile -File scripts/create-fixture.ps1 -Name semantic-speech -Profile semantic
node scripts/semantic-selection-smoke.mjs
```

O perfil `semantic` gera texto original educativo, voz local e imagem FFmpeg, sem APIs
ou conteúdo de terceiros. Preserva arquivos existentes e exige outro nome se já houver
fixture. `SEMANTIC_FIXTURE_PATH` permite usar outra mídia autorizada; o padrão é
`fixtures/semantic-speech.mp4`. O smoke padrão exige Gemini configurado e análise
`selectionOrigin=llm`, valida métricas, justificativas, cache, limites reais, MP4/SRT
pelo proxy do dashboard e reaproveitamento da transcrição.

Para testar somente o fallback, configure Gemini indisponível e `LLM_FALLBACK=heuristic`
no ambiente de teste e execute com `SEMANTIC_EXPECTED_ORIGIN=heuristic`. Esse modo exige
origem heurística e produz relatório `geminiRealValidated=false`. Não é comprovação de
inferência Gemini. Os relatórios e os arquivos ficam em `artifacts/`, fora do Git.

### Validação desta entrega

- 41 testes API aprovados, incluindo contrato REST Gemini com transporte falso,
  limites de frases, IDs inválidos, contexto, ausência de fala, cache, retry, orçamento
  e fallback, além do encaminhamento de critérios por temas apenas para mídia elegível;
  7 testes frontend aprovados, incluindo identificação e escape da justificativa.
- Python: 13 aprovados, 1 ignorado por privilégio de symlink no Windows.
- Whisper real na fixture educativa; dois cortes heurísticos com MP4/SRT reais,
  qualidade validada e downloads autenticados. Repetição da seleção e reaproveitamento
  de transcrição foram verificados. Nenhuma chamada externa à IA ou publicação.
- Build local e Docker, ESLint e Ruff executados. A configuração local original é
  restaurada após o teste de fallback; o teste usou override Docker sem chave.
- Inferência Gemini real e julgamento semântico de um vídeo por Gemini: **pendentes**.
  Não foram medidas precisão editorial, engajamento ou cotas reais do projeto Google.

Referências oficiais: [saída estruturada](https://ai.google.dev/gemini-api/docs/structured-output),
[modelos](https://ai.google.dev/gemini-api/docs/models),
[preços/modalidades](https://ai.google.dev/gemini-api/docs/pricing).
