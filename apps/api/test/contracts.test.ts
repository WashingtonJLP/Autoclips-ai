import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobSchema, parse, sourceSchema } from '../src/contracts';

test('direitos comerciais exigem confirmação explícita e evidência', () => {
  const source = {
    name: 'Teste',
    url: 'https://example.org',
    license: 'CC0',
    evidenceUrl: 'https://example.org/license',
    attribution: 'Autor',
    commercialUseVerified: true,
  };
  assert.equal(parse(sourceSchema, source).license, 'CC0');
  for (const update of [
    { commercialUseVerified: false },
    { evidenceUrl: '' },
    { license: 'CC-BY-NC' },
    { url: 'file:///etc/passwd' },
  ]) {
    assert.throws(() => parse(sourceSchema, { ...source, ...update }));
  }
});
test('cortes rejeitam caminhos externos, intervalos invertidos e longos', () => {
  const job = {
    sourceId: 'source',
    path: 'input/test.mp4',
    operation: 'clip',
    start: 0,
    end: 10,
  };
  assert.equal(parse(jobSchema, job).end, 10);
  for (const update of [
    { path: '../secret' },
    { path: 'C:/secret' },
    { end: 0 },
    { end: 181 },
    { start: undefined },
  ]) {
    assert.throws(() => parse(jobSchema, { ...job, ...update }));
  }
});
