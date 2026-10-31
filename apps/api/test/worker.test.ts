import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceUnavailableException } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { WorkerBusyError } from '../src/worker-errors';
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
      UnrecoverableError,
    );
    globalThis.fetch = async () =>
      Response.json(
        { detail: { code: 'WORKER_BUSY', message: 'ocupado' } },
        { status: 429, headers: { 'Retry-After': '5' } },
      );
    await assert.rejects(
      () => Pipeline.prototype.callWorker('/download', {}),
      WorkerBusyError,
    );
  } finally {
    globalThis.fetch = original;
  }
});
