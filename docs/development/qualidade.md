# Qualidade e reprodução

O workflow `Qualidade` executa Node (lint, formato, testes, build e auditoria),
Python (Ruff e Pytest com FFmpeg real) e Compose (build, migrações, health checks
e smoke de comunicação/fila/persistência). Não faz deploy nem publica vídeos.
Instalações usam `npm ci` e `uv sync --frozen`. O ASR real é um teste manual
separado para evitar download de modelos em toda execução do CI.

Na raiz: `npm run lint`, `npm run format:check`, `npm test`, `npm run build`,
`npm audit --audit-level=high`. No worker, com venv ativa: `ruff check .`,
`ruff format --check .` e `pytest`. Os testes de corte usam FFmpeg/FFprobe para
verificar dimensões, duração e SRT. Sem FFmpeg o teste correspondente é ignorado;
o CI instala o binário. O teste de symlink pode ser ignorado no Windows sem
privilégio de criação; deve executar no Linux.

Os health checks confirmam vida dos processos. `/ready` consulta também banco,
Redis e worker. A instalação e carga do modelo são validadas pelo smoke com
`--transcribe` ou `--media`, não pelo health check.

Não versione saídas, logs, caches, modelos ou credenciais. Antes do commit:
`git diff --cached --check`, `git diff --cached --stat` e revisão dos arquivos
em `git diff --cached --name-only`. `.env.example` contém somente placeholders.

## Resultados da implementação inicial

- Node: quatro testes aprovados (direitos, caminhos/intervalos, health e erros do worker).
- Python no Windows: sete aprovados; um ignorado por privilégio de symlink.
- Python em container Linux: oito aprovados, incluindo symlink e FFmpeg real.
- Lint ESLint e Ruff aprovados; formato Prettier/Ruff verificado.
- Builds Next.js, NestJS e imagens Docker executados com sucesso.
- Auditoria npm: nenhuma vulnerabilidade na verificação realizada.
- Smoke real: PostgreSQL/Redis/worker, fontes, fila, transcrição, corte, SRT e
  publicação simulada aprovados. Sem API paga e sem vídeo publicado.
- Dashboard: página e health HTTP, leitura/cadastro de fontes e envio de tarefas
  pelo proxy validados. Requisição de origem externa rejeitada com 403.
  Navegador de automação não estava disponível; inspeção visual e cliques em
  navegador real permanecem pendentes, sem impedir os testes HTTP do fluxo.
- Falha permanente de mídia ausente registrada como FAILED, sem repetir a tarefa.

O workflow remoto só deve ser declarado aprovado após consultar seu resultado no
GitHub; validar localmente não equivale a observar uma execução remota.

## Seleção LLM

O conjunto Node passou a ter 15 testes: 13 da API e dois da apresentação do dashboard.
Os testes adicionais cobrem candidatos
válidos, notas/JSON/IDs/tempos inválidos, filtros de duplicação, segmentação por
limite, estouro de orçamento antes do envio, falha de API, métricas ausentes ou
inválidas e consumo informado acima da reserva. O protocolo Ollama é testado com
transporte simulado, sem modelo real nem API paga.

O teste `scripts/selection-integration.cjs`, executado no container API, valida
PostgreSQL real: reservas concorrentes, teto diário, liquidação de consumo,
reservas desconhecidas, cache e bloqueio por custo. Também exercita API/fila,
seleção mock e renderização idempotente com FFmpeg real a partir de uma transcrição
stub declarada. O CI executa esse fluxo no job Compose. Os testes não comprovam
qualidade editorial de um LLM real.

O job Compose usa `compose.test.yaml` para substituir somente a montagem `/media`
por um volume nomeado exclusivo dos testes. O volume herda o UID 10001 da imagem,
permitindo executar FFmpeg sem root no runner Linux. O Compose principal mantém
a pasta local do operador; nenhuma permissão dessa pasta é alterada pelo teste.

Os testes da interface renderizam os cartões React e verificam critérios, tempos,
conteúdo escapado e distinção entre custo zero informado e custo desconhecido.
A página/proxy foram validados por HTTP; inspeção visual e cliques em navegador
continuam pendentes pela indisponibilidade do navegador de automação.

## Validação operacional em 28/10/2026

Resultados desta retomada (os registros anteriores acima são históricos):

- `npm run lint`, `npm run format:check`, `npm test`, `npm run build` aprovados.
  São 24 testes da API e dois da apresentação React. `npm audit --audit-level=high`
  encontrou zero vulnerabilidades. Ruff check/format aprovados.
- Python: 10 testes aprovados; um teste de symlink foi pulado pelo Windows por
  ausência de privilégio para criá-lo. Não se alteraram políticas do sistema.
- Cinco serviços Compose saudáveis, migração aditiva aplicada no volume existente.
  Nenhuma dependência do projeto foi acrescentada. Imagens foram reconstruídas
  com os mesmos manifests/locks. Nenhum deploy de produção foi executado.
- Inatividade local: encerrados os testes às 22:46:49 UTC, `pg_stat_activity`
  já não mostrava conexões `autoclips-api` às 22:47:35 e continuava sem elas
  às 22:52:19 (mais de cinco minutos depois do último uso). Health checks
  continuaram ativos. Código revisado sem polling SQL no dashboard/worker/scheduler.
  Isso valida o comportamento local; não atesta o desligamento de uma conta Neon.
- `scripts/selection-integration.cjs` aprovado novamente: PostgreSQL e Redis reais,
  concorrência de reservas, cache, custo desconhecido e renderização idempotente.
- `scripts/automatic-smoke.mjs`: fala sintética autorizada, Whisper tiny/CPU/INT8
  real, três segmentos, WER 0 nesta fixture, seleção mock e MP4 H.264/AAC
  720×1280 com 9,94 s. Cinco blocos SRT conferidos com tolerância de 1,1 ms contra
  os timestamps persistidos. Título, descrição, créditos e arquivos presentes.
  Agendamento YouTube simulado executado e repetição reutilizou o mesmo registro.
- `scripts/discovery-smoke.mjs speech`: consulta à API oficial Commons retornou
  cinco vídeos aceitos pelos filtros, sem baixar os arquivos dessa busca.
- `scripts/collection-smoke.mjs`: fluxo real de descoberta/importação, download,
  conferência SHA-1, evidência persistida, transcrição, seleção mock e renderização.
  Fonte revisada: [gravação CC0 de Indy beetle](<https://commons.wikimedia.org/wiki/File:Roy_Cooper_speaks_at_Stop_the_Bans_veto_rally_(video).webm>),
  baixada diretamente do Commons, sem acessar extratores ou contornar plataformas.
  SHA-1 `64d030ee5af4eddd85f89db366a823d57be9baa8`;
  SHA-256 `321784b18691e61f7cf58b2656b3662eaacba7cc5388252fa317a924b4dacb03`.
  Produziu um corte de 12,576 s a partir de uma transcrição de um segmento,
  com cinco legendas menores. O áudio externo mostrou erros ASR e o mock não
  corrige esses erros: não se atesta qualidade editorial de um LLM real.
- Frames dos dois MP4 foram inspecionados. A primeira versão colocava toda uma
  fala longa na tela; foi corrigida para blocos de até 42 caracteres/3 s usando
  tempos reais de palavras, fonte menor e margens. Sem palavras, transcrições
  antigas preservam seus segmentos. Não se inventam tempos intermediários.
- HTTP do dashboard: 401 sem credenciais, 200 autenticado, proxy de MP4 completo,
  SRT, acesso à API com bearer e rejeição de POST com origem externa (403).
  O host de automação de navegador estava indisponível e a tentativa nativa de
  controlar o Opera foi recusada pela aprovação automática. **Não houve inspeção
  visual nem teste de cliques do dashboard**; houve inspeção visual dos MP4.
- OpenAI, YouTube upload e OAuth foram testados com transportes falsos. State
  expira e é consumido uma vez; tokens cifrados são recuperáveis apenas com a
  chave correta. A API de seleção paga é bloqueada sem autorização/preços/orçamento.
  Nenhuma chamada paga, autorização OAuth real ou publicação real foi executada.

Relatórios e frames locais ficam em `artifacts/automatic-smoke.json` e
`artifacts/collection-smoke.json`, fora do Git. Os vídeos finais permanecem em
`media/outputs` e são acessíveis nas tarefas do dashboard. O teste `--new-run`
cria outra fonte de QA usando o arquivo já verificado, preservando tarefas/saídas
anteriores, para validar correções sem romper a idempotência da coleta.

Para repetir, com o Compose iniciado e FFmpeg/FFprobe existentes no PATH:

```powershell
$nome = 'e2e-' + [guid]::NewGuid().ToString('N')
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/create-fixture.ps1 -Name $nome
$env:AUTOMATIC_FIXTURE_PATH = "fixtures/$nome.mp4"
# Se houver somente voz portuguesa, configure também AUTOMATIC_FIXTURE_LANGUAGE=pt.
node --env-file=.env scripts/automatic-smoke.mjs
node --env-file=.env scripts/discovery-smoke.mjs speech
# Somente após revisar a licença e os direitos da referência:
node --env-file=.env scripts/collection-smoke.mjs 'File:Roy Cooper speaks at Stop the Bans veto rally (video).webm' --reviewed --new-run
```

Inferência semântica paga, contas reais OAuth e Scale to Zero no serviço Neon
dependem de credenciais, configurações e autorização externas. Não se criou
recurso externo nem se publicou mídia. Veja [operação](operacao.md).

## Redesign do frontend — 28/10/2026

- Dashboard substituído por seis páginas no layout administrativo. O backend,
  Prisma, worker, filas, infraestrutura e dependências não foram alterados.
- Lint, formatação, build Next.js e `npm test` aprovados: 24 testes da API e seis
  testes do frontend. Os novos testes cobrem paginação, relações de etapas,
  cartões sem players, prévia fechada, JSON avançado sob demanda, escape de
  conteúdo, formulários e feedback acessível.
- Somente a imagem web foi reconstruída/reiniciada, mantendo os demais serviços
  e seus volumes. Autenticação Basic e bearer interno preservados.
- `scripts/dashboard-smoke.mjs` aprovado pelo frontend em execução: seis rotas
  retornaram 401 sem credenciais e 200 autenticadas; navegação e link de pular
  conteúdo presentes; HTML inicial sem players; rejeição CSRF 403 e bloqueio de
  rota interna não permitida. Health e diagnóstico manual passaram.
- O teste criou uma fonte com permissão de teste, transcreveu fala sintética com
  Whisper real, pediu seleção mock, renderizou com FFmpeg e baixou MP4/SRT/JSON
  pelo proxy. Renderizações e agendamentos duplicados retornaram os mesmos
  registros. O agendamento terminou em `SIMULATED`, com `published: false`.
- Descoberta Commons pelo proxy retornou resposta válida. Callback OAuth inválido
  e caminho de mídia externo foram rejeitados. Não houve OAuth de conta real,
  publicação real ou consumo de IA paga.
- O host de navegador estava indisponível e a aprovação automática recusou o
  controle nativo do Opera. **Não foram testados cliques, responsividade visual,
  captura de miniaturas ou reprodução interativa em navegador real nesta etapa.**
  O comportamento dessas interfaces foi revisado no código; HTTP e SSR não
  substituem essa validação visual.

O relatório local permanece em `artifacts/dashboard-smoke.json`, fora do Git.
Upload, edição/exclusão de fontes, atualização de configurações e paginação além
dos 100 registros dependem de endpoints que a API atual não oferece. A interface
nunca apresenta controles de gravação sem implementação real. Veja o
[guia das páginas](dashboard.md).
