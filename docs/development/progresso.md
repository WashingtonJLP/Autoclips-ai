# Retomada e fases

Retomada após `a4b2ba2`: main sincronizada, sem alterações em arquivos rastreados.
Os arquivos não rastreados eram a infraestrutura da fase 3 e foram preservados.

1. Preparação: implementada em `eff7ab4`.
2. Aplicações: implementadas em `a4b2ba2`; health checks, testes e builds locais.
3. Infraestrutura: implementada em `2325d7f`; cinco serviços saudáveis, volumes
   persistentes e publicação em loopback. Porta da API alterada para 3003 para
   preservar outro projeto que usa 3001.
4. Integração: implementada em `c4f6cfb`; migração aplicada, readiness, echo HTTP,
   tarefa BullMQ, fonte autorizada e persistência validados em execução.
5. Transcrição: implementada em `4a6e6f5`; ASR real em CPU/INT8, três segmentos,
   palavras/timestamps e arquivo JSON, tanto localmente como via fila Docker.
6. Cortes: implementados em `7ef0b58`; fluxo real até MP4 720×1280 e SRT, com
   legendas inseridas, e simulação retornando `published: false`.
7. Qualidade: CI configurado; dashboard ampliado com cadastro de fontes, tarefas,
   resultados e simulação. Validações finais registradas em qualidade.md.

Este registro será atualizado com os resultados efetivamente observados.

## Limites atuais

Ainda pendentes: descoberta por conectores, obtenção autorizada de mídia, seleção
inteligente de trechos, títulos/descrições automáticos, métricas de desempenho
editorial, autenticação, download de artefatos pelo dashboard e publicação real.
Verificação jurídica é revisão do operador com evidência, não uma decisão da IA.
O servidor TrueNAS/i5-2310 não foi acessado; benchmark e deploy estão pendentes.
