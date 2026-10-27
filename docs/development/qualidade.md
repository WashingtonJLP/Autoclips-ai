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
