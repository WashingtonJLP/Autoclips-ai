# Diagnóstico e testes de integração

| Sintoma                  | Ação                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| Docker não conecta       | Inicie Docker Desktop, aguarde o engine Linux, execute `docker compose ps`               |
| Porta não responde       | Confira 3100/3101 e `node scripts/ports-smoke.mjs`; não pare outros projetos             |
| 401                      | Confira login/token local; preserve autenticação                                         |
| YouTube só tem metadados | Confira a etapa de download; metadados/formatos não comprovam transferência              |
| YouTube 403/429          | Restrição/quota; não importe cookies nem contorne controles                              |
| Sem formato compatível   | Apenas HTTPS sem DRM; manifesto/restrição pode impedir importação                        |
| Download falha           | DNS público, HTTPS/TLS, assinatura válida, tamanho e prazo de 600 s                      |
| Worker ocupado           | Aguarde a fila de concorrência 1                                                         |
| Whisper falha            | Modelo tiny/base, memória, download inicial e volume de modelos                          |
| Sem fala                 | Revise áudio; não há seleção/renderização fictícia                                       |
| IA indisponível          | Confira modelo, contrato, orçamento/quota; fallback só quando permitido                  |
| Progresso parou          | `docker compose logs --tail 100 api worker`; veja erro da etapa e recuperação ao iniciar |
| Biblioteca vazia         | Confira filtros de teste e exclusão lógica; não apague banco                             |
| Neon não suspende        | Pause monitoramentos e clientes consultando `/ready` continuamente                       |

Execute [unidade/lint/build](api.md). Para integração, use mídia local autorizada com fala e serviços em execução. O script abaixo valida upload duplicado, produção automática, Whisper, MP4/SRT, Biblioteca e reutilização. Exige mock para não chamar APIs externas.

```powershell
node --env-file=.env scripts/import-pipeline-smoke.mjs media/fixtures/final-authorized-20261030.mp4
```

Sem essa fixture histórica, gere uma nova sem sobrescrever arquivos:

```powershell
powershell -NoProfile -File scripts/create-fixture.ps1 -Name teste-autorizado-novo
node --env-file=.env scripts/import-pipeline-smoke.mjs media/fixtures/teste-autorizado-novo.mp4
```

System.Speech e FFmpeg geram fala/imagem locais, sem baixar conteúdo de terceiros. Use override Compose temporário com `LLM_PROVIDER=mock`, `LLM_MODEL=mock-v1`, `LLM_ALLOW_EXTERNAL=false`, `LLM_ALLOW_PAID=false`. Não altere credenciais/quotas; restaure o Compose normal após o teste.

Para validar download YouTube real, passe a URL como segundo argumento ao script e defina `YOUTUBE_TEST_DOWNLOAD_AUTHORIZED=true` somente com permissão efetiva para download/processamento. Sem esse sinal, o script verifica reconhecimento e recusa sem autorização, sem baixar YouTube. [Evidências obtidas](validation.md).

Logs e mídia em `artifacts/` e `media/` são ignorados pelo Git. Não publique tokens, `.env`, URLs assinadas ou arquivos de terceiros como evidência.

`scripts/ports-smoke.mjs` só compara identidade/uptime de containers com um baseline quando `PORTS_BASELINE` é informado explicitamente. Um snapshot anterior a uma reconstrução autorizada não é referência válida para exigir o mesmo container worker. O teste padrão sempre verifica portas, autenticação, páginas e proteção de origem.
