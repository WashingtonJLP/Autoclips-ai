# Processamento local

O worker aceita caminhos relativos a `MEDIA_ROOT` e exige `rights` com `license`,
`evidence_url`, `attribution` e `commercial_use_verified: true`. A API monta esses
campos a partir da fonte revisada. Arquivos externos, symlinks para fora da raiz,
protocolos de rede e formatos não previstos são rejeitados. Limites: 2 GB e 2 horas.

`POST /transcribe` gera JSON com idioma, duração, segmentos, palavras e timestamps.
O modelo tiny é carregado sob demanda, em CPU/INT8, com duas threads. A primeira
execução baixa o modelo gratuito do Hugging Face; o cache permanece no volume.
Não há consumo de APIs pagas. Modelo e mídia não entram no Git.

Uma trava compartilhada impede transcrições/cortes simultâneos; recebe 429 se
ocupado. Execute um único processo Uvicorn. A API enfileira uma tarefa por vez.
Modelos permitidos: tiny/base e variantes `.en`. A qualidade exige revisão humana.

No Windows com FFmpeg no PATH, `./scripts/create-fixture.ps1` gera voz sintética
local via System.Speech e vídeo de teste. O material não vem de fonte externa.
Cadastre a origem como PERMISSION, descrevendo a geração local na atribuição e
usando como evidência o arquivo de script do repositório. Essa declaração vale
somente para a fixture, não concede autorização para conteúdo de terceiros.

O i5-2310 ainda exige benchmark real. Tiny reduz custo, mas não garante operação
em tempo real. Cancelamento de uma requisição não interrompe automaticamente a
inferência em andamento. Reiniciar durante processamento pode exigir revisão da tarefa.

Validação local: fixture com voz sintética transcrita em tiny/CPU/INT8, com três
segmentos, timestamps de palavras e exportação JSON. A pronúncia sintética e a
detecção automática de idioma produziram erros de texto: revisão é obrigatória.
PyAV foi limitado a `>=15,<17`, validado em 16.1.0. PyAV 19 removeu um parâmetro
usado pelo faster-whisper 1.2.1, conforme o [issue oficial](https://github.com/SYSTRAN/faster-whisper/issues/1589).
O cache Windows pode ocupar mais espaço quando symlinks não são permitidos;
nenhuma política de segurança foi modificada para habilitá-los.

## Cortes e legendas

`POST /clip` recebe os campos de mídia/direitos, `start`, `end`, `segments`
opcionais (timestamps na linha do tempo original) e `burn_subtitles` opcional.
A API aceita os mesmos campos via `POST /jobs`, com `operation: "clip"`.
Saída H.264/AAC, 720×1280, 30 fps, até 180 segundos, com barras para preservar
o enquadramento. Não há rastreamento de rosto nem seleção automática de momentos.
FFmpeg usa duas threads; modelo não é necessário para cortar.

Legendas são recortadas ao intervalo e deslocadas para zero, exportadas em SRT.
Com `burn_subtitles: true`, o FFmpeg insere o texto no vídeo. Revise texto e
tempos antes de publicar. O resultado informa caminhos relativos dos artefatos;
acesse-os pelo diretório local `media/outputs`, que nunca é versionado.

`node scripts/smoke.mjs` valida dependências, direitos, persistência e fila.
Após gerar a fixture, `node scripts/smoke.mjs --transcribe` valida ASR real;
`node scripts/smoke.mjs --media` executa transcrição → corte → simulação.
Esses testes criam fontes e tarefas de teste no banco local.
