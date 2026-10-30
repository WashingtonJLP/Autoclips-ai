# Criação multiorigem

A aplicação mantém Next.js, NestJS, FastAPI, PostgreSQL e a fila BullMQ existente.
Dashboard: `http://localhost:3100`; API: `http://localhost:3101`. Redis, banco e worker
continuam acessíveis somente na rede Docker. Publicação permanece simulada.

## Suporte implementado

| Origem                                       | Descoberta/metadados                                                                                    | Obtenção do original                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| YouTube                                      | oEmbed por link; busca e duração com `YOUTUBE_API_KEY`                                                  | Upload do original autorizado. Não há extrator nem download pela Data API                        |
| Twitch                                       | VODs e monitoramento por ID numérico de canal via Helix, com `TWITCH_CLIENT_ID` e `TWITCH_ACCESS_TOKEN` | Upload do original autorizado; nenhum extrator de VOD                                            |
| Vimeo                                        | Metadados oEmbed por link, incluindo duração                                                            | Upload do original autorizado; busca global e download autenticado ainda não implementados       |
| Wikimedia Commons                            | API oficial; licença, autoria, evidência, hash e duração quando disponíveis                             | Arquivo original público CC0/CC BY 4.0, após confirmação dos direitos                            |
| Catálogo autorizado                          | Manifestos já configurados em `SOURCE_MANIFEST_URLS`                                                    | Links diretos do manifesto, com evidência e hosts aprovados                                      |
| RSS / podcasts                               | Feeds RSS 2.0 configurados em `SOURCE_FEED_URLS`, com enclosures                                        | HTTPS público em host aprovado, após autorização individual; áudio recebe fundo vertical gerado  |
| Arquivo direto / armazenamento compartilhado | Identificação do link; duração validada ao importar                                                     | HTTPS público, após permissão específica ou licença registrada; sem cadastro obrigatório de host |
| Upload local                                 | SHA-256, duração e validação FFprobe                                                                    | Envio binário até 512 MB, sem caminhos internos                                                  |

Os conectores distinguem identidade, metadados, direitos confirmados e disponibilidade
do arquivo. O simples fato de encontrar uma URL nunca aprova sua reutilização.
Permissão expressa pode ser registrada para qualquer plataforma; isso não libera
extração por métodos não autorizados. CC BY não garante monetização nem elimina
direitos de terceiros. Os créditos acompanham a descrição dos cortes.

## Pelo dashboard

1. Abra **Criar cortes** e escolha **Colar link**, **Escolher vídeo** ou **Enviar arquivo**.
2. Permissões existentes e licenças de catálogo são reutilizadas automaticamente.
   Se faltar autorização, confirme que possui direitos para aquela mídia. Não há seleção
   de fonte, formulário técnico de licença nem cadastro obrigatório para upload.
3. Defina quantidade, idioma e duração máxima. O processamento é automático;
   clique em **Gerar cortes**. A tela atualiza a cadeia enquanto houver trabalho ativo.
4. Abra **Biblioteca → Produções / Cortes** para assistir, baixar MP4/SRT e excluir.
   Mídias sintéticas ficam em **Testes sintéticos**. Exclusões são reversíveis e preservam
   originais e etapas compartilhadas; não removem imediatamente arquivos do disco.
   Seleções mock recebem identificação visível. **Gerar novos cortes** retorna ao formulário.
5. Produções idênticas são reutilizadas. Para repetir intencionalmente, marque
   **Mais opções → Gerar uma nova versão**. A interface não solicita caminhos internos.
   O formulário seleciona heurística identificada quando a IA estiver indisponível;
   essa política pode ser alterada antes de iniciar, sem mudar a configuração do servidor.

Em **Fontes → Busca automática**, escolha plataformas, temas, categorias de consulta,
idiomas, duração, recência, quantidade de vídeos/cortes e frequência. A busca pode
ser executada para revisão ou salva para execução no servidor. O cadastro de fonte
também permite criar seu monitoramento. YouTube usa ID `UC…`; Twitch usa ID numérico;
RSS aceita URL exata aprovada pelo operador. A configuração fica vinculada ao cadastro
e pode ser pausada/retomada em Busca automática, com histórico das últimas dez execuções.

Filtros de idioma, duração e recência não consideram metadados desconhecidos como
correspondência. Categorias são acrescentadas à consulta textual, não são uma
taxonomia universal das plataformas. RSS sem data/duração pode não satisfazer filtros.
Busca global de VODs Twitch e busca Vimeo ainda não estão disponíveis.

Processamento automático exige direitos já confirmados e acesso ao arquivo. Para
novos itens de Commons/manifestos, uma política explícita de confirmação dos direitos
dos catálogos pode ser ativada separadamente. Essa política registra evidência,
identificador da automação e data. Ela não se aplica a YouTube, Twitch, Vimeo ou RSS.
Itens dessas origens permanecem para revisão ou envio do original quando necessário.

## Agendamento e recuperação

`Automation`, `SearchRun` e `MediaAsset` são adicionados por migração, sem substituir
registros ou migrações anteriores. Agendamentos usam Job Schedulers do BullMQ na fila
existente, com concorrência global 1 para CPU. Intervalo mínimo: 60 minutos; máximo
de dez candidatos por execução, dez cortes por vídeo e cinquenta monitoramentos.
Consultas multiorigem usam cache Redis de quinze minutos e limite de cinquenta buscas
externas por plataforma/dia. Não há varredura periódica SQL para coordenar trabalho.

O startup recupera tarefas de mídia `QUEUED`, `PROCESSING` e `RETRYING` e continua
etapas concluídas ainda pendentes. Etapas concluídas são reutilizadas; continuação
usa chaves únicas e três tentativas com backoff. Seleção LLM interrompida exige revisão
do consumo e não é repetida cegamente. Buscas interrompidas ficam registradas e o
agendamento permanece no Redis. Há reconstrução dos agendamentos no startup.

`POST /jobs/:id/cancel` cancela a produção e descendentes conhecidos. O cancelamento
é cooperativo: uma operação FFmpeg/Whisper já em execução pode terminar no worker,
mas o resultado não deve iniciar etapas seguintes. Não encerra o processo Python.
Downloads têm limite de dez minutos; chamadas de mídia têm timeout de trinta minutos.

`/health` não consulta PostgreSQL. `/ready` é uma verificação completa sob demanda,
não deve ser usado em monitores periódicos de Neon. Pools fecham conexões ociosas
após trinta segundos. Não foi configurada nenhuma instância Neon.

## Segurança e armazenamento

Uploads e downloads limitam arquivos a 512 MB e validam duração até duas horas via
FFprobe. Downloads exigem HTTPS, host aprovado, portas padrão e DNS público. O IP
validado é usado na conexão TLS com SNI/certificado originais, sem segunda resolução
DNS, proxies, cookies ou redirecionamentos. A leitura é limitada e arquivos temporários
são removidos em falhas. Feeds rejeitam DTD/entidades e respostas maiores que 2 MB.

O worker exige pelo menos 1 GB livre antes de importar ou criar artefatos. Não existe
limpeza destrutiva automática: acompanhe o diretório `media` e faça retenção conforme
sua política. Downloads existentes e uploads idênticos são reaproveitados. A identidade
de produção inclui configurações de cortes e provedor/modelo; arquivos baixados também
usam SHA-256 para reaproveitar transcrições equivalentes.

Antes de disponibilizar um corte, FFprobe valida H.264, dimensões 720×1280,
áudio AAC quando a origem contém áudio e duração com tolerância de 300 ms.
Falhas removem os artefatos incompletos e são mostradas como falha real.

## IA

Mock, Ollama e OpenAI permanecem. Gemini usa a API oficial `generateContent`, JSON
Schema e o mesmo ledger de reservas, tokens e custos. Configure `LLM_PROVIDER=gemini`,
`LLM_MODEL`, `GEMINI_API_KEY`, `LLM_ALLOW_EXTERNAL=true`. Para projeto gratuito
confirmado pelo operador, configure `GEMINI_FREE_TIER_CONFIRMED=true`; para projeto
pago, são necessários autorização explícita, preços e orçamento. A gratuidade depende
do projeto e do modelo, não da presença de uma chave. Nenhuma chamada externa é
habilitada por padrão. Respostas e timestamps continuam sujeitos à validação local.

## Verificação reproduzível

```powershell
npm test
npm run lint
npm run build
apps/worker-python/.venv/Scripts/python.exe -m pytest apps/worker-python/tests -q -o pythonpath=apps/worker-python
docker compose up -d --build
node scripts/multiorigin-smoke.mjs
```

O smoke usa `.env` sem imprimir credenciais e exige `LLM_PROVIDER=mock`. Utiliza
`media/fixtures/e2e-authorized-20261028.mp4`, fala sintética autorizada existente.
Se não houver essa fixture, gere uma nova com `scripts/create-fixture.ps1` e ajuste
`$env:MULTIORIGIN_FIXTURE_PATH='media/fixtures/nome-novo.mp4'` antes do smoke.
Use uma fixture nova se o histórico já tiver esgotado os trechos elegíveis da antiga;
o teste não remove cortes nem desativa a proteção contra duplicação.
Ele não baixa nem publica conteúdo de terceiros. Os relatórios
ficam em `artifacts/`, fora do Git. Consulte a validação da entrega para os testes
online, reinícios e limitações efetivamente observadas.

## Referências oficiais

- [YouTube Data API: videos.list](https://developers.google.com/youtube/data/reference/rest/v3/videos/list)
- [Twitch: vídeos](https://dev.twitch.tv/docs/api/videos)
- [Vimeo: oEmbed](https://developer.vimeo.com/api/oembed/videos)
- [MediaWiki: imageinfo](https://www.mediawiki.org/wiki/API:Imageinfo)
- [Gemini: respostas estruturadas](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)
