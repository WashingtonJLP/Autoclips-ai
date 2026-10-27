# Ambiente verificado

Windows x64; diretório inicial `C:\Users\User\Desktop\AutoClipsAi`.
Repositório reutilizável clonado em `Autoclips-ai`, origin oficial, main limpa.
Git 2.49.0, Node 22.17.1, npm 11.5.1, Docker 29.7.2, Compose 5.4.0 e VS Code
1.143.1 já disponíveis. Python e FFmpeg ausentes na primeira inspeção.
Docker Engine inicialmente parado; solicitado início pelo Docker Desktop CLI.
Python 3.12 solicitado via winget com instalador oficial em escopo de usuário.
Nenhuma política de segurança ou instalação privilegiada foi alterada.

Instalados e validados: Python 3.12.10 e FFmpeg 9.0.2 (winget, escopo usuário).
Docker Engine 29.7.2 iniciado com sucesso. Dependências Python isoladas em
`apps/worker-python/.venv`, com uv 0.13.6 e `uv.lock`; npm usa `package-lock.json`.
ESLint 10 substituiu a versão 9 fora de suporte. Prisma 7.10.1 substituiu a versão
6 após auditoria identificar uma dependência vulnerável.
