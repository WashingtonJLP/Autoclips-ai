# YouTube: obtenção autorizada do original — 31/10/2026

## Investigação oficial

| Método                                                      | Situação real                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| YouTube Data API / OAuth do proprietário                    | Não há método de download do vídeo na API. `videos.list` retorna recursos/metadados; `fileDetails` contém propriedades do arquivo, não seu conteúdo ou uma URL de download                                                                                                                                          |
| Vídeo público ou Creative Commons no YouTube                | A visibilidade/licença não cria um endpoint de download na Data API. Não usamos player, assinaturas de streaming, cookies ou extratores                                                                                                                                                                             |
| YouTube Studio                                              | O titular pode baixar seus próprios uploads pela interface oficial, sujeito às restrições documentadas pelo YouTube                                                                                                                                                                                                 |
| Google Takeout                                              | Exportação oficial dos uploads do próprio usuário. O aplicativo não automatiza login, ZIPs ou exportações; o titular pode fornecer depois o arquivo individual por HTTPS ou upload                                                                                                                                  |
| Google Data Portability API                                 | Via oficial distinta da Data API: exporta mídia dos vídeos próprios públicos, não listados e privados. Requer app aprovado, OAuth específico, consentimento e conta/região elegível. Não está integrada nem validada neste MVP; não há credenciais configuradas. O Brasil não consta na lista de regiões consultada |
| Original externo fornecido pelo titular ou cópia licenciada | Implementado: arquivo HTTPS direto vinculado ao vídeo, com declaração específica e evidência registrada; usa o downloader e o pipeline existentes                                                                                                                                                                   |
| Arquivo individual já importado                             | Implementado: associação explícita por ID, sem baixar ou enviar os bytes novamente, com permissão própria daquele vídeo                                                                                                                                                                                             |

O modo off-line do YouTube Premium é reprodução no aplicativo; não é utilizado como
fonte de arquivo original pelo AutoClips.

Fontes oficiais verificadas:

- [Métodos e propriedades de videos](https://developers.google.com/youtube/data/reference/rest/v3/videos).
- [Políticas III.E.1 e serviços não documentados](https://developers.google.com/youtube/terms/developer-policies).
- [Download dos próprios vídeos no Studio e Takeout](https://support.google.com/youtube/answer/56100?hl=pt-BR).
- [Exportar dados Google](https://support.google.com/accounts/answer/3024190?hl=pt-BR).
- [Data Portability: mídia exportável do YouTube](https://developers.google.com/data-portability/schema-reference/youtube),
  [aprovação e fluxo OAuth](https://developers.google.com/data-portability/user-guide/introduction),
  [regiões e elegibilidade da conta](https://support.google.com/accounts/answer/14452558).

Ser proprietário ou licenciado não permite que este conector ignore os métodos e
restrições da plataforma. Uma permissão de copyright é diferente de acesso técnico
autorizado ao original. A Data Portability não é apresentada como funcionalidade pronta.

## Como usar

1. Em **Criar cortes**, cole o link YouTube e clique **Analisar vídeo**.
2. Se faltar original, abra **Usar um original autorizado sem novo upload**.
3. Informe o link HTTPS direto disponibilizado pelo titular **ou** selecione um arquivo
   já importado. Confirme os direitos e a correspondência do original/versão licenciada
   com o vídeo analisado; clique **Vincular original autorizado**.
4. Clique **Gerar cortes**. A importação, transcrição, seleção e renderização continuam
   automaticamente. Abra a Biblioteca para MP4/SRT. Nas próximas análises do mesmo link,
   inclusive sua forma curta, o original vinculado/importado será reutilizado.

Sem uma dessas fontes de mídia, o link YouTube permanece somente com metadados e
continua oferecendo envio do arquivo original. Nenhuma fonte precisa ser cadastrada.
Para usar uma cópia obtida por Studio/Takeout, forneça o arquivo individual, não o link
de uma página de login ou de um ZIP de exportação.

## Contrato e proteção dos dados

`POST /media/:id/original`, autenticado e permitido no proxy, aceita exatamente uma opção:

```json
{
  "mediaUrl": "https://site-do-titular.example/original.mp4",
  "confirmPermission": true,
  "evidenceUrl": "https://site-do-titular.example/licenca",
  "attribution": "Titular, licença, créditos e identificação da versão fornecida"
}
```

Ou `{ "importedAssetId": "ID_DO_ARQUIVO_IMPORTADO", "confirmPermission": true }`.
Evidência e atribuição são opcionais no contrato; sem evidência externa é registrada a
declaração do operador, não uma verificação jurídica ou automática de identidade.
O vínculo é específico ao asset YouTube. Não herda permissões de outros vídeos/canais.
Ao usar arquivo importado, seus direitos não são copiados: a nova declaração é vinculada
ao vídeo analisado. O titular/operador deve indicar corretamente se é original ou excerto.

Não há alteração de esquema ou novos serviços. São reutilizados `MediaAsset`, o registro
interno de permissão e seu `mediaUrl`, a fila e os workers. A operação é transacional e
idempotente. Um original vinculado não pode ser substituído silenciosamente, preservando
as produções existentes; para processar outro arquivo, use sua URL direta como nova entrada.

URLs exigem HTTPS, portas padrão e extensão MP4/WebM/MOV/OGV. Páginas do YouTube e
hosts de streaming `googlevideo.com` são recusados nesse campo. O worker mantém DNS
público com IP fixado, TLS, bloqueio de redes privadas/redirecionamentos, limite de
512 MB e validação FFprobe até duas horas. Não há cookies, tokens de terceiros,
interpretação de players ou contorno de DRM/autenticação. URLs temporárias devem estar
válidas durante a importação. Originais já armazenados não dependem de nova consulta
YouTube para processamento. A declaração não publica nenhum vídeo.

## Validação executada

- **66 testes API, 9 testes React**, lint, builds API/Next.js e Docker aprovados.
- `scripts/youtube-original-smoke.mjs`: link YouTube real
  `https://www.youtube.com/watch?v=zZ0gQMnpxxo`, com versão/excerto de **49 s** da fala de
  Julie Menin. A transmissão completa tem outros conteúdos; não foi afirmado que o
  excerto seja a íntegra do vídeo YouTube.
- O arquivo externo de aproximadamente 16,39 MB está disponibilizado sob **CC BY 4.0**
  nesta [página de evidência](https://commons.wikimedia.org/wiki/File:Julie_Menin_speech_at_2026_Knicks_Championship_Ceremony.webm).
  A autoria e os créditos foram registrados; o SHA-1 baixado coincidiu com o catálogo.
- Download HTTPS real do Commons → faster-whisper real → seleção **mock identificada**
  → FFmpeg real → MP4 H.264/AAC 720×1280 de **28,338 s** e SRT. Decodificação integral
  sem erro; etapas concluídas automaticamente, sem chamadas a Retomar.
- Produção `cmvvn4emv000337ms9ks3jz80`, corte `cmvvn4ibz000637msc99viyar`.
  A URL `youtu.be` retornou o mesmo asset e estado `imported`, sem novo download.
- `scripts/youtube-original-integration.cjs`: associação a arquivo sintético local já
  importado, com referência YouTube de teste explicitamente fictícia e sem consulta/publicação
  no YouTube. Verifica permissão separada, caminho reutilizado, ausência de download e
  conclusão até MP4; não é apresentado como download de um vídeo próprio pelo Google.
- Testes negativos: ausência de declaração, origens de streaming YouTube, páginas,
  HTTP, credenciais na URL, portas alternativas, ID sem arquivo e substituição indevida.
- Atualizações de metadados/descoberta preservam o original autorizado de forma
  transacional, para que uma busca posterior não transforme o vínculo em apenas metadados.
- Relatórios e mídias em `artifacts/`, ignorados pelo Git. Mock foi temporário para
  evitar consumo externo; configuração Gemini do `.env` restaurada ao terminar.
  Não houve publicação, alteração de MatchPredict, portas, volumes ou infraestrutura.

O primeiro download real está registrado em `artifacts/youtube-original-first-run.json`;
a repetição em `youtube-original-reuse.log` retorna os mesmos IDs e marca importação
reutilizada. Um frame com legendas inseridas foi inspecionado, e MP4/SRT foram baixados.
Whisper tiny pode errar nomes próprios; transcrição e seleção mock exigem revisão editorial.

Não houve teste de OAuth Data Portability, Studio/Takeout em conta real ou extração
de mídia do YouTube. A inspeção visual da interface continua pendente; as evidências
são testes API/proxy, renderização React e validação dos arquivos gerados.
