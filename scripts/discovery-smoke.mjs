// Consulta pública de metadados. Não baixa mídia nem aprova licenças pelo operador.
import assert from 'node:assert/strict';
const response = await fetch(
  `${process.env.SMOKE_API_URL ?? 'http://127.0.0.1:3101'}/discovery/search`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.INTERNAL_API_TOKEN ?? ''}`,
    },
    body: JSON.stringify({
      connector: 'commons',
      query: process.argv[2] ?? 'speech',
    }),
    signal: AbortSignal.timeout(30000),
  },
);
const data = await response.json();
assert.ok(response.ok, JSON.stringify(data));
assert.ok(Array.isArray(data));
console.log(
  JSON.stringify(
    {
      count: data.length,
      candidates: data.map(({ reference, license, evidenceUrl, mediaUrl }) => ({
        reference,
        license,
        evidenceUrl,
        mediaUrl,
      })),
    },
    null,
    2,
  ),
);
