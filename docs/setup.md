# Instalação no Windows

## Requisitos e execução

Docker Desktop com WSL2/containers Linux, Git e Node.js `>=22.17 <23`. Reserve memória para o worker (limite Compose de 4 GB) e os demais serviços. O primeiro Whisper precisa baixar o modelo. FFmpeg está na imagem worker; para fixtures e testes nativos, instale FFmpeg/FFprobe também no host.

```powershell
node scripts/setup-local.mjs
docker compose config --quiet
docker compose up -d --build --wait
docker compose ps
```

O setup completa somente segredos ausentes no `.env`. Use `DASHBOARD_USER`/`DASHBOARD_PASSWORD` para entrar em `http://localhost:3100`. API: `http://localhost:3101`. O container API aplica migrações Prisma antes de iniciar. Não resolva falhas apagando dados ou volumes.

## Operação

```powershell
docker compose build
docker compose up -d --wait
docker compose logs --tail 100 api worker web
docker compose stop
docker compose start
```

`stop` preserva containers e volumes. Não use `down -v`, reset do Prisma ou limpeza de `media/`. Opere apenas o projeto Compose `autoclips-ai`; não altere outros projetos.

## Configuração

Veja [`.env.example`](../.env.example). O Compose injeta endereços internos.

| Grupo               | Variáveis                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Banco               | `POSTGRES_PASSWORD`, `DATABASE_URL`; Docker usa o serviço `postgres`                                                                       |
| Neon opcional       | `NEON_DATABASE_URL` pooled para runtime, `NEON_DIRECT_DATABASE_URL` direta para migrações; TLS; override `compose.neon.yaml`               |
| Rede                | `REDIS_HOST`, `REDIS_PORT`, `WORKER_URL`, `API_URL`                                                                                        |
| Segredos            | `INTERNAL_API_TOKEN`, `WORKER_API_TOKEN`, `DASHBOARD_USER`, `DASHBOARD_PASSWORD`, `PLATFORM_TOKEN_KEY`                                     |
| Worker              | `MEDIA_ROOT`, `WHISPER_MODEL`, `WHISPER_CPU_THREADS`; Compose fixa `/media`, `tiny`, 2 threads; ajuste o Compose para alterar no container |
| Download direto     | `MEDIA_DOWNLOAD_ENGINE=native` ou `yt-dlp` para arquivos HTTPS; YouTube escolhe seu extrator automaticamente                               |
| Catálogos opcionais | `MEDIA_DOWNLOAD_HOSTS` separado por vírgula; `SOURCE_MANIFEST_URLS` e `SOURCE_FEED_URLS` como arrays JSON                                  |
| Metadados/APIs      | `YOUTUBE_API_KEY` opcional; `TWITCH_CLIENT_ID`, `TWITCH_ACCESS_TOKEN`, `VIMEO_ACCESS_TOKEN`                                                |
| IA                  | `LLM_*`, `GEMINI_*`, `OPENAI_API_KEY`; [detalhes](ai-providers.md)                                                                         |
| OAuth               | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI`; equivalentes `TIKTOK_*`; [detalhes](publishing.md)                   |

Credenciais existentes são preservadas. O exemplo usa mock e APIs pagas desabilitadas. Não habilite faturamento para testar.

Quantidade, duração, idioma e legendas são preferências da tela Criar cortes, não exigem variáveis novas. Legendas visuais vêm ativadas por padrão e são persistidas por produção; o SRT permanece separado nas duas opções. O pedido autenticado inicia diretamente, sem confirmação manual de direitos. Informações de reutilização/publicação ficam em Configurações.

## Desenvolvimento

```powershell
npm ci
npm run db:generate
npm run dev:web
# Em outro terminal, com serviços e variáveis acessíveis no host:
npm run dev:api
```

Banco, Redis e worker não publicam portas no host por padrão. Prefira Docker completo para integração. Desenvolvimento híbrido exige configurar acessos explicitamente sem conflitar com 3100/3101. `dev:api` respeita `PORT`/`HOST`; não presume a rede Docker.
