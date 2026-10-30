import type { NextRequest } from 'next/server';

async function forward(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const target = path.join('/');
  if (
    !/^(health|ready|library|sources|llm\/config|platforms|oauth\/(start|callback|refresh)|discovery\/(search|import|multisearch)|media|media\/(inspect|upload)|productions|automations|automations\/[a-zA-Z0-9]+\/(run|toggle)|jobs|jobs\/[a-zA-Z0-9]+|jobs\/[a-zA-Z0-9]+\/(publish|select|render-selection|llm-usage|schedule|continue|cancel|remove|restore)|jobs\/[a-zA-Z0-9]+\/artifacts\/(video|subtitles|transcript))$/.test(
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
      `${process.env.API_URL ?? 'http://127.0.0.1:3101'}/${target}${request.nextUrl.search}`,
      {
        method: request.method,
        headers: {
          'Content-Type':
            request.headers.get('content-type') ?? 'application/json',
          Authorization: `Bearer ${process.env.INTERNAL_API_TOKEN ?? ''}`,
          ...(request.headers.get('range')
            ? { Range: request.headers.get('range')! }
            : {}),
        },
        body: request.method === 'POST' ? request.body : undefined,
        duplex: 'half',
        cache: 'no-store',
        signal: AbortSignal.timeout(600000),
      } as RequestInit,
    );
    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type':
          response.headers.get('content-type') ??
          'application/json; charset=utf-8',
        ...(response.headers.get('content-disposition')
          ? {
              'Content-Disposition': response.headers.get(
                'content-disposition',
              )!,
            }
          : {}),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...Object.fromEntries(
          ['accept-ranges', 'content-range', 'content-length'].flatMap(
            (name) =>
              response.headers.get(name)
                ? [[name, response.headers.get(name)!]]
                : [],
          ),
        ),
      },
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
