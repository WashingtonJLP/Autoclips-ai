# Pipeline e Biblioteca

Em **Criar cortes**, escolha URL, upload ou vídeo existente. Configure quantidade, duração máxima, idioma e legendas. Um clique em **Gerar cortes** inicia a produção; não existe segunda confirmação de direitos. Informações de uso e publicação ficam em Configurações.

1. **Inspeção:** `POST /productions` aceita a URL diretamente, normaliza identidade e reutiliza mídia já importada antes da consulta externa.
2. **Produção:** valida acesso e cria/reutiliza tarefa com chave de idempotência.
3. **Download:** worker `/download` obtém bytes; hash, FFprobe e gravação atômica permitem avançar.
4. **Transcrição:** faster-whisper real, CPU/INT8, detecção de fala e timestamps por palavra; JSON em `media/outputs`.
5. **Seleção:** Gemini, OpenAI ou Ollama recebem segmentos limitados e contrato estruturado. Heurística/mock são identificados separadamente.
6. **Renderização:** cada trecho agenda `clip`; FFmpeg gera MP4 H.264 vertical 720×1280, áudio e SRT separado. `burnSubtitles=true` incorpora legendas visualmente (padrão); `false` gera MP4 sem sobreposição. A transcrição continua sendo usada nas duas opções; a preferência é salva no navegador e na produção.
7. **Biblioteca:** produção, etapas e cortes agrupados, prévia e download autenticados.

Sem fala, a produção termina com causa explícita. Seleção vazia, acesso recusado, falta de espaço e falhas LLM não geram resultados fictícios.

## Continuação e deduplicação

Etapas técnicas: `QUEUED`, `PROCESSING`, `RETRYING`, `COMPLETED`, `FAILED`, `CANCELLED`. A produção agrega a cadeia inteira. `EMPTY` significa nenhum trecho elegível ou ausência de fala; `CLIPS_REMOVED` significa cortes excluídos posteriormente. Falha de renderização não vira sucesso com zero cortes. Uma falha parcial permanece visível mesmo quando outros cortes ficaram prontos. `continuationDone` registra o encaminhamento seguinte. A API agenda a continuação imediatamente e recupera pendências ao iniciar; produção saudável não depende de **Retomar**.

Acompanhamento e Biblioteca consultam o estado a cada cinco segundos somente enquanto existe produção ativa e a página está visível. Mutações, retorno à aba e eventos entre abas sincronizam listagens. Não há timer novo de consultas periódicas ao PostgreSQL no servidor. O endereço `?producao=ID` e a produção ativa salva localmente preservam o acompanhamento após recarga. Não há porcentagens estimadas.

O formulário bloqueia envios imediatamente. No backend, identidade da mídia, opções normalizadas e política de seleção determinam uma chave única protegida por transação serializável. Cliques rápidos e abas concorrentes reutilizam a mesma produção. Configurações diferentes, inclusive legendas, geram outra produção. A opção avançada de nova versão reutiliza a produção ainda ativa e cria outra geração somente quando a anterior terminou. Arquivos baixados usam chave independente das opções editoriais; uploads duplicados usam SHA-256; transcrições compatíveis podem ser reutilizadas.

**Tentar novamente** recupera tarefas falhas ou canceladas preservando resultados concluídos. Erros transitórios têm até três tentativas automáticas; erros permanentes não são repetidos automaticamente. Um 429 externo exige espera mínima de 60 segundos antes da recuperação manual. Worker ocupado é espera adiada, limitada a 30 minutos, sem consumir tentativas nesse intervalo. Veja [diagnóstico do 429](troubleshooting.md).

Cancelar impede o avanço e marca etapas pendentes/ativas. A chamada já iniciada pode terminar no worker, mas seu resultado não inicia novas etapas da produção cancelada. A recuperação aguarda o job anterior encerrar antes de reutilizá-lo. Arquivos e histórico são preservados.

## Direitos e segurança

A política interna `PROCESSING` registra a solicitação autenticada e permite executar o fluxo tecnicamente disponível. Ela não declara licença nem autorização comercial: `commercialUseVerified=false`. Licenças verificadas existentes são preservadas. Acesso público não concede direitos de reutilização ou publicação. Validações de rede, autenticação interna, limites e bloqueios externos continuam vigentes. Não há bypass de DRM ou de acesso.

## Dados históricos

`GET /library` devolve produções e cortes finais sem duplicar registros. **Tarefas recentes** apresenta uma linha por produção com etapa, status, horário e Acompanhar; os detalhes técnicos ficam recolhidos. Contadores incluem somente cortes concluídos com vídeo visível.

Excluir uma produção a oculta das listagens normais, tarefas recentes e contadores; etapas exclusivas ativas são canceladas. Etapas compartilhadas por outra produção sobrevivem. Excluir um corte preserva seus irmãos e as tarefas compartilhadas. Excluir o último corte muda o estado agregado para **Cortes excluídos**.

A exclusão é lógica (`deletedAt`), sem apagar mídia física. **Desfazer exclusão** usa o token daquela operação e restaura a visibilidade; produções canceladas não são reiniciadas automaticamente. Registros históricos de conectores removidos permanecem preservados.

Enquadramento vertical não é tracking facial/multicâmera. Revise transcrição, seleção e legendas antes de publicar. Veja [evidências](validation.md).
