# API local e direitos

Base no Compose: `http://localhost:3101`. Todas as rotas, exceto `/health`, exigem
`Authorization: Bearer <INTERNAL_API_TOKEN>`. O dashboard usa Basic Auth e injeta
esse token no servidor. Não há gestão multiusuário.

- `GET /health`: processo vivo; `GET /ready`: PostgreSQL, Redis e worker.
- `POST /internal/echo`: comunicação NestJS → FastAPI.
- `POST /internal/queue-test` e `GET /internal/queue-test/:id`: tarefa echo BullMQ.
- `POST /media/inspect`: `{url}`; identifica plataforma e metadados, sem autorizar extração.
- `POST /media/upload?extension=mp4&name=original.mp4&testContent=false`: binário;
  não exige fonte. `sourceId` continua opcional por compatibilidade. Upload não concede direitos.
- `POST /productions`: `{assetId, options?, reprocess?, confirmPermission?}`.
  A falta de original retorna `ORIGINAL_REQUIRED`; a falta de direitos retorna
  `AUTHORIZATION_REQUIRED`. Reenvie com `confirmPermission: true` somente após declaração
  do operador. Permissões válidas e licenças de catálogo são reutilizadas automaticamente.
- `GET /library`: produções reais agrupadas com etapas/cortes, status consolidado e
  `testContent`; sem limitar o agrupamento aos últimos 100 jobs.
- `POST /jobs/:id/remove`: exclusão lógica de produção/corte, cancelamento das etapas
  ativas e agendamentos, preservação de passos compartilhados; retorna `undoToken`.
- `POST /jobs/:id/restore`: `{undoToken}`; desfaz somente aquela exclusão.
  Artefatos excluídos retornam 404; arquivos permanecem no disco para recuperação.
- `POST /sources`: cadastro opcional de monitoramento com `name`, `url` e `monitoring?`.
  Direitos são opcionais e não presumidos. Para registrar direitos documentados pela API,
  forneça `license`, `evidenceUrl`, `attribution`, `commercialUseVerified: true`.
- `GET /sources`: últimas 100 fontes de monitoramento, sem permissões internas por mídia.
- `POST /jobs`: `sourceId`, `path` relativo à mídia, `operation` (`transcribe`
  ou `clip`); cortes exigem `start` e `end` em segundos, até 180 segundos.
- `GET /jobs` e `GET /jobs/:id`: status e resultado persistidos.
- `GET /llm/config`, `POST /jobs/:id/select`, `POST /jobs/:id/render-selection`
  e `GET /jobs/:id/llm-usage`: seleção e consumo; veja [contratos](selecao.md).
- `POST /jobs/:id/publish`: retorna `published: false`, sempre simulação.

A declaração de direitos é uma evidência informada pelo operador, não uma
verificação jurídica automática. Não aceite arquivos sem revisar origem, licença,
permissões comerciais e eventuais direitos de imagem, música e terceiros.

BullMQ usa concorrência global 1, três tentativas e backoff exponencial para
falhas transitórias, com status RETRYING até esgotar tentativas. Rejeições
permanentes do worker não são repetidas. Tarefas
QUEUED persistidas são reenfileiradas no início. Redis usa AOF e volume: a fila
nunca deve ser tratada como backup. Recuperação após perda total de Redis de
tarefas PROCESSING requer revisão manual para evitar processamento duplicado.

Saídas ficam no diretório de mídia e metadados no PostgreSQL. Novas rotas:

- `POST /discovery/search`: `{connector: "commons" | "manifest", query}`.
- `POST /discovery/import`: `{connector, reference, commercialUseVerified: true, autoRun: true}`;
  registra evidência, verifica catálogo novamente e enfileira download autorizado.
- `POST /jobs`: `autoRun: true` opcional para transcrição; etapas seguintes são automáticas.
- `POST /jobs/:id/continue`: retoma continuação pendente de etapa concluída.
- `GET /jobs/:id/artifacts/video|subtitles|transcript`: arquivo autenticado, com Range/206 para o player.
- `GET /platforms`: contas conectadas (sem tokens) e últimos agendamentos.
- `POST /oauth/start`: `{platform: "youtube" | "tiktok"}`; URL oficial de autorização.
- `POST /oauth/callback`: `{platform, state, code}`; state atômico, tokens cifrados.
- `POST /oauth/refresh`: `{platform}`; renovação sob demanda, sem retornar tokens.
- `POST /jobs/:id/schedule`: `{platform, scheduledAt: "ISO-8601 com timezone"}`;
  somente corte concluído. Repetir tarefa/plataforma retorna o mesmo agendamento.

`/ready` consulta o banco; não o utilize como health check periódico no Neon.
Consumo pago e publicação real continuam desabilitados por padrão.
Veja [configuração e operação](operacao.md).
