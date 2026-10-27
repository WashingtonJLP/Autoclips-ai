import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppController } from '../src/module';
test('health informa simulação de publicação', () => {
  assert.deepEqual(new AppController().health(), {
    status: 'ok',
    service: 'api',
    publishing: 'simulation',
  });
});
