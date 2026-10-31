# API e desenvolvimento

Base: `http://localhost:3101`. Rotas internas exigem `Authorization: Bearer <INTERNAL_API_TOKEN>`, exceto healthcheck. O dashboard usa autenticação básica e proxy que guarda tokens no servidor. Não versione segredos.

| Método e rota                                      | Uso                                                                        |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| `GET /health`                                      | Vida do processo sem consulta ao banco                                     |
| `GET /ready`                                       | Dependências; consulta banco/worker/fila                                   |
| `POST /media/inspect`                              | `{ "url": "https://youtu.be/ID" }`; candidato ou arquivo importado         |
| `GET /media`                                       | Mídias registradas                                                         |
| `POST /media/upload?extension=mp4&name=video.mp4`  | Binário `application/octet-stream`; asset validado                         |
| `POST /media/:id/original`                         | Alternativa com `mediaUrl` ou `importedAssetId` e `confirmPermission=true` |
| `POST /productions`                                | Inicia/reutiliza produção automática                                       |
| `GET /jobs`, `GET /jobs/:id`                       | Etapas e estado                                                            |
| `POST /jobs/:id/cancel`                            | Cancela produção/descendentes                                              |
| `POST /jobs/:id/continue`                          | Recuperação excepcional de continuação                                     |
| `GET /jobs/:id/artifacts/video`                    | MP4; `subtitles` entrega SRT, `transcript` entrega JSON                    |
| `GET /library`                                     | Produções e cortes                                                         |
| `GET /llm/config`                                  | Configuração pública/provedor                                              |
| `POST /discovery/multisearch`                      | Busca opcional nos conectores ativos                                       |
| `POST /discovery/search`, `POST /discovery/import` | Manifesto opcional                                                         |
| `GET /automations`, `POST /automations`            | Monitoramentos                                                             |

Outras rotas de fontes, seleção, Biblioteca e publicações estão nos controllers em `apps/api/src`. Contratos Zod são estritos. Criações NestJS normalmente retornam 201.

Depois de inspecionar a URL, envie o ID retornado:

```json
{
  "assetId": "ID_RETORNADO",
  "autoRun": true,
  "confirmPermission": true,
  "confirmDownloadPermission": true,
  "options": {
    "maxClips": 3,
    "minDuration": 5,
    "maxDuration": 60,
    "language": "auto",
    "fallback": "heuristic"
  }
}
```

Confirmações devem corresponder a permissão real. `confirmDownloadPermission` aplica-se ao caminho direto YouTube. Confirmação ausente retorna `AUTHORIZATION_REQUIRED` ou `DOWNLOAD_AUTHORIZATION_REQUIRED`; ausência de método/arquivo retorna `ORIGINAL_REQUIRED`.

## Testes e builds

```powershell
npm ci
npm run db:generate
npm test
npm run lint
npm run build
npx prettier --check README.md docs apps/api/src apps/api/test apps/web/app/components/production-form.tsx apps/web/test
```

Python 3.12, da raiz:

```powershell
python -m pip install uv
python -m uv sync --project apps/worker-python --group dev --frozen
.\apps\worker-python\.venv\Scripts\ruff.exe check apps/worker-python
.\apps\worker-python\.venv\Scripts\ruff.exe format --check apps/worker-python
.\apps\worker-python\.venv\Scripts\python.exe -m pytest apps/worker-python/tests -q
```

FFmpeg/FFprobe precisam estar no PATH para renderização real nos testes nativos. Symlink pode ser ignorado no Windows sem permissão; no Linux deve executar. [Testes de integração](troubleshooting.md).
