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

## Resultados da implementação

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
