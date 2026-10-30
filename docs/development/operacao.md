# MVP operacional

## Iniciar e testar pelo dashboard

Na raiz do repositório, com Docker Desktop iniciado e as dependências existentes:

```powershell
node scripts/setup-local.mjs
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 180
```

O script completa `.env` sem substituir valores existentes. Não habilita APIs pagas.
Abra http://localhost:3100 e use `DASHBOARD_USER` / `DASHBOARD_PASSWORD` do `.env`.
Não compartilhe esse arquivo. O banco e os volumes anteriores são preservados;
as migrações apenas acrescentam campos/tabelas. Não use `down -v` ou `migrate reset`.

Para um teste sem mídia de terceiros:

```powershell
$nome = 'dashboard-' + [guid]::NewGuid().ToString('N')
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/create-fixture.ps1 -Name $nome
Write-Output "Arquivo para selecionar no upload: media/fixtures/$nome.mp4"
```

1. Abra **Criar cortes → Enviar arquivo** e selecione o MP4 gerado. Em **Mais opções**,
   marque **Este arquivo é conteúdo sintético de teste** para separá-lo na Biblioteca.
   Não é necessário cadastrar fonte nem digitar caminho interno. Para mídia existente,
   use **Escolher vídeo**, pesquise pelo título e habilite os testes se necessário.
2. Defina quantidade, idioma e duração e clique em **Gerar cortes**. Se não houver
   permissão registrada, confirme **Tenho autorização — gerar cortes** somente se
   possuir esses direitos. A declaração fica vinculada ao arquivo, sem aprovar outras mídias.
3. O fluxo continua automaticamente. Em **Mais opções** consta o provedor;
   **Critérios da seleção e fallback** permite mudar a heurística local já selecionada
   no formulário. Quando a IA estiver indisponível, ela produz resultados identificados,
   sem análise semântica. O `.env` e sua política padrão não são alterados pela interface.
4. Clique em **Ver resultado** ou abra **Biblioteca → Produções / Cortes**. Abra a prévia do corte e
   use **Baixar MP4** / **Baixar SRT**.
   Revise a fala, tempos, título e descrição com atribuição.
   Transcrições com palavras usam blocos de até 42 caracteres/3 s, sincronizados
   aos tempos ASR. Textos antigos sem palavras usam os segmentos originais.
5. Na prévia, clique em **Agendar simulação** para abrir **Publicações** com o corte
   selecionado. Escolha plataforma/data e confirme **Agendar simulação**.
   Consulte o resultado em **Publicações → Agendamentos e histórico**. Uma combinação
   tarefa/plataforma tem apenas um agendamento; repetir retorna o registro existente,
   sem alterar a data. Não existe remarcação nesta versão.

Em **Criar cortes**, o progresso atualiza a cada cinco segundos enquanto houver
trabalho ativo e a página estiver visível. Ao terminar, esse polling para.
O fluxo normal continua automaticamente; **Retomar fluxo automático** é uma opção
de recuperação. Erros de transcrição/seleção aparecem nas tarefas.
Uma seleção sem candidatos não produz um vídeo arbitrário. Seleções com falha
desconhecida não são repetidas automaticamente, para preservar o orçamento.

## Coleta e evidências

**Wikimedia Commons** consulta a API oficial; aceita somente vídeos CC BY 4.0 ou
CC0 com URL de licença explícita. Descarta restrições declaradas, BY-SA, NC, ND,
domínio público sem CC0 e arquivos acima de 512 MB. A evidência é uma fotografia
dos metadados, incluindo URL, licença, autoria, timestamp e hash da mídia.
Licenças em URLs `deed`/`legalcode` são normalizadas sem ampliar as licenças aceitas.
Metadados numéricos auxiliares da API não invalidam a licença.

Busque um tema, abra a evidência e revise direitos de terceiros. Marque a revisão
e clique em **Importar e criar cortes**. A API consulta novamente os
metadados antes de registrar a aprovação do operador. O worker compara o SHA-1
do arquivo com o informado pelo Commons e registra também SHA-256. Importe novamente
a mesma referência para obter a mesma tarefa, sem outro download/processamento.
Não há aprovação jurídica automática nem varredura sem revisão de fontes novas.

**Catálogo autorizado** usa manifestos HTTPS configurados pelo operador:

```dotenv
SOURCE_MANIFEST_URLS=["https://seu-dominio.example/catalogo.json"]
MEDIA_DOWNLOAD_HOSTS=seu-dominio.example
```

```json
{
  "items": [
    {
      "id": "video-autorizado",
      "name": "Exemplo autorizado",
      "url": "https://seu-dominio.example/video",
      "license": "PERMISSION",
      "evidenceUrl": "https://seu-dominio.example/permissao",
      "attribution": "Autor e termos da autorização comercial",
      "mediaUrl": "https://seu-dominio.example/video.mp4"
    }
  ]
}
```

O download de arquivo direto autorizado aceita HTTPS e endereços públicos, sem redirects,
cookies de plataformas, extratores ou contorno de bloqueios. Formatos: MP4, WebM,
OGV e MOV. Há limites de bytes/tempo e validação FFprobe até duas horas. Manifestos
são configuração confiável do servidor; nunca aceite URLs de manifestos do cliente.

Fontes são opcionais e servem para descoberta/monitoramento; podem ser cadastradas
sem afirmar direitos comerciais. Permissões por mídia são registros internos separados
da lista de fontes monitoradas. Licenças de catálogo são registradas automaticamente;
sem licença ou permissão válida, o processamento pede uma declaração para aquela mídia.
Isso não substitui verificação jurídica nem libera download de plataformas sem original.

Na Biblioteca, **Excluir corte** preserva os irmãos; **Excluir produção** cancela etapas
ativas e retira seus cortes exclusivos. Etapas compartilhadas continuam disponíveis
para outras produções. A exclusão é lógica e pode ser desfeita; originais e artefatos
continuam no disco, sem liberação automática de espaço. Agendamentos pendentes dos
itens excluídos são cancelados. Restaurar não reinicia tarefas canceladas.

## IA por API, desabilitada por padrão

`LLM_PROVIDER=mock` mantém o teste sem consumo. Ollama local continua disponível.
O adaptador `openai` usa [Chat Completions e saída estruturada oficiais](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).
Para um teste pago futuro, após autorização específica, o operador deve configurar
`OPENAI_API_KEY`, `LLM_MODEL` explícito, `LLM_ALLOW_EXTERNAL=true`,
`LLM_ALLOW_PAID=true`, preços conservadores positivos em
`LLM_INPUT_USD_PER_MILLION` / `LLM_OUTPUT_USD_PER_MILLION` e orçamentos positivos
`LLM_RUN_COST_MICROS` / `LLM_DAILY_COST_MICROS` (milionésimos de USD).
Confira os preços do modelo antes de habilitar. Não há preços ou modelo pago presumidos.

A reserva por bloco/dia já existente é reutilizada. Limite de saída, uso real em
tokens e custo calculado pelas tarifas configuradas são registrados. Este custo
é uma estimativa conservadora, não uma fatura da OpenAI. Falhas mantêm reservas
de consumo desconhecido. Não há retry automático da chamada paga, nem fallback
silencioso que esconda falhas editoriais. Credenciais não aparecem na configuração pública.

## OAuth e publicação

Configure `PLATFORM_TOKEN_KEY` (32 bytes em hexadecimal, gerados pelo setup),
`YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` e callback registrado
`http://localhost:3100/oauth/youtube`. O fluxo usa state em Redis por 10 minutos,
consumo atômico do state e PKCE, com escopo `youtube.upload` e acesso offline.
Tokens são cifrados com AES-256-GCM no PostgreSQL. Preserve a chave para poder
decifrar tokens existentes. Não há tokens no navegador nem no retorno de status.
Renovação é sob demanda por `POST /oauth/refresh`, nunca por timer.

O adaptador de [upload oficial YouTube](https://developers.google.com/youtube/data/guides/using_resumable_upload_protocol)
inicia sessão resumível e envia MP4 privado. Está isolado e bloqueado: **a fila e
o dashboard nunca o invocam**. Antes de ativação futura, ainda serão necessárias
autorização do operador, credenciais válidas, tratamento operacional de retomada
de uploads interrompidos e revisão de consentimento/metadados. Não configure
`PUBLISH_ALLOW_REAL`; não há rota que libere publicação nesta versão.

TikTok tem OAuth preparado com `TIKTOK_CLIENT_ID` (client key), secret e callback
**HTTPS estático** registrado em `TIKTOK_REDIRECT_URI`. A publicação depende de app
aprovado, escopo `video.publish`, consulta de `creator_info` e consentimento específico;
o upload TikTok não foi ativado. Veja [Login Kit Web](https://developers.tiktok.com/docs/en/login-kit-web)
e [Content Posting API](https://developers.tiktok.com/docs/en/content-posting-api-get-started).
Não crie aplicativos ou credenciais automaticamente.

Agendamentos são jobs atrasados do BullMQ. O banco é consultado ao agendar,
executar ou recuperar na inicialização, sem scheduler que consulte PostgreSQL.

## Neon e inatividade

O Compose normal continua usando PostgreSQL local. Para uma instância Neon
**já existente e autorizada**, configure `NEON_DATABASE_URL` pooled e
`NEON_DIRECT_DATABASE_URL` direta, ambas com `sslmode=require`, e use:

```powershell
docker compose -f compose.yaml -f compose.neon.yaml config --quiet
docker compose -f compose.yaml -f compose.neon.yaml up -d api
```

Esse comando aplica migrações no banco explicitamente selecionado. Revise as URLs
antes de executá-lo. Nenhum recurso Neon é criado pelo projeto.
Runtime usa pool máximo 3, timeout ocioso 30 s, sem keepalive SQL. Migrações usam
`DIRECT_DATABASE_URL`; `/health` não consulta dependências. `/ready` consulta o banco
somente sob demanda: **não use `/ready`, `/jobs`, `/llm/config` ou `/platforms` em
monitores periódicos**. Jobs atrasados aguardam em Redis. Um job agendado futuro
acordará o banco ao executar, como esperado. Desabilite sondagens SQL de serviços
externos para permitir os [5 minutos de Scale to Zero](https://neon.com/docs/introduction/scale-to-zero).
O desligamento real depende das configurações do Neon e não foi testado em uma conta externa.

## Segurança e limites

Dashboard protegido por Basic Auth; API com bearer interno e worker com segredo
próprio, ambos injetados somente no servidor. Compose exige credenciais. Fora do
Compose, desenvolvimento permite ausência de segredo em loopback; use as variáveis
do `.env` ao iniciar serviços manualmente. Em produção, dashboard e API falham
fechados sem configuração. Não exponha HTTP Basic fora de loopback sem HTTPS.
É um MVP de operador único, sem gestão de usuários, RBAC ou limitação de tentativas
de login. As rotas proxy usam lista de permissões e validam a origem de POST.
Downloads de artefatos aceitam apenas saída da tarefa e nomes gerados no servidor.

Pipeline preserva resultados já concluídos em reentregas e continua com chaves
idempotentes. Recuperação após perda total do Redis de uma tarefa PROCESSING
exige revisão manual. Não apague dados ou reservas para contornar um erro.
