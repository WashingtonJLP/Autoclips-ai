import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/api/health') return NextResponse.next();
  const username = process.env.DASHBOARD_USER,
    password = process.env.DASHBOARD_PASSWORD;
  if (!username || !password) {
    if (process.env.NODE_ENV === 'production')
      return new NextResponse('Configure as credenciais do dashboard', {
        status: 503,
      });
    return NextResponse.next();
  }
  const expected = Buffer.from(
    `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
  );
  const supplied = Buffer.from(request.headers.get('authorization') ?? '');
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  )
    return new NextResponse('Autenticação necessária', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="AutoClips AI", charset="UTF-8"',
      },
    });
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
