# AutoClips AI

[Importação automática por URL: yt-dlp autorizado, APIs oficiais e testes](docs/importacao-url.md).

[YouTube: métodos autorizados de obtenção do original e teste real](docs/youtube-obtencao-autorizada.md).

[Criação simplificada e Biblioteca: funcionamento, exclusão e validação](docs/criacao-simplificada.md).

[Verificação funcional final do MVP — resultados e pendências](docs/validacao-final-mvp.md).

[Seleção inteligente com Gemini: configuração, critérios e validação pendente](docs/selecao-inteligente.md).

O fluxo por link, upload, vídeos importados e monitoramento está descrito em
[Criação multiorigem](docs/multiorigem.md). Consulte também os
[testes reais da expansão](docs/validacao-multiorigem.md).

Plataforma MIT para produzir vídeos curtos com reutilização comercial verificada.
Publicação permanece em **simulação**. CC BY/CC0 não garantem monetização:
verifique origem, atribuição e direitos de terceiros.

## Tecnologias e execução

Next.js/TypeScript/Tailwind, NestJS, Prisma/PostgreSQL, Redis/BullMQ e
Python 3.12/FastAPI/faster-whisper/FFmpeg. CPU/INT8, sem GPU.

O conjunto completo roda pelo Docker Compose descrito abaixo. Python, PostgreSQL
e Redis são acessíveis somente pela rede Docker, sem portas publicadas no host.
Migrações são aplicadas no container da API. Node 22 e Python 3.12 locais são usados
pelas validações de desenvolvimento, sem necessidade de expor os serviços internos.

Dashboard: http://localhost:3100; API: http://localhost:3101/health.
O worker usa `http://worker:8000` dentro da rede Docker, com documentação em `/docs`.

## Docker

```powershell
node scripts/setup-local.mjs
docker compose config --quiet
docker compose up -d --build --wait
docker compose ps
```

No Compose, banco, Redis e worker são internos. Web e API ficam em loopback.
As portas do host são exclusivas do AutoClips: `3100 → web:3000` e
`3101 → api:3001`. As portas 3000/3001 do host ficam reservadas ao MatchPredict.
O proxy Next.js usa `http://api:3001` internamente; não troque essa URL pela porta
do host. `npm run dev:web`/`start` usam 3100, e a API fora do Docker usa 3101 por padrão.
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
Coleta por conectores, seleção e fluxo automático estão integrados. Publicação real
permanece bloqueada. Veja o [procedimento pelo dashboard](docs/development/operacao.md).

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
padrão. Há adaptadores opcionais Ollama local e OpenAI, este com autorização
de consumo paga e reservas obrigatórias. Inferência real e qualidade semântica
ainda exigem credenciais e autorização. Veja [seleção](docs/development/selecao.md).
Coleta Commons/catálogo autorizado, evidências, download restrito, fluxo automático,
OAuth, agendamento simulado, autenticação e download de MP4/SRT estão implementados.
O dashboard exige as credenciais do `.env` geradas por `node scripts/setup-local.mjs`.
O novo [dashboard administrativo](docs/development/dashboard.md) separa Visão geral,
Criar cortes, Biblioteca, Publicações, Fontes e Configurações, com paginação e prévias
carregadas sob demanda. A autenticação e a API existente são preservadas.
As evidências são revisadas pelo operador; não há verificação jurídica automática
nem gestão multiusuário. [Operação, segurança e Neon](docs/development/operacao.md).
