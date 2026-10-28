# Dashboard administrativo

O frontend Next.js usa seis páginas no mesmo layout, com navegação lateral no
desktop e menu recolhível no mobile. A autenticação Basic existente protege todas
as páginas e o proxy. O backend, worker, filas, banco e infraestrutura não mudaram.

| Página        | Endereço         | Ações                                                           |
| ------------- | ---------------- | --------------------------------------------------------------- |
| Visão geral   | `/`              | Indicadores recentes, serviços, atividades e últimos cortes     |
| Criar cortes  | `/criar`         | Fonte, mídia, processamento automático/manual e acompanhamento  |
| Biblioteca    | `/biblioteca`    | Galeria, preview, MP4/SRT, transcrições, seleção e renderização |
| Publicações   | `/publicacoes`   | OAuth, renovação, simulação, agendamento e histórico            |
| Fontes        | `/fontes`        | Descoberta, revisão de direitos, importação e cadastro          |
| Configurações | `/configuracoes` | Provedor, orçamento, limites e diagnóstico manual               |

## Fluxo do operador

1. Em **Fontes**, cadastre uma origem com licença/evidência e confirmação comercial,
   ou use **Descobrir vídeos**, revise a licença e clique em **Importar e criar cortes**.
   A importação abre o acompanhamento em Criar cortes.
2. Para arquivo local, abra **Criar cortes**, selecione a fonte e um caminho de
   mídia já utilizado ou informe o caminho relativo na pasta `media`.
3. Mantenha **Concluir automaticamente** para o fluxo completo. Desmarque para
   revisar a transcrição antes de selecionar. Corte manual e legendas revisadas
   continuam disponíveis; o JSON do corte manual fica em opção avançada.
4. Clique em **Atualizar** para consultar etapas. **Ver resultado** abre a prévia
   do corte na Biblioteca. Transcrições e seleções ficam na aba correspondente.
5. Abra a prévia para assistir, baixar MP4/SRT e seguir para **Agendar simulação**.
   O corte já estará selecionado em Publicações.
6. Consulte o histórico ou conecte/reconecte/renove contas na página Publicações.
   OAuth retorna para essa página. Nenhuma ação habilita postagem real.

## Carregamento, desempenho e acessibilidade

Consultas ocorrem na abertura da página e por ação explícita. Não há `setInterval`,
cron ou atualização por foco de janela. Links desativam prefetch para que consultas
de páginas não visitadas não acordem o banco. O diagnóstico `/ready` só é chamado
pelo botão em Configurações; `/health` verifica apenas o processo da API.

Paginação em memória: oito cartões de vídeo, quatro transcrições/seleções, seis
tarefas/fontes e oito agendamentos por página. Os filtros antecedem a paginação.
A API existente retorna no máximo 100 registros recentes: os indicadores e filtros
se referem a esse conjunto, não ao histórico total. Consultar registros mais antigos
exigirá paginação na API, fora do escopo desta alteração de frontend.

Miniaturas são capturadas no navegador somente ao entrar na área visível, em fila
sequencial, com cache de sessão limitado. A galeria não monta players: o player
9:16 é importado dinamicamente ao abrir uma prévia. Fechar a prévia desmonta o
vídeo. Miniatura indisponível mantém uma capa de fallback e o botão de prévia.

Há link para pular ao conteúdo, foco visível, rótulos de formulários, indicação de
página atual, feedback `alert`/`status`, suporte a movimento reduzido e navegação
por teclado. No mobile, o menu fechado fica inerte; aberto, mantém o foco na
navegação e aceita Escape. A prévia usa diálogo nativo e devolve o foco ao fechar.

IDs, payloads e respostas brutas ficam em detalhes avançados. Métricas de consumo
dos candidatos ficam recolhidas; a configuração detalhada permanece em Configurações.

## Limites da API preservados

- Não há upload, listagem de diretório, edição/exclusão de fontes ou gravação de
  configurações por endpoint. A interface oferece seleção de caminhos conhecidos,
  cadastro e consulta de fontes e configuração somente para leitura. Não exibe
  botões de upload, edição ou toggles sem efeito real.
- A conta usada continua sendo a do operador único autenticado. Nenhum segredo
  é enviado ao cliente e não se criaram usuários ou permissões adicionais.
- A simulação imediata existente não cria histórico persistente. Agendamentos
  usam o registro persistente existente; duplicidades são decididas pela API.
- IA paga, aplicativos OAuth e publicação real continuam sujeitos às credenciais,
  autorizações e bloqueios existentes. A interface não muda essas decisões.

## Validação

```powershell
npm run lint
npm test
npm run build
docker compose build web
docker compose up -d --no-deps --wait web
```

Os testes de componentes verificam paginação, rastreamento das relações de tarefas,
ausência de players na galeria fechada, escape de conteúdo e contratos dos formulários.
A validação de cliques e layout no navegador deve ser registrada separadamente;
testes HTTP/SSR não equivalem a essa inspeção.
