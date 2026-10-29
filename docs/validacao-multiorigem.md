# Validação da expansão multiorigem — 29/10/2026

Ambiente: Windows, Node 22.17.1, Python 3.12, Docker Desktop Linux.
PostgreSQL/Redis/worker internos; dashboard em 3100 e API em 3101. Dados, volumes,
histórico e migrações anteriores foram preservados. Nenhuma publicação ou chamada
LLM paga foi executada. Não foi configurado Neon nem alterado outro projeto.

## Resultados executados

| Cenário obrigatório         | Resultado e evidência                                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Link autorizado          | Wikimedia Commons CC0, vídeo de 15 s, download HTTPS real e pipeline completo até MP4/SRT; `scripts/link-smoke.mjs`                                                                                    |
| 2. Vídeo importado          | Asset persistido selecionado por ID via API de produção, reutilizando o arquivo enviado; `scripts/multiorigin-smoke.mjs`                                                                               |
| 3. Upload local             | Envio binário pelo proxy autenticado do dashboard, validação FFprobe e SHA-256; segundo envio retorna o mesmo asset                                                                                    |
| 4. Descoberta automática    | Busca online Commons retornou candidatos; consulta temática no servidor gerou um corte elegível; `scripts/automation-smoke.mjs`                                                                        |
| 5. Cadastro e monitoramento | Cadastro de fonte criou Automation vinculada; pausa, retomada, execução BullMQ e histórico foram verificados. Twitch registrou falta de credenciais                                                    |
| 6. Duplicidade              | Upload idêntico e produção idêntica reutilizados; configuração diferente e reprocessamento explícito geraram IDs distintos; link repetido antes/depois do download retornou a mesma produção           |
| 7. Whisper real             | Fixture sintética autorizada de 10,77 s produziu três segmentos; mídia Commons também produziu fala reconhecida                                                                                        |
| 8. Seleção                  | Provedor disponível/configurado: **mock**, identificado na API e biblioteca. OpenAI/Ollama preservados; Gemini testado com transporte falso. Não houve inferência semântica real nesta validação       |
| 9. FFmpeg real              | MP4 H.264/AAC 720×1280, SRT e legendas inseridas; inspeção FFprobe e frame visual. Áudio sem vídeo também foi renderizado com fundo gerado nos testes Python                                           |
| 10. Download MP4/SRT        | Ambos recuperados pela API e pelo proxy autenticado do dashboard; arquivos em `artifacts/`                                                                                                             |
| 11. Continuação automática  | Download → transcrição → seleção → corte, sem chamadas manuais entre etapas; testado por link e upload                                                                                                 |
| 12. Ausência de trechos     | Arquivo Commons de natureza com 21 s retornou zero segmentos reais de Whisper; etapa terminou com explicação de ausência de fala e sem seleção/renderização pendente. Há também teste unitário do caso |
| 13. URL sem autorização     | Produção de asset sem direitos/acesso foi recusada; testes Python cobrem hosts privados, hosts não aprovados, redirecionamento e integridade SHA-1                                                     |
| 14. Recuperação             | Nova tarefa de teste persistida como PROCESSING, sem mensagem Redis, foi recuperada após reinício da API e chegou ao MP4. Segundo reinício preservou os IDs concluídos; `scripts/recovery-smoke.mjs`   |

O teste de recuperação simula a perda da mensagem e o estado interrompido no banco;
não mata arbitrariamente uma inferência ou um FFmpeg do usuário. O corte recuperado
também passa pela nova validação de qualidade no worker antes de ficar disponível.

## Verificações adicionais

- API: **31 testes aprovados**.
- Dashboard: **6 testes aprovados**, incluindo renderização React do formulário.
- Python: **13 aprovados e 1 ignorado**. O teste ignorado exige criação de symlink,
  indisponível sem privilégio neste Windows; não foi tratado como aprovado.
- ESLint, Ruff, builds locais de API/dashboard, geração Prisma e builds Docker passaram.
- A migração `202610290001_multiorigem` foi aplicada sem remover estruturas existentes.
- O exemplo remoto de natureza era grande (aproximadamente 465 MB), mas ficou dentro
  do limite de 512 MB. O fluxo principal por link usou outro arquivo de apenas 4,8 MB.
- YouTube oEmbed consultado online: título/autor retornados, arquivo marcado inacessível
  e direitos não confirmados, sem extração do vídeo.
- Vimeo oEmbed consultado online: título e duração de 738 s retornados; direitos e
  acesso ao arquivo permaneceram bloqueados. Um exemplo antigo retornou 404; esse
  cenário motivou mensagem específica para vídeo removido/indisponível.
- RSS 2.0, metadados de podcast e renderização de áudio foram testados com fixture
  e FFmpeg real. Não havia feed externo/hosts RSS configurados para teste online.
- Busca temática elegível foi executada pelo worker BullMQ e gerou um MP4. Execuções
  repetidas reutilizaram a produção. Automações de teste foram pausadas ao terminar.

Os testes de dashboard completos usam seu proxy HTTP e testes React; não houve
automação de cliques em navegador. A renderização e as legendas do MP4 sintético
foram inspecionadas em imagem extraída com FFmpeg.

## Problemas anteriores

1. **Arquivo da produção:** deixou de ser uma exigência principal. Links, assets e
   upload têm entrada própria; caminho e corte manual permanecem na área técnica.
2. **Continuação pendente:** as sete transcrições históricas com a mensagem genérica
   continham zero segmentos. A exceção de validação era escondida. Agora esse caso
   encerra com causa legível; falhas de continuação conservam seu erro, têm tentativas
   limitadas e recuperação no startup.
3. **Duplicidade:** identidade de plataforma, URL normalizada, SHA-256 e configurações
   participam do reaproveitamento. Criação de tarefas usa chaves únicas/upsert. Preferências
   diferentes podem gerar novos cortes, e reprocessamento explícito evita o bloqueio
   por intervalos anteriormente renderizados.
4. Corrigida resolução Commons com sublinhados versus espaços nos títulos `File:`.

## Limitações externas e operacionais

- Busca e duração completas do YouTube Data API dependem de chave oficial; não foram
  testadas com credenciais reais. O caminho oEmbed foi testado online.
- Twitch Helix depende de Client ID/token oficiais. Foi validado o bloqueio explicativo,
  não a consulta autenticada real.
- Vimeo oferece metadados por link. Busca global e importação por arquivo da API Vimeo
  ainda não foram implementadas. Original autorizado pode ser enviado por upload.
- RSS/manifests externos precisam de configuração pelo operador. Manifestos têm testes
  de contrato com transporte falso; RSS externo não foi configurado nesta execução.
- Gemini, OpenAI e Ollama não realizaram inferência real nesta entrega. O ambiente ficou
  em mock; Gemini não é anunciado como gratuitamente disponível em qualquer projeto.
- Agendamentos foram testados com execução imediata/manual pela mesma fila e com
  reinício. Não se esperou o intervalo mínimo completo de uma hora nem se simulou
  indisponibilidade de cada API por vários dias.
- Cancelamento é cooperativo entre etapas; não termina o processo de inferência ativo.
- Retenção de armazenamento é manual. O sistema impõe limites e reserva mínima de
  espaço; não apaga mídia, registros ou volumes automaticamente.
- Não houve benchmark no i5-2310/TrueNAS nem teste com Neon real.

## Reproduzir

Com Docker ativo, `.env` local configurado e provedor mock:

```powershell
docker compose up -d --build
node scripts/multiorigin-smoke.mjs
node scripts/link-smoke.mjs
node scripts/automation-smoke.mjs
node scripts/recovery-smoke.mjs
```

O primeiro script usa a fixture sintética local já existente; veja alternativas em
[Criação multiorigem](multiorigem.md). O script por link acessa apenas a mídia CC0
indicada em seu código. O teste de erro Twitch pressupõe credenciais Twitch ausentes.
O teste de recuperação reinicia somente a API AutoClips. Relatórios completos e mídia
de teste ficam em `artifacts/`, ignorados pelo Git. Os scripts criam registros de teste
e os preservam para inspeção na Biblioteca.
