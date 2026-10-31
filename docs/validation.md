# Validação da refatoração

Execução de 31/10/2026. Resultados anteriores não comprovam o caminho direto atual. Wikimedia Commons foi removido do código ativo, interface, testes e scripts. Seus arquivos/registros históricos são preservados.

## Documentação

Os 23 documentos antigos de `docs/`, README e exemplos foram auditados. Guias de arquitetura, deployment, desenvolvimento e decisões foram consolidados nos documentos atuais. Relatórios repetidos de Gemini/multiorigem e instruções contraditórias foram substituídos por funcionamento e limites reais. Inventário local: `artifacts/documentation-audit.json`.

## Consulta real do YouTube

`scripts/youtube-probe.py` executou o extrator real sem cookies, bypass, solvers JS ou download. Para `jNQXAC9IVRw`, retornou **Me at the zoo**, 19 segundos, disponibilidade pública e formatos HTTPS `134` (vídeo) e `140` (áudio). A variante Shorts normalizou para o mesmo ID. O extrator não informou licença; nenhuma licença Creative Commons foi exigida.

`BaW_jenozKc` retornou indisponibilidade real. A tentativa pelo subprocesso de download retornou **404**, com mensagem segura e sem criar arquivo. A consulta adicional de `M7lc1UVf-VE` retornou **YouTube Developers Live: Embedded Web Player Customization**, 1.344 segundos e formatos `136`/`140-drc`; nesse caso o extrator informou licença de atribuição. Não foi usado filtro de licença em nenhuma consulta.

Esses resultados comprovam metadados/formatos, sem provar transferência de bytes nem permissão para download/reutilização. Evidências locais: `artifacts/youtube-direct-probe-final.json` e `artifacts/youtube-direct-refusal-final.json`, sem URLs assinadas.

Não foi fornecido vídeo com permissão verificável de download/processamento pela plataforma. Não há alegação de MP4/SRT originado de download direto YouTube nesta entrega. O teste opt-in está documentado e o caminho implementado; upload local não é apresentado como sucesso YouTube.

## Preservação

Inventário anterior à recriação dos serviços: 64 fontes, 271 tarefas, 32 mídias, 11 automações, 22 execuções de busca, 11 publicações e 20 referências de arquivos importados. Todos os IDs e referências anteriores foram encontrados depois, e os 20 arquivos continuam presentes. O teste acrescentou uma mídia, uma autorização e três tarefas. Não houve migração Prisma ou limpeza de dados.

IDs, imagens, portas e montagens de PostgreSQL, Redis e dos dois containers MatchPredict foram comparados com o snapshot histórico e preservados. API, web e worker foram reconstruídos para aplicar código. Evidências: `artifacts/history-comparison.json` e `artifacts/infrastructure-preserved.json`.

## Pipeline real

Uma nova fixture local autorizada (`refactor-authorized-20261031.mp4`) foi derivada sem sobrescrever o arquivo original. A produção **cmvwd7oin000237n80c35qhg1** concluiu `transcribe → select → clip` automaticamente. A transcrição usou **faster-whisper real**, sem reutilizar transcrição anterior. A seleção registrou `provider=mock`, `simulated=true`, `semanticAnalysis=false`. Nenhuma API externa de IA foi chamada.

O corte **cmvwd7r04000437n8tqvdlg2m** foi renderizado pelo FFmpeg e confirmado pelo FFprobe como H.264 **720×1280**, com áudio AAC e SRT não vazio/timestamps válidos. SHA-256 do MP4: `d232f5b1b89a2c9fb2ae3135ff067c65c4ab15110dda636305bb667219a5886c`. Biblioteca, artefatos autenticados, upload duplicado e solicitação duplicada foram verificados. A repetição após reiniciar os serviços reutilizou a mesma produção; não houve clique de continuação.

Evidência estruturada: `artifacts/refactor-pipeline.json`. MP4/SRT: `artifacts/refactor-cmvwd7r04000437n8tqvdlg2m.mp4` e `.srt`. Esse resultado é de mídia local autorizada, não de download YouTube.

## Verificações

| Verificação         | Resultado                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| API                 | 72 testes aprovados                                                                                              |
| Dashboard           | 9 testes aprovados                                                                                               |
| Python Linux        | 48 testes aprovados, incluindo FFmpeg e symlink                                                                  |
| Python Windows      | 47 aprovados, 1 ignorado por permissão de symlink                                                                |
| Lint/formatação     | ESLint, Prettier e Ruff aprovados                                                                                |
| Builds              | Prisma/API/Next.js e três imagens Docker aprovados                                                               |
| HTTP                | Seis páginas autenticadas, recusa sem login/token, proteção de origem e portas 3100/3101 verificadas             |
| Documentação        | 11 documentos atuais (README + 10 guias), 22 links locais existentes e exemplos JSON válidos                     |
| Dependências        | `npm audit --audit-level=high` aprovado; 10 alertas moderados em dependências existentes; nenhum pacote alterado |
| Integração removida | Busca no código ativo sem conector, endpoint exclusivo, configuração ou referência à integração removida         |

No primeiro teste Linux, o container de teste herdou o token do serviço e dois testes sem autenticação falharam. A execução isolada com `WORKER_API_TOKEN` vazio passou 48/48; a autenticação do serviço permaneceu habilitada. O teste antigo de portas também comparava automaticamente um snapshot de containers de outra entrega: o baseline agora é opt-in, e as verificações HTTP/portas passaram. A preservação da infraestrutura foi validada separadamente contra o snapshot histórico.

## Limitações restantes

Download YouTube autorizado até MP4/SRT ainda requer uma origem com permissão efetiva para comprovação real; formatos encontrados não bastam. Twitch Clips/Vimeo dependem de credenciais/capacidades não validadas aqui. Twitch VOD não implementa download. Seleção real Gemini/OpenAI/Ollama não foi exercitada nesta refatoração. Publicação continua simulada. Nenhuma dessas limitações foi escondida usando mídia de outra plataforma.
