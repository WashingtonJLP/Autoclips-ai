# Validação real: URL YouTube até Biblioteca

Teste final executado em **31/10/2026, das 13:42:36 às 13:43:48 UTC**, com Playwright local autorizado e Chrome em contexto isolado. As credenciais locais foram usadas em memória, sem serem impressas ou incluídas nas evidências. Nenhuma configuração de segurança do navegador foi alterada.

## Resultado comprovado

**Colar URL → Gerar cortes → confirmar permissões → download direto → Whisper → seleção → FFmpeg → Biblioteca → reprodução → downloads MP4 e SRT.**

- Origem: `https://www.youtube.com/watch?v=M7lc1UVf-VE`.
- Vídeo: **YouTube Developers Live: Embedded Web Player Customization**, canal Google for Developers, com licença de atribuição informada pelo extrator.
- Produção iniciada pela interface: `cmvwgatl7000237msfmfbkho1`.
- Corte final: `cmvwgc5f5000537ms5kqaa6g7`.
- Todas as quatro etapas terminaram como `COMPLETED`, sem erro.
- **Zero chamadas a Retomar**, zero uploads e zero vínculos de arquivo substituto durante a produção.

Antes do teste, o arquivo canônico não existia. Os arquivos gerados pelas tentativas anteriores foram preservados com nomes de backup; somente o cache e a associação da mídia criada pelo próprio teste foram preparados para exigir novo download e nova transcrição. Nenhum arquivo ou registro anterior à tarefa foi apagado. Depois de clicar em gerar e confirmar direitos, não houve intervenção na produção.

## Download direto corrigido

A tarefa inicial contém `operation=download`, `engine=youtube` e a URL original do YouTube. O worker usa o extrator e o downloader nativo **HttpFD** do yt-dlp. A transferência preserva os cabeçalhos e `downloader_options.http_chunk_size`, mantendo validação de DNS/IP público, conexão fixada no IP validado, TLS, escopo de URL/GET e limites agregados. Cookies, autenticação YouTube, DRM e solvers JS não foram utilizados.

O teste isolado do caminho integrado corrigido concluiu em **10,24 segundos**. O arquivo de origem tem **57.498.090 bytes**, H.264 1280×720 e áudio AAC. SHA-256: `abdd47934bc7d4a5763b28b8ea1fcb2923dcb4c9dbaba14f034883b361eb18d9`.

Na execução visual final, o resultado do download registrou `download_engine=yt-dlp` e o mesmo SHA-256. O caminho anterior fazia a transferência contínua por urllib sem conservar os blocos do extrator: aproximadamente 52 KB/s e HTTP 504 após 600,45 segundos. A comparação controlada com o downloader nativo atingiu aproximadamente 8,8 MB/s para a mesma URL assinada. A correção não aumentou o timeout nem relaxou controles de acesso.

## Processamento real e reprodução

| Etapa        | Tarefa                      | Evidência                                                                                     |
| ------------ | --------------------------- | --------------------------------------------------------------------------------------------- |
| Download     | `cmvwgatl7000237msfmfbkho1` | URL YouTube e engine corretos, arquivo completo e hash                                        |
| Transcrição  | `cmvwgb3fj000337msqz27qzm4` | faster-whisper real, 195 segmentos, sem reutilizar transcrição anterior                       |
| Seleção      | `cmvwgc5bd000437msf116iw2i` | Heurística local identificada; `simulated=false`, `semanticAnalysis=false`, consumo LLM vazio |
| Renderização | `cmvwgc5f5000537ms5kqaa6g7` | FFmpeg real, MP4 e SRT validados                                                              |

O teste final usou a configuração original: provedor Gemini disponível, `maxInputTokens=12000`, `maxChunks=1`. A transcrição excedia esse limite. O fallback heurístico permitido pela interface foi acionado automaticamente, sem chamada externa, aumento de quota ou cobrança. Isso não é apresentado como análise semântica Gemini.

O Playwright abriu **Ver resultado**, confirmou a Biblioteca e a prévia, iniciou a reprodução e observou **65 quadros decodificados**, `currentTime>2`, `paused=false`, `readyState=4`, 720×1280 e nenhum erro de mídia. A captura de tela foi inspecionada visualmente: vídeo do apresentador, indicação do modo heurístico e botões de download presentes.

Os links **Baixar MP4** e **Baixar SRT** foram clicados no navegador e os downloads concluíram. FFprobe confirmou H.264 **720×1280**, áudio AAC e **6,233 segundos**. O MP4 tem **871.116 bytes**; o SRT tem **288 bytes**, cinco entradas e timestamps válidos. A preferência da interface era um corte de até 30 segundos; a heurística escolheu um trecho de 6,22 segundos da fala.

## Falha encontrada e resolvida pelo teste visual

A primeira execução concluiu download e Whisper, mas a seleção falhou por máximo de blocos. O serviço calculava os blocos LLM antes de verificar indisponibilidade e não aplicava o fallback permitido à falta de capacidade configurada. A ordem foi corrigida e o excesso de blocos passou a acionar somente o fallback explicitamente permitido. Sem esse fallback, a operação continua bloqueada com explicação. Limites de orçamento e ausência de chamadas externas foram cobertos por regressão.

Uma repetição com acesso externo temporariamente desativado passou; o teste final acima também passou depois de restaurar integralmente a configuração original. Os registros e os arquivos das tentativas anteriores foram preservados.

## Verificações finais

| Verificação    | Resultado                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| API            | 73 testes aprovados                                                                                              |
| Dashboard      | 9 testes aprovados                                                                                               |
| Python Linux   | 50 testes aprovados, incluindo downloader HttpFD real com respostas controladas, limites, rede, FFmpeg e symlink |
| Python Windows | 49 aprovados, 1 ignorado por permissão de symlink                                                                |
| Playwright     | Fluxo final completo aprovado, reprodução e dois downloads verificados, sem erros JavaScript                     |
| Qualidade      | ESLint, Ruff, Prettier, Prisma/API/Next.js e builds Docker aprovados                                             |

São **132 testes unitários aprovados em API/dashboard/Python Linux**, além do teste visual completo. O teste não se limita a respostas HTTP 200.

## Evidências locais e preservação

`artifacts/` é ignorado pelo Git. Evidências desta máquina:

- `youtube-playwright-evidence.json`: ações, estados da tela, tarefas, reprodução e downloads.
- `youtube-playwright-run.log`: avanço automático observado pelo navegador.
- `youtube-ui-01-criar.png` até `youtube-ui-06-biblioteca-reproduzindo.png`: capturas visuais.
- `youtube-ui-cmvwgc5f5000537ms5kqaa6g7.mp4` e `.srt`: arquivos baixados pela interface.
- `youtube-native-download-fixed.json`: tempo e hash do download integrado.
- `youtube-native-node-tests-final.log` e `youtube-native-linux-tests-final.log`: testes.

Banco, volumes, arquivos históricos, autenticação, portas 3100/3101 e MatchPredict foram preservados. Não houve migração Prisma nem publicação real. A validação se refere a este caso autorizado e aos formatos disponíveis; não implica suporte universal a qualquer vídeo do YouTube. Twitch/Vimeo e inferência externa de IA não foram validados de novo nesta correção.
