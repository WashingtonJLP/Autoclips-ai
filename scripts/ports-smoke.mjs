// Validação de portas, autenticação e isolamento. Não cria nem remove dados.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const names = [
  'autoclips-ai-web-1',
  'autoclips-ai-api-1',
  'autoclips-ai-worker-1',
  'autoclips-ai-postgres-1',
  'autoclips-ai-redis-1',
];
const containers = JSON.parse(
  execFileSync('docker', ['inspect', ...names], { encoding: 'utf8' }),
);
const byName = (name) => containers.find((c) => c.Name === `/${name}`);
function binding(name, internal, published) {
  const container = byName(name),
    entries = Object.entries(container.HostConfig.PortBindings ?? {});
  assert.equal(entries.length, 1, `${name}: deve publicar somente uma porta`);
  assert.deepEqual(container.HostConfig.PortBindings[`${internal}/tcp`], [
    { HostIp: '127.0.0.1', HostPort: String(published) },
  ]);
}
binding(names[0], 3000, 3100);
binding(names[1], 3001, 3101);
for (const name of names.slice(2))
  assert.equal(
    Object.keys(byName(name).HostConfig.PortBindings ?? {}).length,
    0,
    `${name}: não deve publicar portas no host`,
  );
assert.ok(byName(names[0]).Config.Env.includes('API_URL=http://api:3001'));
assert.ok(byName(names[1]).Config.Env.includes('PORT=3001'));
const base = process.env.DASHBOARD_URL ?? 'http://localhost:3100';
const apiBase = process.env.SMOKE_API_URL ?? 'http://localhost:3101';
const headers = {
  Authorization: `Basic ${Buffer.from(`${process.env.DASHBOARD_USER}:${process.env.DASHBOARD_PASSWORD}`).toString('base64')}`,
};
const routes = [
  '/',
  '/criar',
  '/biblioteca',
  '/publicacoes',
  '/fontes',
  '/configuracoes',
];
for (const path of routes) {
  assert.equal((await fetch(`${base}${path}`)).status, 401);
  const response = await fetch(`${base}${path}`, { headers });
  assert.equal(response.status, 200, path);
  assert.ok(
    (await response.text()).includes('Navegação principal'),
    `Navegação ausente em ${path}`,
  );
}
assert.equal(
  (
    await fetch(base, {
      headers: { Authorization: 'Basic aW52YWxpZG86aW52YWxpZG8=' },
    })
  ).status,
  401,
);
assert.equal((await fetch(`${apiBase}/health`)).status, 200);
assert.equal((await fetch(`${apiBase}/jobs`)).status, 401);
assert.equal(
  (
    await fetch(`${apiBase}/jobs`, {
      headers: { Authorization: `Bearer ${process.env.INTERNAL_API_TOKEN}` },
    })
  ).status,
  200,
);
assert.equal(
  (await fetch(`${base}/api/backend/jobs`, { headers })).status,
  200,
);
// O POST com origem correta alcança a validação da API (400 para body vazio).
for (const [origin, expected] of [
  [new URL(base).origin, 400],
  ['http://localhost:3000', 403],
  ['http://localhost:3001', 403],
]) {
  const response = await fetch(`${base}/api/backend/jobs`, {
    method: 'POST',
    headers: { ...headers, Origin: origin, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, expected, `Origem ${origin}`);
}
const baselinePath =
  process.env.PORTS_BASELINE ?? 'artifacts/ports-before.json';
const preserved = [];
if (existsSync(baselinePath)) {
  const baseline = JSON.parse(
    readFileSync(baselinePath, 'utf8').replace(/^\uFEFF/, ''),
  );
  for (const previous of baseline.filter((c) =>
    /matchpredict|autoclips-ai-(worker|postgres|redis)-1/.test(c.Name),
  )) {
    const current = JSON.parse(
      execFileSync('docker', ['inspect', previous.Name.slice(1)], {
        encoding: 'utf8',
      }),
    )[0];
    assert.equal(
      current.Id,
      previous.Id,
      `${previous.Name}: container não deve ser recriado`,
    );
    assert.equal(
      current.State.StartedAt,
      previous.StartedAt,
      `${previous.Name}: não deve reiniciar`,
    );
    assert.equal(current.Image, previous.Image);
    assert.deepEqual(current.HostConfig.PortBindings, previous.Ports);
    assert.deepEqual(
      current.Mounts.map(({ Type, Name, Source, Destination }) => ({
        Type,
        Name: Name ?? null,
        Source,
        Destination,
      })).sort((a, b) => a.Destination.localeCompare(b.Destination)),
      previous.Mounts.map((m) => ({ ...m, Name: m.Name ?? null })).sort(
        (a, b) => a.Destination.localeCompare(b.Destination),
      ),
    );
    preserved.push(previous.Name.slice(1));
  }
}
const report = {
  date: new Date().toISOString(),
  frontend: base,
  backend: apiBase,
  routes,
  authenticated: true,
  originValidation: true,
  internalServicesUnpublished: true,
  unchangedContainers: preserved,
};
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/ports-smoke.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
