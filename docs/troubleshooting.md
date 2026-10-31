# Diagnóstico e testes de integração

| Sintoma                      | Ação                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| Docker não conecta           | Inicie Docker Desktop, aguarde o engine Linux, execute `docker compose ps`               |
| Porta não responde           | Confira 3100/3101 e `node scripts/ports-smoke.mjs`; não pare outros projetos             |
| 401                          | Confira login/token local; preserve autenticação                                         |
| YouTube só tem metadados     | Confira a etapa de download; metadados/formatos não comprovam transferência              |
| YouTube 403 ou 429 externo   | Restrição/limite da origem; aguarde, sem importar cookies ou contornar controles         |
| Sem formato compatível       | Apenas HTTPS sem DRM; manifesto/restrição pode impedir importação                        |
| Download falha               | DNS público, HTTPS/TLS, assinatura válida, tamanho e prazo de 600 s                      |
| Worker ocupado (429 interno) | `WORKER_BUSY`: espera adiada sem consumir tentativas, por até 30 minutos                 |
| Whisper falha                | Modelo tiny/base, memória, download inicial e volume de modelos                          |
| Sem fala                     | Revise áudio; não há seleção/renderização fictícia                                       |
| IA indisponível              | Confira modelo, contrato, orçamento/quota; fallback só quando permitido                  |
| Progresso parou              | `docker compose logs --tail 100 api worker`; veja erro da etapa e recuperação ao iniciar |
| Biblioteca vazia             | Confira filtros de teste e exclusão lógica; não apague banco                             |
| Neon não suspende            | Pause monitoramentos e clientes consultando `/ready` continuamente                       |

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

Para validar download YouTube real, passe a URL como segundo argumento ao script e defina `YOUTUBE_TEST_DOWNLOAD_AUTHORIZED=true` somente com permissão efetiva para download/processamento. Esse opt-in é do diagnóstico de desenvolvimento, não uma etapa da interface. Sem ele, o script verifica reconhecimento sem baixar YouTube. [Evidências obtidas](validation.md).

## Erro 429 e recuperação

O registro antigo de `https://www.youtube.com/watch?v=qIFRt8BhWGk` falhou com a mensagem genérica **Worker indisponível (429)**. Os logs preservados mostram respostas 429 internas do FastAPI em `/transcribe` e `/download`, emitidas pela trava de processamento; Redis não estava saturado. Isso não comprova quota do YouTube. A nova sonda real identificou metadados e formatos HTTPS desse vídeo, sem reproduzir 429 externo. Não foi feito download dessa mídia para alegar autorização inexistente.

Agora o FastAPI responde `WORKER_BUSY` e `Retry-After`; BullMQ adia a etapa sem gastar suas três tentativas enquanto a trava estiver ocupada. Após 30 minutos volta ao tratamento limitado de falha. A interface mostra espera e não sucesso. Uma resposta 429 diferente, vinda da origem, interrompe tentativas automáticas, informa limite externo e exige ao menos um minuto antes de **Tentar novamente**. Limites do provedor de IA também continuam sendo respeitados.

Em falha de comunicação/timeout, a etapa mostra a causa e pode ser recuperada sem reenviar o arquivo. Uma produção cancelada mantém resultados e não avança. Jobs que terminam em falha, inclusive por interrupção/stall, atualizam o estado persistido; não ficam indefinidamente como processamento saudável. Consulte [estados e exclusões](pipeline.md).

Logs e mídia em `artifacts/` e `media/` são ignorados pelo Git. Não publique tokens, `.env`, URLs assinadas ou arquivos de terceiros como evidência.

## Teste visual local

Com Google Chrome instalado, serviços saudáveis e o vídeo de teste autorizado `M7lc1UVf-VE` disponível, execute da raiz:

```powershell
npm install --prefix artifacts/playwright-runtime --no-save --package-lock=false playwright
$env:UX_TEST_AUTHORIZED='true'
node --env-file=.env scripts/ux-playwright.cjs
```

O script usa as credenciais locais em memória, cria/reutiliza produções com e sem legendas, testa concorrência entre abas, reprodução, downloads, exclusão/desfazer e responsividade. Não publica vídeos e não altera a segurança do navegador. As exclusões são desfeitas; resultados de teste ficam preservados. O JSON e as capturas ficam em `artifacts/ux-*`. Confira a licença e a disponibilidade desse vídeo antes de repetir; não é teste de suporte universal.

`scripts/ports-smoke.mjs` só compara identidade/uptime de containers com um baseline quando `PORTS_BASELINE` é informado explicitamente. Um snapshot anterior a uma reconstrução autorizada não é referência válida para exigir o mesmo container worker. O teste padrão sempre verifica portas, autenticação, páginas e proteção de origem.
