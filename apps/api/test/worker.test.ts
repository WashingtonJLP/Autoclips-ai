import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceUnavailableException } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { Pipeline } from '../src/pipeline';

test('worker distingue rejeição permanente de indisponibilidade transitória', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('{}', { status: 422 });
    await assert.rejects(
      () => Pipeline.prototype.callWorker('/transcribe', {}),
      UnrecoverableError,
    );
    globalThis.fetch = async () => new Response('{}', { status: 503 });
    await assert.rejects(
      () => Pipeline.prototype.callWorker('/transcribe', {}),
      ServiceUnavailableException,
    );
    globalThis.fetch = async () => new Response('{}', { status: 429 });
    await assert.rejects(
      () => Pipeline.prototype.callWorker('/transcribe', {}),
      ServiceUnavailableException,
    );
  } finally {
    globalThis.fetch = original;
  }
});
