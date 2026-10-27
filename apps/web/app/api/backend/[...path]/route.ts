import type { NextRequest } from 'next/server';

async function forward(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const target = path.join('/');
  if (
    !/^(sources|llm\/config|jobs|jobs\/[a-zA-Z0-9]+|jobs\/[a-zA-Z0-9]+\/(publish|select|render-selection|llm-usage))$/.test(
      target,
    )
  ) {
    return Response.json({ message: 'Rota não permitida' }, { status: 404 });
  }
  if (
    request.method === 'POST' &&
    request.headers.get('origin') &&
    new URL(request.headers.get('origin')!).host !== request.headers.get('host')
  ) {
    return Response.json({ message: 'Origem não permitida' }, { status: 403 });
  }
  try {
    const response = await fetch(
      `${process.env.API_URL ?? 'http://127.0.0.1:3003'}/${target}`,
      {
        method: request.method,
        headers: { 'Content-Type': 'application/json' },
        body: request.method === 'POST' ? await request.text() : undefined,
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      },
    );
    return new Response(await response.text(), {
      status: response.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch {
    return Response.json(
      { message: 'API indisponível. Confira os serviços locais.' },
      { status: 503 },
    );
  }
}
export const GET = forward;
export const POST = forward;
