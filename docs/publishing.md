# Publicações

**A fila publica somente em simulação.** Agendamentos executam `publish-simulation`, terminam como `SIMULATED` e registram `published=false`. Não foi feita publicação real nesta entrega.

OAuth preserva estado temporário de uso único no Redis, PKCE e tokens cifrados/autenticados com `PLATFORM_TOKEN_KEY`. Callback e renovação são sob demanda, sem timer de consulta ao PostgreSQL.

## YouTube

`YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI` configuram o app/callback (exemplo local `http://localhost:3100/oauth/youtube`). Permissão OAuth de upload não concede download. `YOUTUBE_API_KEY` serve a busca/metadados, separadamente.

O adaptador isolado de upload resumível oficial tem testes com transporte simulado. Exige autorização e `PUBLISH_ALLOW_REAL=true`, mas não há rota de produção que o ative: o agendador chama somente simulação. Não habilite essa variável nos testes.

## TikTok

`TIKTOK_CLIENT_ID`, `TIKTOK_CLIENT_SECRET` e `TIKTOK_REDIRECT_URI` configuram a conexão. Callback web exige HTTPS estático registrado no app. Publicar de verdade exigiria aplicativo aprovado, `video.publish`, consulta de capacidades do criador e consentimento apropriado. Esse fluxo de postagem não está concluído; conectar conta não muda o modo de simulação.

O dashboard permite revisar conexões, renovar sob demanda e agendar simulações. Resultado simulado não contém ID de um vídeo realmente publicado.
