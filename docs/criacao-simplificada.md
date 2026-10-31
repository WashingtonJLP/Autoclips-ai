# Criação simplificada e Biblioteca — 30/10/2026

## Uso pela interface

1. Abra `http://localhost:3100/criar` e escolha **Colar link**, **Enviar arquivo** ou
   **Escolher vídeo**. Upload aceita MP4/WebM/MOV; vídeos importados podem ser pesquisados.
2. Para links, clique **Analisar vídeo**: confira plataforma, título, canal, duração e
   miniatura quando disponíveis. A análise separa metadados de acesso ao original;
   arquivos já importados são reconhecidos antes de consultar a plataforma novamente.
   Depois clique **Gerar cortes**. Permissões existentes e licenças de catálogo são reutilizadas.
   Se faltar autorização, confirme **Tenho autorização — gerar cortes** somente se possuir
   direitos para o uso pretendido. Essa declaração se aplica apenas à mídia selecionada.
3. Acompanhe as etapas automaticamente e clique **Ver resultado**. Na **Biblioteca**,
   **Produções** agrupa etapas e cortes; **Cortes** oferece prévia, download e exclusão.

Não há cadastro obrigatório de fonte, campo de caminho interno nem formulário técnico
de licença na criação. **Fontes** é opcional para descoberta/monitoramento e pode ser
cadastrada sem afirmar direitos comerciais. Permissões específicas ficam registradas
internamente com origem, data e método, fora da lista de fontes monitoradas.
Uma declaração do operador não é verificação jurídica automática nem autorização para
extrair originais por meios não permitidos.

Quando somente os metadados estiverem disponíveis, **Gerar cortes** fica bloqueado e
o cartão oferece **Enviar o original autorizado**, com uma explicação curta. Não se
pedem cadastro de fonte, caminhos ou chaves de API na experiência principal. Twitch
sem conexão configurada ainda é identificada; seus metadados completos não são inventados.
YouTube sem chave oficial pode fornecer título, canal e miniatura via oEmbed, mas não
duração. Quando o backend obtém a duração na transcrição, ela fica salva para reutilização.

Para YouTube há também **Usar um original autorizado sem novo upload**: vincule a URL
HTTPS de um arquivo fornecido pelo titular ou selecione um arquivo já importado e confirme
a autorização específica. Depois, o mesmo link YouTube reutiliza esse original.
Veja a [investigação oficial e o teste de obtenção autorizada](youtube-obtencao-autorizada.md).

O formulário informa e seleciona heurística local para indisponibilidade da IA. É possível
alterar isso em **Critérios da seleção e fallback**. Resultados heurísticos e mock são
identificados; não representam análise semântica por LLM. O `.env` não é modificado.
Em **Mais opções → Gerar uma nova versão**, o reprocessamento é intencional; pedidos
equivalentes comuns reutilizam a produção existente.

## Plataformas e obtenção do original

| Entrada                        | Processamento disponível                         | Limitação                                                                                                     |
| ------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| MP4/WebM/MOV enviado           | Sim, após permissão da própria mídia             | Até 512 MB e duas horas; armazenamento e FFprobe validados                                                    |
| Vídeo já importado             | Sim, por ID, sem caminhos                        | Reutiliza autorização válida e arquivo existente                                                              |
| Arquivo HTTPS direto           | Sim, com direitos registrados                    | Apenas rede pública, portas padrão, sem credenciais/redirects; validação DNS com IP fixado, tamanho e FFprobe |
| Commons / catálogo configurado | Sim, para licenças aceitas e arquivo disponível  | Metadados/evidência registrados; não elimina direitos de terceiros                                            |
| YouTube                        | Metadados; original autorizado pode ser enviado  | oEmbed funcionou; busca oficial depende de chave. Não existe extrator/download de vídeo                       |
| Twitch                         | Metadados/monitoramento com credenciais oficiais | Client ID/token ausentes no ambiente; não há extrator de VOD                                                  |
| Vimeo                          | Metadados por oEmbed; original pode ser enviado  | Download autenticado e busca global não implementados                                                         |

Arquivos diretos autorizados não exigem cadastro prévio de cada domínio. Essa extensão
usa o downloader existente e mantém proteção contra IPs privados/locais, DNS rebinding,
redirecionamentos, HTTP, portas alternativas e arquivos inválidos. Não são enviados
cookies nem tokens de plataformas. Outros conectores continuam com suas políticas próprias.

## Exclusão e separação de testes

- **Excluir corte** remove somente aquele registro da Biblioteca; preserva cortes irmãos.
- **Excluir produção** remove a produção e suas etapas/cortes exclusivos. Passos
  compartilhados com outras produções sobrevivem. Etapas ativas são canceladas;
  uma resposta tardia do worker não pode continuar a produção excluída.
- A interface pede confirmação e oferece **Desfazer exclusão**. O servidor valida o
  escopo da exclusão; restauração não reinicia tarefas canceladas nem reagenda publicações.
- Agendamentos pendentes dos itens removidos ficam cancelados. Seus downloads passam
  a retornar 404. A exclusão é lógica: originais e artefatos permanecem no disco para
  recuperação, sem liberação automática de espaço ou remoção de arquivos compartilhados.
- Mídias sintéticas são marcadas em **Mais opções** no upload e propagadas para os
  descendentes. O histórico foi classificado por fixtures e evidências sintéticas;
  não se usa o provedor mock como critério para classificar uma mídia como sintética.
  A Biblioteca e o seletor de importados separam **Testes sintéticos** das mídias normais.
- Indicadores da Visão geral usam o mesmo agrupamento da Biblioteca, excluindo testes.
  Estados da produção consideram suas etapas; transcrição concluída não equivale a corte pronto.

## Verificação executada

- **66 testes API**, **9 testes React**, ESLint, builds completos API/Next.js e Docker
  aprovados. Python: **14 aprovados, 1 ignorado** por privilégio de symlink no Windows;
  Ruff aprovado. Nenhum teste foi desabilitado para aprovar a mudança.
- `scripts/creation-library-smoke.mjs`: upload binário de mídia própria sintética nova,
  confirmação uma vez, produção por asset, Whisper real CPU/INT8, seleção mock, FFmpeg real,
  legendas, download e decodificação integral de MP4. Também testou link direto HTTPS
  de vídeo CC0, YouTube online, Vimeo online e bloqueio Twitch por falta de credenciais.
- A análise online YouTube retornou título/canal/miniatura e `upload_required`, com
  explicação sem nomes de variáveis de configuração. Twitch sem credenciais retornou
  análise identificada com a alternativa de upload. Analisar novamente o arquivo HTTPS
  já importado retornou o mesmo asset e `imported`; teste unitário também impede qualquer
  consulta de rede nesse caminho. Não foi implementado download YouTube/Twitch.
- Oito requisições concorrentes equivalentes retornaram a mesma produção, sem novas
  tarefas/arquivos. Nova versão explícita gerou IDs distintos. Exclusão individual,
  produção, restauração e preservação da outra produção foram aprovadas pela API.
- `scripts/creation-library-integration.cjs`, em PostgreSQL local real: preservação de
  etapas compartilhadas e cortes irmãos, cancelamento de agendamento e produção ativa,
  bloqueio de continuação tardia e validação do token de desfazer. Apenas dados sintéticos
  específicos desse roteiro foram alterados; ao terminar ficaram excluídos logicamente.
- Seis páginas: HTTP 401 sem login e 200 com login. Formulário sem sourceId/path/licença;
  abas Produções/Cortes e filtro de testes presentes. MP4 pelo proxy autenticado retornou
  **206, bytes 0–1023**, com 1.024 bytes, permitindo leitura parcial pelo player.
- Relatórios locais ignorados: `artifacts/creation-library-smoke.json`,
  `creation-library-integration.log`, `creation-web-http.json` e logs de build/lint/testes.
- Mock foi temporário e isolado à configuração de teste da API. Ao terminar, Gemini foi
  restaurado; também foi testado o fluxo com heurística explícita e a política do formulário.
  Não foram feitas chamadas pagas ou publicações públicas, nem alterado o agendamento
  de diagnóstico Gemini já existente.

Os volumes, histórico, PostgreSQL, Redis e portas 3100/3101 foram preservados. A migração
somente acrescenta campos/índice e marca conteúdo sintético histórico. MatchPredict,
Neon e infraestrutura de produção não foram modificados.

**Pendência visual:** o host de automação de navegador estava indisponível e a revisão
de permissões rejeitou o controle do Opera GX. Não foram validados cliques, navegação
visual ou reprodução audiovisual dentro do navegador. HTTP, Range e decodificação do
arquivo não foram apresentados como substitutos desses testes. Seleção editorial Gemini
real também permanece pendente por quota; a heurística não comprova IA semântica.

## Repetir os testes

Com os serviços locais saudáveis e **mock temporariamente selecionado pelo operador**:

```powershell
$env:CREATION_FIXTURE_PATH='media/fixtures/seu-teste-sintetico-novo.mp4'
node scripts/creation-library-smoke.mjs
docker compose cp scripts/creation-library-integration.cjs api:/app/scripts/creation-library-integration.cjs
docker compose exec -T api node scripts/creation-library-integration.cjs
```

O smoke recusa outro provedor e não modifica configuração, quota ou faturamento.
Use uma fixture própria/autorizada; não apague o histórico para repetir os testes.
