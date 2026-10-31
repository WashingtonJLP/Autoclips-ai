# Conectores preservados

| Origem       | Metadados/identificação                                        | Obtenção implementada                                                                    |
| ------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| YouTube      | ID canônico; oEmbed/Data API                                   | yt-dlp e mídia HTTPS da própria plataforma, mediante permissão; [detalhes](youtube.md)   |
| Twitch Clips | `clips.twitch.tv/SLUG` ou `/canal/clip/SLUG`; Helix Get Clips  | Get Clips Download oficial, sujeito a token, escopo e papel                              |
| Twitch VOD   | `/videos/ID`; Helix Get Videos; busca por ID numérico do canal | Download não implementado; metadados/monitoramento e alternativas de arquivo preservados |
| Vimeo        | `/ID` ou `player.vimeo.com/video/ID`; oEmbed/API               | MP4 no campo `download` da API autorizada, até 512 MB/2 h                                |
| HTTPS direto | Extensão e identidade da URL                                   | Download nativo ou yt-dlp restrito a arquivo autorizado                                  |
| Upload       | SHA-256 do conteúdo                                            | Binário autenticado e FFprobe; MP4/WebM/MOV na interface                                 |
| Existente    | ID com arquivo importado                                       | Reutilização sem consultar a plataforma                                                  |

Twitch valida o token, client ID, usuário e escopo `editor:manage:clips` ou `channel:manage:clips`; a API também verifica o papel autorizado. Vimeo depende das capacidades da conta e do arquivo efetivamente disponibilizado. Credenciais dessas APIs não concedem direitos de reutilização. Downloads reais Twitch/Vimeo não foram comprovados nesta entrega; contratos simulados são identificados como tais.

URLs oficiais assinadas preservam a query original. Redirecionamentos de arquivos têm validação de endereço público a cada destino. Downloads genéricos verificam HTTPS, DNS/IP, TLS e limites.

Manifestos e RSS existentes continuam opcionais: `SOURCE_MANIFEST_URLS`, `SOURCE_FEED_URLS` e hosts em `MEDIA_DOWNLOAD_HOSTS`. Não são pré-requisitos para criar cortes. Busca multiorigem mantém cache/quota Redis e filtros de idioma, duração e recência. Nenhuma plataforma nova foi adicionada.

Monitoramentos históricos com configuração incompatível têm o agendamento removido do Redis ao iniciar/executar; registros e resultados ficam preservados. Novas configurações só aceitam conectores ativos.
