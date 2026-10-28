# Retomada e fases

Retomada após `a4b2ba2`: main sincronizada, sem alterações em arquivos rastreados.
Os arquivos não rastreados eram a infraestrutura da fase 3 e foram preservados.

1. Preparação: implementada em `eff7ab4`.
2. Aplicações: implementadas em `a4b2ba2`; health checks, testes e builds locais.
3. Infraestrutura: implementada em `2325d7f`; cinco serviços saudáveis, volumes
   persistentes e publicação em loopback. Naquela etapa, a API foi para 3003;
   esse mapeamento histórico foi substituído por 3101 na correção descrita abaixo.
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

Conectores, download autorizado, fluxo automático, autenticação, artefatos, OAuth
e agendamento simulado foram acrescentados em 28/10/2026. Permanecem dependentes
de credenciais/autorização: inferência editorial paga, OAuth com contas reais,
publicação real e confirmação do Scale to Zero numa conta Neon existente.
Métricas editoriais de produção ainda não foram avaliadas.
Verificação jurídica é revisão do operador com evidência, não uma decisão da IA.
O servidor TrueNAS/i5-2310 não foi acessado; benchmark e deploy estão pendentes.

## Seleção de trechos por LLM

Núcleo implementado em `ff48d2b`: interface de provedores, mock determinístico,
adaptador opcional Ollama local, orçamento por seleção, blocos com limite de
entrada/saída, notas por gancho/contexto/valor/clareza, tempos derivados de IDs,
classificação, deduplicação e sugestões de título/descrição.

Integração implementada em `ada5692` com `LlmBudget`/`LlmCall`, reserva serializável por dia
UTC, consumo/custo quando informado, preservação de reservas desconhecidas e
cache por tarefa/bloco. A API enfileira seleção a partir de transcrição concluída
e renderiza trechos no pipeline existente, com metadados editoriais e chave única
contra repetição. O dashboard mostra sugestões e permite selecionar/renderizar.

Testes da integração usam um vídeo sintético e uma transcrição stub declarada;
o corte e as legendas são produzidos por FFmpeg real. Nenhum LLM real foi
executado. A qualidade semântica dos trechos não foi validada por inferência real.
O padrão continua mock e a publicação continua simulada.

## MVP operacional — 28/10/2026

`8eded52` acrescenta conectores Commons/manifestos, download HTTPS com hash e
evidência, continuação automática na fila existente, OpenAI opcional com reservas,
OAuth cifrado, agendamento simulado, autenticação e acesso aos artefatos.
O dashboard não consulta mais o banco a cada cinco segundos; conexões ociosas
expiram em 30 s e health checks não usam PostgreSQL. Neon é uma configuração
opcional, sem substituir ou apagar o volume local.

O teste real também revelou legendas longas demais. A correção usa palavras ASR
para blocos curtos sincronizados. A fixture sintética agora escolhe voz e idioma
correspondentes, sem sobrescrever arquivos. Resultados reais e bloqueios estão
registrados em [qualidade](qualidade.md#validação-operacional-em-28102026), com
[procedimento pelo dashboard](operacao.md#iniciar-e-testar-pelo-dashboard).

## Redesign administrativo do frontend

`7fbcb26` substitui a página única por Visão geral, Criar cortes, Biblioteca,
Publicações, Fontes e Configurações. Funcionalidades migradas para componentes
reutilizáveis, com filtros/paginação, menu responsivo, player e detalhes avançados
sob demanda. Nenhuma mudança de backend ou infraestrutura. O teste HTTP do
frontend valida as integrações existentes sem ativar consumo pago ou publicação.
Limitações e validações estão em [dashboard](dashboard.md) e [qualidade](qualidade.md).

## Isolamento de portas — 28/10/2026

AutoClips publica somente `localhost:3100` (web interna 3000) e `localhost:3101`
(API interna 3001). Worker, PostgreSQL e Redis seguem apenas na rede Docker.
URLs externas, defaults locais, callback YouTube, scripts, testes e CI atualizados.
Login e proxy de mesma origem preservados, sem liberar CORS adicional.
Somente web/API foram recriados; MatchPredict e containers de dados/processamento
mantiveram IDs, inicialização, imagens, portas e montagens, conferidos por snapshot.
