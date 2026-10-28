# Docker e TrueNAS

Na raiz, `node scripts/setup-local.mjs` completa os segredos locais sem substituir
valores existentes. `docker compose config --quiet` valida a configuração.
`docker compose up -d --build --wait` constrói e inicia os cinco serviços.
`docker compose ps` inspeciona a saúde; `docker compose logs --tail 100` mostra logs.
`docker compose down` encerra sem remover volumes. Não use `down -v` em dados úteis.

Somente web (3100) e API (3101) são publicados, em loopback. Redis, banco e worker
ficam na rede interna. Não há autenticação multiusuário: não exponha à internet.
A senha de exemplo serve somente ao ambiente local isolado. Antes de implantar,
configure credenciais privadas e autenticação. `.env` não deve ser versionado.
O dashboard exige Basic Auth e os serviços internos usam tokens distintos.
Para Neon opcional e cuidados de inatividade, consulte [operação](../development/operacao.md).

| Serviço    | Host             | Rede Docker     |
| ---------- | ---------------- | --------------- |
| Frontend   | `127.0.0.1:3100` | `web:3000`      |
| API        | `127.0.0.1:3101` | `api:3001`      |
| Python     | sem publicação   | `worker:8000`   |
| PostgreSQL | sem publicação   | `postgres:5432` |
| Redis      | sem publicação   | `redis:6379`    |

As portas internas e os health checks dentro dos containers permanecem iguais.
Para aplicar somente a alteração de portas/URLs, use
`docker compose up -d --no-deps --build --wait api web`. Não recrie banco, Redis ou
worker e não remova volumes. O MatchPredict não faz parte desse Compose.

Basic Auth mantém as credenciais existentes do `.env`. O navegador consulta o proxy
na mesma origem `http://localhost:3100`; não é necessário liberar CORS entre
3100 e 3101. POST de outra origem, inclusive da porta antiga, continua rejeitado.
O callback YouTube local é `http://localhost:3100/oauth/youtube`: atualize também
o cadastro no console do provedor antes de usar OAuth real. TikTok Web continua
exigindo callback HTTPS registrado; não o substitua por HTTP para contornar essa regra.

Validação sem criação/remoção de dados:
`node --env-file=.env scripts/ports-smoke.mjs`. Para comparar também serviços que
não devem mudar, capture antes IDs, StartedAt, imagens, PortBindings e Mounts em
`artifacts/ports-before.json`, conforme o relatório da execução atual. O CI valida
as portas sem depender de um MatchPredict presente no runner.

No TrueNAS SCALE, adapte o Compose ao mecanismo de Apps da versão instalada,
com datasets próprios para PostgreSQL, Redis, modelos e `/media`. Configure UID
10001 com leitura/escrita no dataset de mídia. Faça snapshots e teste restauração.
Reserve cerca de 8 GB para serviços, limitando worker a 4 GB/2 CPUs. Use tiny,
INT8 e uma instância. Não há GPU/CUDA. O i5-2310 deve ser validado fisicamente:
o desempenho e a compatibilidade das instruções CTranslate2 não foram medidos nele.
Esta documentação não executa deploy em produção.
