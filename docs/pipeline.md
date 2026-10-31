# Pipeline e Biblioteca

1. **Inspeção:** `POST /media/inspect` normaliza identidade e reutiliza mídia já importada antes da consulta externa.
2. **Produção:** `POST /productions` verifica autorizações e cria/reutiliza tarefa com chave de idempotência.
3. **Download:** worker `/download` obtém bytes; hash, FFprobe e gravação atômica permitem avançar.
4. **Transcrição:** faster-whisper real, CPU/INT8, detecção de fala e timestamps por palavra; JSON em `media/outputs`.
5. **Seleção:** Gemini, OpenAI ou Ollama recebem segmentos limitados e contrato estruturado. Heurística/mock são identificados separadamente.
6. **Renderização:** cada trecho agenda `clip`; FFmpeg gera MP4 H.264 vertical 720×1280, áudio e SRT separado.
7. **Biblioteca:** produção, etapas e cortes agrupados, prévia e download autenticados.

Sem fala, a produção termina com causa explícita. Seleção vazia, acesso recusado, falta de espaço e falhas LLM não geram resultados fictícios.

## Continuação e deduplicação

Estados: `QUEUED`, `PROCESSING`, `RETRYING`, `COMPLETED`, `FAILED`, `CANCELLED`. `continuationDone` registra o encaminhamento seguinte. A API agenda a continuação imediatamente e recupera pendências ao iniciar. **Retomar** é recuperação excepcional; produção saudável não depende desse clique.

A interface consulta progresso enquanto ativa; não há timer novo de polling do PostgreSQL no servidor. Uma produção idêntica reutiliza sua chave. Arquivos baixados usam chave independente das opções editoriais; uploads duplicados usam SHA-256; transcrições compatíveis também podem ser reutilizadas. Reprocessamento gera outra versão editorial preservando anteriores.

## Dados históricos

`GET /library` devolve produções e cortes. Exclusão é lógica (`deletedAt`), restauração recupera registros e etapas compartilhadas sobrevivem. Não são apagados arquivos históricos, inclusive os originados por conectores removidos.

Enquadramento vertical não é tracking facial/multicâmera. Revise transcrição, seleção e legendas antes de publicar. Veja [evidências](validation.md).
