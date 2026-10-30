# Verificação funcional final — 30/10/2026

Verificação iniciada em `main`, limpa e sincronizada com `origin/main` no commit
`5c4f421`. Docker Desktop estava parado; 3100/3101 não respondiam. Após iniciar
o aplicativo existente e executar `docker compose up -d --no-build --wait`, os
cinco serviços ficaram saudáveis. Volumes, PostgreSQL local e histórico preservados.
Não foram alterados containers MatchPredict, infraestrutura de produção ou Neon.

## Resultados desta execução

| Funcionalidade          | Resultado                                            | Evidência local / limite                                                                                                                                                                                             |
| ----------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entrada por link        | FUNCIONA para arquivo autorizado                     | `final-direct-link.json`: download HTTPS real de WebM CC0, importação, Whisper, seleção mock, FFmpeg e MP4. Quatro etapas COMPLETED; produção `cmvvjljbo000336t3sic5yiea`                                            |
| YouTube                 | PARCIAL                                              | oEmbed online retornou “Me at the zoo”; URL curta e longa reutilizaram o mesmo asset. Arquivo inacessível, direitos não confirmados; busca bloqueada por falta de `YOUTUBE_API_KEY`. Não houve download              |
| Twitch                  | NÃO TESTADO com credenciais                          | Link VOD e monitoramento retornaram falta de `TWITCH_CLIENT_ID` / `TWITCH_ACCESS_TOKEN`. Não há extrator de VOD nem busca global                                                                                     |
| Upload manual           | FUNCIONA via proxy HTTP                              | Nova fixture `final-authorized-20261030.mp4`, hash distinto, upload binário autenticado e FFprobe; segundo envio reutilizou asset `cmvvjjzix000937t3qe80q55b`                                                        |
| Vídeo importado         | FUNCIONA via API; interface pendente                 | Produção por `assetId`, sem caminho interno; `cmvvjjznc000a37t3gbzei539`. Formulário tem “Escolher vídeo”; cliques não foram autorizados pela ferramenta                                                             |
| Fontes cadastradas      | PARCIAL                                              | Fonte Commons existente descoberta duas vezes, ambas com found=1/processed=1; não surgiram novos vídeos externos durante o teste. Twitch bloqueado. Monitores criados no teste foram pausados                        |
| Busca automática        | FUNCIONA em Commons; demais dependem de configuração | Busca temática BullMQ gerou MP4 `cmvvjk57h000w37t3sh7m8sng` com mock. Idioma `pt` e duração 1–20 excluíram candidato de idioma desconhecido; plataforma repetida retornou um único asset                             |
| Transcrição             | FUNCIONA                                             | faster-whisper tiny, CPU/INT8, palavras e três segmentos reais; mídia sintética nova de 10,774 s                                                                                                                     |
| Seleção por IA          | PARCIAL / bloqueada nesta sessão                     | Configurado Gemini `gemini-3.5-flash-lite`; quota persistida 2/2. Nova seleção real falhou antes da rede. Não se comprovou análise editorial real                                                                    |
| Renderização e legendas | FUNCIONA                                             | FFmpeg real, H.264/AAC, 720×1280; corte 0–9,94 s; decodificação integral sem erro; SRT com cinco blocos dentro da duração, alinhados aos tempos ASR; frame de 4 s inspecionado                                       |
| Pipeline completo       | PARCIAL                                              | Link → importação → Whisper → mock → MP4/SRT passou sem Retomar. Com configuração Gemini restaurada, produção importada → heurística explícita → MP4 também passou. Pipeline com seleção LLM real permanece pendente |
| Biblioteca              | PARCIAL                                              | Página autenticada e downloads MP4/SRT/JSON aprovados. Player, reprodução no navegador e navegação por cliques não inspecionados                                                                                     |
| Publicação simulada     | FUNCIONA / SIMULADA                                  | Agendamento BullMQ chegou a SIMULATED; repetição retornou mesmo registro; `published=false`, nenhuma publicação real                                                                                                 |

Os artefatos indicados ficam em `artifacts/`, ignorados pelo Git. As mídias de teste
permanecem locais. A licença CC0 foi obtida pelo conector Commons antes de importar;
não foi extraído conteúdo YouTube/Twitch nem contornada qualquer restrição.

## Defeitos e regressões

- **Corrigido:** fallback explícito não atendia quota Gemini esgotada. Reproduzido
  em `final-heuristic-before.json`: seleção FAILED mesmo com `fallback=heuristic`.
  Causa: quota lançava `SelectionError`, enquanto fallback aceita indisponibilidade.
  Agora lança `LlmUnavailableError`, preservando transação, contador e bloqueio de rede.
  `final-heuristic-after.json`: seleção COMPLETED, origem heuristic,
  `semanticAnalysis=false`, MP4 `cmvvjpd6n000237lh3exbubxo`. Não há fallback silencioso.
  Teste automatizado verifica fallback desligado, ligado, zero transporte e zero reservas.
- **Corrigido na documentação:** operação ainda orientava caminho interno, botão antigo
  e ausência de atualização. Agora descreve upload, seleção de asset e polling ativo.
- **Roteiro de teste:** fixture histórica retornou zero candidatos porque seus cortes
  equivalentes já existiam. O smoke agora aceita `MULTIORIGIN_FIXTURE_PATH`; com fixture
  nova, passou sem apagar histórico ou enfraquecer a proteção contra duplicação.
- **Caminho interno:** upload e produção por asset passaram. O formulário mantém caminho
  apenas na opção técnica. A interação visual ainda não foi executada.
- **Continuação pendente:** mídia com fala percorreu etapas sem chamadas intermediárias
  ou Retomar. Quota e falta de candidatos mostram causa específica. Testes automatizados
  cobrem ausência de fala; não foi recriada uma nova mídia silenciosa nesta sessão.
- **Duplicação:** upload/produção idênticos reutilizados; preferências diferentes e
  reprocessamento explícito geraram IDs distintos. Oito chamadas concorrentes após a
  correção reutilizaram uma produção sem criar novas tarefas ou arquivos. Uma produção
  normal posterior ao reprocessamento foi bloqueada por corte semelhante, como esperado.

## Verificações automatizadas e operacionais

- API: **52/52**; dashboard React: **7/7**.
- Python: **13 aprovados, 1 ignorado** (symlink sem privilégio no Windows); Ruff aprovado.
- ESLint, geração Prisma, build completo Next.js/API e imagem Docker da API aprovados.
- Seis páginas: sem autenticação retornaram 401, com credenciais locais retornaram 200.
  Proxy rejeitou origem indevida e rota interna; MP4/SRT/JSON foram recuperados.
- Recuperação: tarefa de teste PROCESSING sem mensagem Redis chegou a MP4 após restart
  da API; segundo restart preservou os mesmos três IDs concluídos (`recovery-smoke.json`).
- Redis com AOF habilitado, último write OK e política `noeviction`. Não houve teste de
  falha total do host/Redis nem garantia universal de durabilidade.
- Consulta sob demanda mostrou zero tarefas ativas e, após ociosidade, zero conexões
  `autoclips-api` no PostgreSQL. Pool fecha conexões ociosas em 30 s; health HTTP não
  consulta banco. `/ready` consulta SQL sob demanda; Compose monitora `/health`.
  BullMQ agenda no Redis, sem varredura SQL periódica. Scale to Zero não foi testado
  em Neon e depende também dos monitores externos.

## IA, ambiente final e pendências

O `.env` foi preservado. Mock foi ativado somente por override temporário da API
para testes; ao terminar foi removido da execução e a API foi reconstruída com a
correção. Configuração final: Gemini, external=true, paid=false, fallback padrão none,
quota 2/2 e custo diário comprometido zero. Nenhuma nova requisição Gemini foi enviada,
nenhum faturamento ativado; o diagnóstico agendado existente não foi alterado.
Resultados mock são simulados. Resultados heuristic são regras locais, sem LLM.

Pendências: seleção estruturada Gemini real após disponibilidade/quota; credenciais
YouTube Data API e Twitch Helix; acesso autorizado aos originais dessas plataformas;
RSS/manifests externos não configurados. Busca global Twitch, busca/download autenticado
Vimeo e publicação real não estão disponíveis no fluxo do MVP.

O host de automação de navegador estava indisponível; a tentativa de controlar Opera
GX foi rejeitada por permissões (“Computer Use was not approved”). Login HTTP foi
testado, mas inspeção visual do dashboard, seleção por cliques, player e reprodução
permanecem **NÃO TESTADOS**. Inspeção de frame do MP4 não substitui esses testes.

## Gerar um corte pela interface

1. Abra `http://localhost:3100` e autentique com as credenciais do `.env`.
2. Em **Criar cortes → Escolher vídeo**, selecione o teste sintético já importado
   e sua fonte autorizada. Para mídia nova: cadastre sua fonte/evidência em **Fontes**
   e use **Enviar arquivo**, escolhendo o MP4/WebM no seletor de arquivos.
3. Escolha um corte, inglês para a fixture, duração mínima 5 s e máxima 30 s.
   Em **Critérios da seleção e fallback**, escolha **Usar heurística local identificada**
   enquanto Gemini estiver sem quota. Para repetir o teste já cortado, marque
   **Opções avançadas → Reprocessar explicitamente**.
4. Mantenha **Concluir automaticamente**, clique **Gerar cortes** e acompanhe o progresso.
   Ao concluir, abra **Biblioteca** para prévia e **Baixar MP4 / Baixar SRT**.

Esse procedimento corresponde aos contratos e controles presentes na aplicação;
o fluxo equivalente foi testado por API/proxy, sem afirmar validação dos cliques.
