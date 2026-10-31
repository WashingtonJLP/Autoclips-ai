# Importação automática por URL

Implementação e validação local em 30/10/2026 (31/10 em UTC). Mantidos o pipeline,
as portas 3100/3101, banco, Redis, volumes e serviços existentes. Nenhuma publicação
ou chamada LLM externa foi feita nestes testes.

## Modalidades disponíveis

| Entrada                                                  | Obtenção implementada                                                             | Validação nesta entrega                                                                                             |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| HTTPS direto MP4/WebM/MOV/OGV                            | Download após licença ou declaração específica; reutiliza arquivo importado       | E2E real com motores nativo e yt-dlp                                                                                |
| YouTube watch/shorts/youtu.be                            | Metadados; original externo autorizado ou arquivo já importado associado ao vídeo | Metadados reais e bloqueio correto sem original; associação coberta por regressão                                   |
| Twitch VOD `/videos/ID`                                  | Metadados Helix com credenciais; original por upload                              | Sem credenciais neste ambiente; nenhum extrator de VOD                                                              |
| Twitch clip `clips.twitch.tv/SLUG` ou `/canal/clip/SLUG` | `Get Clips` + `Get Clips Download` oficiais, quando o token/papel permitir        | Contrato, escopos, recusas e identidade testados com transporte simulado; download real Twitch pendente             |
| Vimeo `/ID`                                              | `download` da API oficial, limitado a MP4 progressivo até 512 MB/2 h              | Metadados públicos reais; contrato de arquivo oficial testado com transporte simulado; download real Vimeo pendente |
| Upload / vídeo já importado                              | Fluxo existente, sem fonte ou caminho interno                                     | E2E real com mídia própria, incluindo deduplicação e Biblioteca                                                     |

Uma licença ou declaração de copyright não substitui o acesso permitido pela plataforma.
O yt-dlp tem extratores tecnicamente compatíveis com essas plataformas, mas isso
não comprova autorização. A integração **não habilita extração de páginas/players**.
YouTube Data API não oferece download do arquivo; continua válida a alternativa
de [original externo ou exportação oficial pelo titular](youtube-obtencao-autorizada.md).

## Configuração opcional

O motor padrão continua `MEDIA_DOWNLOAD_ENGINE=native`. Para usar o adicional,
defina `MEDIA_DOWNLOAD_ENGINE=yt-dlp` no ambiente local e recrie somente a API:
`docker compose up -d --no-deps --wait api`. O worker já contém a dependência fixada
no `uv.lock`. Isso troca o motor de arquivos autorizados, sem liberar outras URLs.

Twitch reutiliza `TWITCH_CLIENT_ID` e `TWITCH_ACCESS_TOKEN`. Para clips, valida o token,
o client e o user ID; exige `editor:manage:clips` ou `channel:manage:clips` e solicita
o arquivo para o broadcaster e clip exatos. A API oficial decide a permissão de
broadcaster/editor. Sem escopo, papel ou arquivo, mantém metadados e oferece upload.
As duas formas de URL do mesmo clip compartilham identidade e arquivo.

Vimeo usa `VIMEO_ACCESS_TOKEN`, opcional. O token precisa permitir os campos de
arquivo (escopos `public`, `private`, `video_files` conforme a documentação oficial).
Conta/plano e permissões podem limitar esse acesso; nenhum plano foi contratado.
Somente entradas `download` progressivas são utilizadas, preservando a URL assinada.
Sem arquivo autorizado, utiliza oEmbed e informa a alternativa de original.

Não há novo serviço OAuth, cookies de navegador, senhas de plataformas, proxies,
impersonação, geo bypass, DRM, manifestos HLS/DASH ou login automatizado.
URLs oficiais podem expirar: analise novamente antes de iniciar outra importação;
se uma produção já falhou, use a opção existente de nova versão após renovar o acesso.

## Proteções e reutilização

O backend gera o payload do download; a interface não aceita argumentos livres do
yt-dlp. O worker usa somente seu downloader HTTP para uma URL de arquivo previamente
autorizada, sem inicializar extratores ou executar o CLI. Um subprocesso sem shell
tem prazo máximo de 600 s; socket de 30 s, leitura limitada a 512 MB, armazenamento
temporário com limpeza em falhas, FFprobe até 2 h e promoção atômica do arquivo.

Ambos os motores exigem HTTPS sem credenciais e porta padrão, verificam todos os IPs
resolvidos e conectam ao IP público fixado com TLS/SNI. Redes privadas, loopback e
metadata endpoints são rejeitados. Proxy ambiente é ignorado. Somente links de
arquivo entregues pelas integrações oficiais habilitam até três redirecionamentos;
cada destino passa novamente pelas mesmas verificações e não recebe tokens da API.
URLs diretas e originais YouTube continuam recusando redirecionamentos.

Uma reanálise atualiza links oficiais e disponibilidade sem sobrescrever arquivos
importados ou originais explicitamente vinculados. Permissões permanecem específicas
ao vídeo. Arquivos locais e produções equivalentes continuam sendo reutilizados.

## Evidência dos testes

- API: 69 testes; web: 9 testes; Python: 19 aprovados, 1 ignorado por permissão de
  symlink no Windows. Lint, Ruff e builds aprovados.
- `scripts/url-import-smoke.mjs`: HTTPS real de um excerto CC BY 4.0 do Commons,
  creditado ao NYC Mayor's Office; hash SHA-1 idêntico à evidência do catálogo.
  Produção `cmvvo5fe8000337p237d8hzno`, corte `cmvvo5kq1000637p29448gri8`.
  Download comprovadamente `yt-dlp`, Whisper real CPU/INT8, seleção **mock**,
  FFmpeg real, MP4 de 26,139 s, SRT com oito intervalos válidos dentro do vídeo,
  decodificação integral e resposta Range 206. Nenhum clique em Retomar.
- `scripts/creation-library-smoke.mjs`: motor nativo, upload próprio novo, seleção
  por ID, oito solicitações concorrentes equivalentes sem tarefas/arquivos extras,
  versão intencional, download, exclusão individual/produção e restauração.
  YouTube real exibiu título/miniatura e `ORIGINAL_REQUIRED`; Vimeo exibiu metadados.
- Relatórios e mídia em `artifacts/` e `media/` permanecem locais e ignorados pelo Git.
  Não houve inspeção visual ou avaliação auditiva nesta entrega. As legendas foram
  verificadas por timestamps e testes de alinhamento com palavras do Whisper.
- LLM real configurado localmente: Gemini. Nos E2E foi utilizado override temporário
  `mock` com rede e cobrança desabilitadas, restaurando a configuração original depois.
  O teste comprova a automação; não comprova seleção semântica por Gemini.

Para repetir o teste yt-dlp, use um override Compose local na API com `LLM_PROVIDER=mock`,
`LLM_MODEL=mock-v1`, `LLM_ALLOW_EXTERNAL=false`, `LLM_ALLOW_PAID=false` e
`MEDIA_DOWNLOAD_ENGINE=yt-dlp`; execute `node scripts/url-import-smoke.mjs` e depois
`docker compose up -d --no-deps --wait api` para restaurar o ambiente original.
O script não altera configuração e recusa execução se o provedor não for mock.

## Pela interface

1. Abra **Criar cortes**, cole a URL e clique **Analisar vídeo**.
2. Havendo arquivo permitido, confirme direitos somente se solicitado e clique
   **Gerar cortes**. Não é necessário cadastrar fonte nem informar caminhos.
3. Acompanhe as etapas e abra **Biblioteca** para assistir/baixar MP4 e SRT.
   Sem acesso ao arquivo, use o original autorizado indicado na mensagem.

Referências primárias:
[yt-dlp](https://github.com/yt-dlp/yt-dlp),
[Twitch Get Clips Download](https://dev.twitch.tv/docs/api/reference/#get-clips-download),
[Vimeo: arquivos pela API](https://help.vimeo.com/hc/en-us/articles/12427806914577-About-video-file-download-links-from-the-API),
[YouTube Data API](https://developers.google.com/youtube/data/reference/rest/v3/videos),
[políticas YouTube](https://developers.google.com/youtube/terms/developer-policies).
