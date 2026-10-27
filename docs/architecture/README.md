# Arquitetura

Monorepo npm: dashboard Next.js, API NestJS, PostgreSQL via Prisma e Redis/BullMQ.
O worker FastAPI executa mídia em CPU/INT8, com um processamento por vez.
Fluxo: fonte autorizada → mídia local → fila → transcrição → seleção de trechos
→ corte vertical → legenda → simulação de publicação. Descoberta e publicação
real serão integrações futuras. Serviços internos não são expostos à internet.
