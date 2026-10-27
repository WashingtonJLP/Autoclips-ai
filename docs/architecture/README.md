# Arquitetura

Monorepo npm: dashboard Next.js, API NestJS, PostgreSQL via Prisma e Redis/BullMQ.
O worker FastAPI executa mídia em CPU/INT8, com um processamento por vez.
Fluxo: fonte autorizada → mídia local → fila → transcrição → seleção de trechos
→ corte vertical → legenda → simulação de publicação. Descoberta e publicação
real serão integrações futuras. Serviços internos não são expostos à internet.

## Fluxo implementado

O navegador usa rotas de proxy com destinos permitidos no Next.js; apenas o
servidor conhece o endereço interno da API. A API valida contratos Zod e salva
fontes/evidências e tarefas no PostgreSQL. A fila carrega somente o identificador
da tarefa, lendo a autorização do banco antes de chamar o worker por HTTP.

Um worker BullMQ com concorrência global 1 chama FastAPI. Uma trava no Python
serializa ASR e FFmpeg. Arquivos entram por montagem local `media`, e resultados
JSON/SRT/MP4 ficam em `media/outputs`. Metadados e status permanecem no banco;
Redis guarda a fila em AOF. Migrações são aplicadas antes de iniciar a API.

O dashboard mostra as últimas 100 fontes e tarefas e atualiza a cada 5 segundos.
Publicar retorna somente simulação. Não há integração externa de publicação.
Os caminhos de saída são exibidos; download de artefatos pela interface é futuro.
