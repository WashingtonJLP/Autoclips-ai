# YouTube: importação direta

## Disponibilidade, acesso e direitos

Reconhecer uma URL pública, consultar metadados e identificar formatos não exige Creative Commons. Esses resultados comprovam disponibilidade técnica, sem comprovar permissão de download ou direitos de reutilização.

Antes de obter a mídia, a produção pede confirmação de que o download é permitido pela plataforma naquele cenário e de que o operador possui direitos para processar o conteúdo. A declaração fica vinculada ao vídeo; não é verificação automática de identidade ou licença. Um vídeo público não concede essas permissões por si só.

O campo `accessible` na análise indica um método a tentar. Somente bytes gravados e validados por FFprobe concluem a importação. Miniaturas não contam como vídeo importado.

## URLs aceitas

HTTPS `youtube.com/watch?v=ID`, `youtu.be/ID`, `/shorts/ID`, `/embed/ID`, `/live/ID` e `/v/ID`; variantes `www`, `m.youtube.com`, `music.youtube.com` e embed `youtube-nocookie.com`. O ID tem 11 caracteres. Tempo, compartilhamento e rastreamento não mudam a identidade. Canal/playlist isolado, credenciais na URL, portas alternativas e hosts parecidos são recusados.

`/live/ID` identifica também uma gravação; transmissão ativa/futura não é baixada. Shorts tem a mesma política de acesso do vídeo correspondente.

## Como funciona

O conector NestJS consulta oEmbed ou Data API opcional e oferece `youtube-direct`. Falha dos metadados opcionais não impede a tentativa autorizada pelo extrator. A produção agenda `download` com `engine=youtube` no BullMQ.

No Python, um subprocesso executa o extrator YouTube real do `yt-dlp`. Ele escolhe vídeo de até 720p e áudio em HTTPS, progressivo ou separado. A mídia vem diretamente de `*.googlevideo.com`, com validação de rede/TLS, limite agregado de 512 MB e prazo total de 600 segundos. FFmpeg reúne faixas localmente, sem rede. FFprobe valida duração de até duas horas antes da gravação atômica. O pipeline segue para Whisper, seleção e renderização.

Não são usados cookies, contas do navegador, senhas, tokens PO, impersonação, bypass geográfico, DRM ou solvers JavaScript. Manifestos HLS/DASH, transmissões em andamento e acesso autenticado/restrito não recebem um método alternativo de contorno. Formatos adaptativos HTTPS separados são suportados. Mudanças do YouTube podem reduzir a cobertura.

Erros distinguem URL inválida (400), restrição de acesso (403), indisponibilidade (404), formatos incompatíveis (422), quota (429), falha temporária (503) e timeout (504). URLs assinadas e stderr interno não são expostos. Falha técnica não significa falta de direitos autorais.

Identidade canônica, chave do arquivo e chave da produção evitam repetição. Mídia importada é reutilizada antes da rede. Reprocessar opções editoriais não exige outro download.

## Caminhos oficiais e limites

A [Data API](https://developers.google.com/youtube/v3/docs/videos) não fornece campo de download de mídia. O [YouTube Studio e o Google Takeout](https://support.google.com/youtube/answer/56100?hl=pt-BR) oferecem exportação de vídeos próprios ao titular; a aplicação não automatiza essas interfaces autenticadas. Upload e vínculo de arquivo autorizado continuam como alternativas quando o caminho direto não estiver permitido/disponível.

O [yt-dlp](https://github.com/yt-dlp/yt-dlp) oferece extração técnica, sem conceder direitos. O [guia EJS](https://github.com/yt-dlp/yt-dlp/wiki/EJS) explica requisitos para cobertura completa; esta aplicação deixa solvers desativados. Consulte os [termos da plataforma](https://www.youtube.com/static?template=terms).

Sonda real de metadados/formatos, sem download:

```powershell
$env:PYTHONPATH='apps/worker-python'
.\apps\worker-python\.venv\Scripts\python.exe scripts/youtube-probe.py https://youtu.be/jNQXAC9IVRw
```

Ela não registra URLs assinadas. Veja [resultados reais](validation.md). Nenhum arquivo externo representa sucesso de download do YouTube.
