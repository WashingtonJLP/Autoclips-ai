import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

export function equalSecret(actual: string, expected: string) {
  const a = Buffer.from(actual),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

@Injectable()
export class ApiGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (request.path === '/health') return true;
    const secret = process.env.INTERNAL_API_TOKEN;
    if (!secret) {
      if (process.env.NODE_ENV === 'production')
        throw new UnauthorizedException('Configure INTERNAL_API_TOKEN');
      return true; // Desenvolvimento local em loopback; Compose exige o segredo.
    }
    if (
      !equalSecret(
        String(request.headers.authorization ?? ''),
        `Bearer ${secret}`,
      )
    )
      throw new UnauthorizedException('Autenticação necessária');
    return true;
  }
}
