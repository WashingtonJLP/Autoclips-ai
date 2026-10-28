import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(new URL('../.env', import.meta.url));
let content = existsSync(path)
  ? readFileSync(path, 'utf8')
  : readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
const defaults = {
  INTERNAL_API_TOKEN: randomBytes(32).toString('hex'),
  WORKER_API_TOKEN: randomBytes(32).toString('hex'),
  PLATFORM_TOKEN_KEY: randomBytes(32).toString('hex'),
  DASHBOARD_USER: 'admin',
  DASHBOARD_PASSWORD: randomBytes(18).toString('base64url'),
};
for (const [key, value] of Object.entries(defaults)) {
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  const current = content
    .match(pattern)?.[0]
    .slice(key.length + 1)
    .trim();
  if (!current)
    content = pattern.test(content)
      ? content.replace(pattern, `${key}=${value}`)
      : `${content.trimEnd()}\n${key}=${value}\n`;
}
writeFileSync(path, content, { mode: 0o600 });
console.log(
  'Configuração local preservada/completada em .env. Consulte DASHBOARD_USER e DASHBOARD_PASSWORD para entrar. Nenhum serviço externo foi habilitado.',
);
