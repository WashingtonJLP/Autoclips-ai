# AutoClips AI

Plataforma MIT para produzir vídeos curtos com reutilização comercial verificada.
Publicação permanece em **simulação**. CC BY/CC0 não garantem monetização:
verifique origem, atribuição e direitos de terceiros.

## Tecnologias e execução

Next.js/TypeScript/Tailwind, NestJS, Prisma/PostgreSQL, Redis/BullMQ e
Python 3.12/FastAPI/faster-whisper/FFmpeg. CPU/INT8, sem GPU.

Requer Node 22 e Python 3.12. Na raiz:

O caminho recomendado para o conjunto completo é o Docker Compose descrito abaixo.
Para desenvolver a API fora do Docker, forneça `DATABASE_URL`, `REDIS_HOST` e
`WORKER_URL` de serviços acessíveis e aplique `npm run db:migrate`. As portas
de banco/Redis/worker do Compose não são publicadas por padrão.

```powershell
npm ci
npm run db:generate
npm run dev:api
# Em outro terminal:
npm run dev:web
```

Worker em outro terminal:

```powershell
cd apps/worker-python
py -3.12 -m venv .venv
.venv/Scripts/python.exe -m pip install uv==0.13.6
.venv/Scripts/uv.exe sync --frozen
.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Dashboard: http://localhost:3000; API: http://localhost:3003/health;
worker: http://localhost:8000/health e documentação em `/docs`.

## Docker

```powershell
docker compose config --quiet
docker compose up -d --build --wait
docker compose ps
```

No Compose, banco, Redis e worker são internos. Web e API ficam em loopback.
A porta local 3003 evita conflito com outro projeto existente na máquina.
Consulte [implantação](docs/deployment/README.md) para volumes e TrueNAS.

## Validação

```powershell
npm run lint
npm test
npm run build
cd apps/worker-python
.venv/Scripts/python.exe -m pytest
.venv/Scripts/ruff.exe check .
```

## Roadmap

Base de serviços → infraestrutura Compose → fontes e evidências → fila interna
→ transcrição → cortes verticais e legendas → revisão e publicação autorizada.
Descoberta automática, seleção inteligente e publicação real são trabalhos futuros.

Consulte [arquitetura](docs/architecture/README.md),
[ambiente](docs/development/ambiente.md) e [decisões](docs/decisions/0001-base.md).

## Funcionalidades implementadas

- Dashboard com fontes, evidências, fila, resultados e publicação simulada.
- API com validação de direitos, migrações, persistência e readiness.
- BullMQ com execução sequencial, tentativas e histórico persistido.
- Transcrição tiny/CPU/INT8, segmentos, palavras e JSON.
- Cortes H.264/AAC 9:16, SRT sincronizado e legendas inseridas no vídeo.
- Testes com mídia sintética local e pipeline GitHub Actions.

Documentação: [API](docs/development/api.md), [mídia](docs/development/midia.md),
[qualidade](docs/development/qualidade.md) e [progresso](docs/development/progresso.md).
Seleção por provedores desacoplados, sugestões de títulos/descrições, controle de
tokens/custos e renderização a partir dos trechos estão implementados com mock
padrão. O adaptador opcional usa Ollama local; inferência real e qualidade semântica
ainda exigem validação. Veja [seleção e configuração](docs/development/selecao.md).
Descoberta, download autorizado e publicação real ainda não foram implementados.
As evidências são revisadas pelo
operador; não há verificação jurídica automática nem autenticação multiusuário.
