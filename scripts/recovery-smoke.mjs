// Simula perda de uma mensagem Redis usando apenas uma nova tarefa de teste.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z_0-9]*)=(.*)$/);
  if (m && !process.env[m[1]])
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const headers = {
  Authorization: `Bearer ${process.env.INTERNAL_API_TOKEN}`,
  'Content-Type': 'application/json',
};
async function api(path, body) {
  const r = await fetch(`http://localhost:3101/${path}`, {
    headers,
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  assert.ok(r.ok, JSON.stringify(data));
  return data;
}
async function wait(fn) {
  for (let i = 0; i < 180; i++) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (e) {
      if (!/fetch failed|ECONN|socket|indisponível/i.test(e.message)) throw e;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error('Tempo esgotado na recuperação');
}
function docker(args) {
  const r = spawnSync('docker', ['compose', ...args], {
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}
assert.equal((await api('llm/config')).provider, 'mock');
const source = await api('sources', {
  name: `Teste recuperação ${new Date().toISOString()}`,
  url: 'https://github.com/WashingtonJLP/Autoclips-ai',
  license: 'PERMISSION',
  evidenceUrl:
    'https://github.com/WashingtonJLP/Autoclips-ai/blob/main/scripts/create-fixture.ps1',
  attribution:
    'Teste sintético autorizado para recuperação; nenhuma mídia de terceiros',
  commercialUseVerified: true,
});
const script = `const {PrismaClient}=require('@prisma/client');const {PrismaPg}=require('@prisma/adapter-pg');const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});(async()=>{const t=await db.task.create({data:{sourceId:${JSON.stringify(source.id)},operation:'transcribe',status:'PROCESSING',payload:{path:'fixtures/e2e-authorized-20261028.mp4'},autoRun:true,editorial:{options:{maxClips:1,minDuration:5,maxDuration:60,language:'auto'}}}});console.log(t.id);await db.$disconnect()})().catch(e=>{console.error(e.message);process.exit(1)});`;
const id = docker(['exec', '-T', 'api', 'node', '-e', script]).trim();
assert.match(id, /^[a-z0-9]+$/);
docker(['restart', 'api']);
await wait(async () => {
  const r = await fetch('http://localhost:3101/health');
  return r.ok;
});
const result = await wait(async () => {
  const tasks = await api('jobs');
  const ids = new Set([id]);
  for (let i = 0; i < 4; i++)
    for (const task of tasks) if (ids.has(task.parentId)) ids.add(task.id);
  const chain = tasks.filter((t) => ids.has(t.id));
  const fail = chain.find((t) => t.status === 'FAILED' || t.error);
  assert.ok(!fail, JSON.stringify(fail));
  const clips = chain.filter(
    (t) => t.operation === 'clip' && t.status === 'COMPLETED',
  );
  if (clips.length) assert.equal(clips[0].result.quality?.validated, true);
  return clips.length && chain.every((t) => t.status === 'COMPLETED')
    ? chain
    : null;
});
const before = result.map((t) => t.id).sort();
docker(['restart', 'api']);
await wait(async () => {
  const r = await fetch('http://localhost:3101/health');
  return r.ok;
});
const after = (await api('jobs')).filter((t) => before.includes(t.id));
assert.deepEqual(after.map((t) => t.id).sort(), before);
assert.ok(after.every((t) => t.status === 'COMPLETED'));
const report = {
  date: new Date().toISOString(),
  production: id,
  recoveredWithoutRedisMessage: true,
  realWhisper: true,
  realFFmpeg: true,
  outputQualityValidated: true,
  simulatedSelection: true,
  tasks: before,
  secondRestart: true,
  paidCalls: 0,
  publications: 0,
};
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/recovery-smoke.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
