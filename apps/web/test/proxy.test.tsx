import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NextRequest } from 'next/server';
import { POST } from '../app/api/backend/[...path]/route';

test('proxy permite recuperação de produção e preserva bloqueio de origem e rotas', async () => {
  const original = globalThis.fetch;
  const forwarded: string[] = [];
  try {
    globalThis.fetch = async (url) => {
      forwarded.push(String(url));
      return Response.json({ retried: 1 }, { status: 201 });
    };
    const request = (origin = 'http://localhost:3100') =>
      Object.assign(
        new Request(
          'http://localhost:3100/api/backend/productions/abc123/retry',
          {
            method: 'POST',
            headers: { origin, host: 'localhost:3100' },
            body: '{}',
          },
        ),
        {
          nextUrl: new URL(
            'http://localhost:3100/api/backend/productions/abc123/retry',
          ),
        },
      ) as unknown as NextRequest;
    const context = {
      params: Promise.resolve({ path: ['productions', 'abc123', 'retry'] }),
    };
    assert.equal((await POST(request(), context)).status, 201);
    assert.ok(forwarded[0].endsWith('/productions/abc123/retry'));
    assert.equal(
      (await POST(request('https://example.org'), context)).status,
      403,
    );
    assert.equal(
      (await POST(request(), { params: Promise.resolve({ path: ['admin'] }) }))
        .status,
      404,
    );
    assert.equal(forwarded.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});
