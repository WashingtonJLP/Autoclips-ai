# Docker e TrueNAS

Na raiz, `node scripts/setup-local.mjs` completa os segredos locais sem substituir
valores existentes. `docker compose config --quiet` valida a configuração.
`docker compose up -d --build --wait` constrói e inicia os cinco serviços.
`docker compose ps` inspeciona a saúde; `docker compose logs --tail 100` mostra logs.
`docker compose down` encerra sem remover volumes. Não use `down -v` em dados úteis.

Somente web (3000) e API (3003) são publicados, em loopback. Redis, banco e worker
ficam na rede interna. Não há autenticação multiusuário: não exponha à internet.
A senha de exemplo serve somente ao ambiente local isolado. Antes de implantar,
configure credenciais privadas e autenticação. `.env` não deve ser versionado.
O dashboard exige Basic Auth e os serviços internos usam tokens distintos.
Para Neon opcional e cuidados de inatividade, consulte [operação](../development/operacao.md).

No TrueNAS SCALE, adapte o Compose ao mecanismo de Apps da versão instalada,
com datasets próprios para PostgreSQL, Redis, modelos e `/media`. Configure UID
10001 com leitura/escrita no dataset de mídia. Faça snapshots e teste restauração.
Reserve cerca de 8 GB para serviços, limitando worker a 4 GB/2 CPUs. Use tiny,
INT8 e uma instância. Não há GPU/CUDA. O i5-2310 deve ser validado fisicamente:
o desempenho e a compatibilidade das instruções CTranslate2 não foram medidos nele.
Esta documentação não executa deploy em produção.
