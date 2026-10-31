# AutoClips AI

Transforme vídeos em cortes automaticamente: **colar URL → obter mídia autorizada → transcrever → selecionar trechos → renderizar → Biblioteca**.

Next.js, NestJS/BullMQ, Redis, PostgreSQL/Prisma e Python/FastAPI integram o faster-whisper em CPU e o FFmpeg. O caminho principal aceita links do YouTube; upload e reutilização de vídeos importados continuam disponíveis. Criar cortes não exige cadastrar uma fonte nem informar caminhos internos.

## Executar no Windows

Com Docker Desktop em modo Linux, Node.js 22 e Git instalados, execute na raiz:

```powershell
node scripts/setup-local.mjs
docker compose up -d --build --wait
docker compose ps
```

Abra o [dashboard](http://localhost:3100) com o usuário e a senha do `.env`. A [API](http://localhost:3101/health) usa token interno. O setup preserva valores existentes. Nunca apague volumes para atualizar.

Em **Criar cortes**, cole o link e clique **Gerar cortes**. Confirme direitos de processamento e permissão de download quando solicitado. As etapas continuam automaticamente. Metadados, miniaturas e formatos identificados não significam importação concluída.

## Estado real

| Recurso                                   | Estado                               | Alcance                                                                                                                                                                                             |
| ----------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| YouTube: URL e metadados                  | Implementado, consulta real validada | watch, youtu.be, Shorts, embed, live gravada e variantes móveis                                                                                                                                     |
| YouTube: obtenção direta                  | Parcial                              | yt-dlp e formatos HTTPS públicos, progressivos ou separados; depende de permissão/acesso. Fluxo real pela interface validado para um vídeo autorizado, incluindo MP4/SRT e reprodução na Biblioteca |
| Upload e reutilização                     | Implementado                         | MP4/WebM/MOV na interface; identidade e SHA-256 evitam repetições                                                                                                                                   |
| Transcrição e renderização                | Implementado                         | faster-whisper CPU/INT8; MP4 vertical 720×1280 e SRT                                                                                                                                                |
| Seleção                                   | Implementado com modos distintos     | Gemini, OpenAI, Ollama, heurística ou mock; mock não é análise semântica                                                                                                                            |
| Twitch Clips                              | Parcial                              | API oficial condicionada a token/escopo/papel; download real não validado nesta entrega                                                                                                             |
| Twitch VOD                                | Parcial                              | Metadados e busca por canal; download de VOD não implementado                                                                                                                                       |
| Vimeo                                     | Parcial                              | Metadados; MP4 quando a API autorizada disponibilizar `download`                                                                                                                                    |
| HTTPS direto                              | Implementado                         | Arquivo autorizado, validação de rede e limites                                                                                                                                                     |
| Dashboard e Biblioteca                    | Implementado                         | Autenticação, progresso, prévia/download, exclusão lógica e restauração                                                                                                                             |
| Publicações                               | Simulação                            | OAuth e agendamento existentes; a fila não publica de verdade                                                                                                                                       |
| Tracking facial e previsão de viralização | Não implementado                     | Enquadramento vertical e notas editoriais não garantem alcance                                                                                                                                      |

Reconhecer uma URL pública ou consultar formatos não exige Creative Commons. Disponibilidade técnica, permissão de download e direitos de reutilização são verificações distintas. Não há promessa de suporte universal ao YouTube.

## Documentação

- [Instalação e configuração](docs/setup.md)
- [Arquitetura](docs/architecture.md)
- [YouTube](docs/youtube.md) e [outros conectores](docs/connectors.md)
- [Pipeline e Biblioteca](docs/pipeline.md)
- [Provedores de IA](docs/ai-providers.md)
- [API e desenvolvimento](docs/api.md)
- [Publicações](docs/publishing.md)
- [Diagnóstico e testes](docs/troubleshooting.md)
- [Evidências da refatoração](docs/validation.md)

A integração de catálogo substituto foi removida; registros e arquivos históricos permanecem disponíveis. Não houve migração destrutiva do banco.
