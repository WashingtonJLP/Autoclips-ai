import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ platform: string }> },
) {
  const { platform } = await context.params;
  if (
    !['youtube', 'tiktok'].includes(platform) ||
    request.nextUrl.searchParams.has('error')
  )
    return new Response('Autorização não concluída. Volte ao dashboard.', {
      status: 400,
    });
  try {
    const response = await fetch(
      `${process.env.API_URL ?? 'http://127.0.0.1:3003'}/oauth/callback`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.INTERNAL_API_TOKEN ?? ''}`,
        },
        body: JSON.stringify({
          platform,
          state: request.nextUrl.searchParams.get('state'),
          code: request.nextUrl.searchParams.get('code'),
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(40000),
      },
    );
    if (!response.ok)
      return new Response(
        'Falha na conexão OAuth. Confira credenciais, escopos e callback; reinicie a conexão pelo dashboard.',
        {
          status: 400,
          headers: {
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
          },
        },
      );
    const redirect = NextResponse.redirect(
      new URL('/?oauth=connected', request.url),
    );
    redirect.headers.set('Cache-Control', 'no-store');
    redirect.headers.set('Referrer-Policy', 'no-referrer');
    return redirect;
  } catch {
    return new Response('Plataforma indisponível. Volte ao dashboard.', {
      status: 503,
    });
  }
}
