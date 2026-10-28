# Arquitetura

Monorepo npm: dashboard Next.js, API NestJS, PostgreSQL via Prisma e Redis/BullMQ.
O worker FastAPI executa mídia em CPU/INT8, com um processamento por vez.
Fluxo: fonte autorizada → mídia local → fila → transcrição → seleção de trechos
→ corte vertical → legenda → simulação de publicação. A descoberta por Commons e
manifestos precede a aprovação do operador e o download restrito. Serviços internos
não são expostos à internet; publicação real continua bloqueada.

## Fluxo implementado

O navegador usa rotas de proxy com destinos permitidos no Next.js; apenas o
servidor conhece o endereço interno da API. A API valida contratos Zod e salva
fontes/evidências e tarefas no PostgreSQL. A fila carrega somente o identificador
da tarefa, lendo a autorização do banco antes de chamar o worker por HTTP.

Um worker BullMQ com concorrência global 1 chama FastAPI. Uma trava no Python
serializa ASR e FFmpeg. Arquivos entram por montagem local `media`, e resultados
JSON/SRT/MP4 ficam em `media/outputs`. Metadados e status permanecem no banco;
Redis guarda a fila em AOF. Migrações são aplicadas antes de iniciar a API.

O dashboard autenticado mostra as últimas 100 fontes e tarefas com atualização
manual. Artefatos são transmitidos pelo proxy autenticado, sem expor a raiz de mídia.
O frontend possui seis páginas no layout administrativo: Visão geral, Criar cortes,
Biblioteca, Publicações, Fontes e Configurações. As listas são paginadas em memória
e o player é carregado somente ao abrir a prévia. [Detalhes da interface](../development/dashboard.md).
OAuth usa state em Redis e tokens cifrados. Agendamentos são jobs atrasados, sempre
de simulação. Nenhum scheduler consulta o PostgreSQL periodicamente.

## Seleção de trechos

Uma tarefa `select` referencia a transcrição concluída e usa `LlmProvider`, sem
alterar o worker de mídia. O padrão mock não faz inferência. O adaptador opcional
Ollama usa chat local; OpenAI opcional exige autorização de consumo e preços
configurados. Ambos usam resposta estruturada. A seleção compacta texto por blocos,
deriva tempos de IDs reais, pontua, classifica e remove candidatos semelhantes.
O operador escolhe um trecho para gerar uma tarefa `clip`, reutilizando FastAPI e
FFmpeg. Títulos e descrições ficam em `Task.editorial` no corte.

`LlmBudget` e `LlmCall` registram reservas atômicas e consumo informado. Respostas
persistidas evitam repetir uma chamada da mesma tarefa/bloco. Falhas não provocam
novas chamadas LLM automáticas. Renderizações de um mesmo intervalo têm chave
única; transações serializáveis também impedem cortes sobrepostos em concorrência.
Veja [seleção](../development/selecao.md) e [ADR 0002](../decisions/0002-selecao-llm.md).

O modo automático encadeia download → transcrição → seleção → cortes na mesma
fila. Cada etapa é persistida e ligada por `parentId`, com continuação idempotente
e recuperação ao iniciar. Não existe fila paralela nem cron de varredura.
Veja [operação e limites](../development/operacao.md).
