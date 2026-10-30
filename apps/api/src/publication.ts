import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { z } from 'zod';
import { parse } from './contracts';

const platformSchema = z.enum(['youtube', 'tiktok']);
type Platform = z.infer<typeof platformSchema>;
export const scheduleSchema = z
  .object({
    platform: platformSchema,
    scheduledAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export function encryptTokens(value: unknown, keyHex: string) {
  if (!/^[a-f0-9]{64}$/i.test(keyHex))
    throw new BadRequestException(
      'Configure PLATFORM_TOKEN_KEY com 32 bytes hexadecimais',
    );
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const payload = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), payload]
    .map((v) => v.toString('base64url'))
    .join('.');
}
export function decryptTokens(value: string, keyHex: string): unknown {
  const [iv, tag, payload] = value
    .split('.')
    .map((v) => Buffer.from(v, 'base64url'));
  const cipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(keyHex, 'hex'),
    iv,
  );
  cipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([cipher.update(payload), cipher.final()]).toString(),
  );
}
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
});
const oauth = {
  youtube: {
    prefix: 'YOUTUBE',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/youtube.upload',
  },
  tiktok: {
    prefix: 'TIKTOK',
    authorize: 'https://www.tiktok.com/v2/auth/authorize/',
    token: 'https://open.tiktokapis.com/v2/oauth/token/',
    scope: 'video.publish',
  },
};

// Adaptador oficial isolado. A fila de produção chama SOMENTE simulate().
// Upload é exercitado com transporte falso nos testes; não existe rota para ativá-lo.
export class YouTubeUpload {
  constructor(private readonly transport: typeof fetch = fetch) {}
  async upload(
    accessToken: string,
    metadata: { title: string; description: string },
    video: Uint8Array,
    authorized: boolean,
  ) {
    if (!authorized || process.env.PUBLISH_ALLOW_REAL !== 'true')
      throw new BadRequestException('Publicação real desativada');
    const session = await this.transport(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': 'video/mp4',
          'X-Upload-Content-Length': String(video.byteLength),
        },
        body: JSON.stringify({
          snippet: metadata,
          status: { privacyStatus: 'private', selfDeclaredMadeForKids: false },
        }),
      },
    );
    const location = session.headers.get('location');
    if (
      !session.ok ||
      !location ||
      new URL(location).origin !== 'https://www.googleapis.com'
    )
      throw new ServiceUnavailableException('Falha ao iniciar upload oficial');
    const response = await this.transport(location, {
      method: 'PUT',
      redirect: 'error',
      signal: AbortSignal.timeout(600000),
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(video.byteLength),
      },
      body: Buffer.from(video),
    });
    if (!response.ok)
      throw new ServiceUnavailableException(
        'Upload com resultado desconhecido; não repetir automaticamente',
      );
    return z.object({ id: z.string().min(1) }).parse(await response.json());
  }
}

export class Publishing {
  constructor(
    private readonly db: PrismaClient,
    private readonly queue: Queue,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly transport: typeof fetch = fetch,
  ) {}
  private configuration(platform: Platform) {
    const config = oauth[platform],
      clientId = this.env[`${config.prefix}_CLIENT_ID`],
      secret = this.env[`${config.prefix}_CLIENT_SECRET`],
      redirect = this.env[`${config.prefix}_REDIRECT_URI`];
    if (
      !clientId ||
      !secret ||
      !redirect ||
      !/^[a-f0-9]{64}$/i.test(this.env.PLATFORM_TOKEN_KEY ?? '')
    )
      throw new BadRequestException(
        'Configure credenciais OAuth, redirect e PLATFORM_TOKEN_KEY',
      );
    const url = new URL(redirect);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (platform === 'tiktok' && url.protocol !== 'https:')
    )
      throw new BadRequestException(
        'TikTok Web exige callback HTTPS estático; não use credenciais ou parâmetros no callback',
      );
    if (
      url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(url.hostname)
      )
    )
      throw new BadRequestException('Callback exige HTTPS ou localhost');
    return { ...config, clientId, secret, redirect };
  }
  async status() {
    const accounts = await this.db.platformAccount.findMany({
      select: { platform: true, updatedAt: true },
    });
    return {
      mode: 'simulation',
      realPublishingEnabled: false,
      accounts,
      tiktok:
        'Requer app aprovado, escopo video.publish, consulta creator_info e consentimento antes de cada postagem',
      publications: await this.db.publication.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    };
  }
  async start(value: unknown) {
    const { platform } = parse(
      z.object({ platform: platformSchema }).strict(),
      value,
    );
    const c = this.configuration(platform),
      state = randomBytes(32).toString('base64url'),
      verifier = randomBytes(48).toString('base64url');
    const redis = await this.queue.getBackend().client;
    await redis.set(`oauth:${state}`, JSON.stringify({ platform, verifier }), {
      EX: 600,
    });
    const url = new URL(c.authorize);
    url.search = new URLSearchParams({
      [platform === 'tiktok' ? 'client_key' : 'client_id']: c.clientId,
      redirect_uri: c.redirect,
      response_type: 'code',
      scope: c.scope,
      state,
      ...(platform === 'youtube'
        ? {
            access_type: 'offline',
            prompt: 'consent',
            code_challenge: createHash('sha256')
              .update(verifier)
              .digest('base64url'),
            code_challenge_method: 'S256',
          }
        : {}),
    }).toString();
    return { url: url.toString() };
  }
  async callback(value: unknown) {
    const { platform, state, code } = parse(
      z
        .object({
          platform: platformSchema,
          state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
          code: z.string().min(1).max(4000),
        })
        .strict(),
      value,
    );
    const c = this.configuration(platform),
      redis = await this.queue.getBackend().client;
    redis.defineCommand('autoclipsConsumeOAuth', {
      numberOfKeys: 1,
      lua: "local v = redis.call('GET', KEYS[1]); redis.call('DEL', KEYS[1]); return v",
    });
    const saved: string | null = await redis.runCommand(
      'autoclipsConsumeOAuth',
      [`oauth:${state}`],
    );
    if (!saved)
      throw new BadRequestException('Estado OAuth expirado ou já utilizado');
    const session = z
      .object({ platform: platformSchema, verifier: z.string() })
      .parse(JSON.parse(saved));
    if (session.platform !== platform)
      throw new BadRequestException('Plataforma OAuth incompatível');
    const response = await this.transport(c.token, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        [platform === 'tiktok' ? 'client_key' : 'client_id']: c.clientId,
        client_secret: c.secret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: c.redirect,
        ...(platform === 'youtube' ? { code_verifier: session.verifier } : {}),
      }),
    });
    if (!response.ok)
      throw new ServiceUnavailableException('Falha OAuth na plataforma');
    const tokens = tokenSchema.parse(await response.json());
    if (!tokens.scope?.split(/[ ,]/).includes(c.scope))
      throw new BadRequestException('Escopo de publicação não concedido');
    // Preserva refresh token quando o provedor não o retorna numa reconexão.
    const prior = await this.db.platformAccount.findUnique({
      where: { platform },
    });
    const previous = prior
      ? tokenSchema.parse(
          decryptTokens(prior.encryptedTokens, this.env.PLATFORM_TOKEN_KEY!),
        )
      : null;
    const encryptedTokens = encryptTokens(
      {
        ...tokens,
        refresh_token: tokens.refresh_token ?? previous?.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
      },
      this.env.PLATFORM_TOKEN_KEY!,
    );
    await this.db.platformAccount.upsert({
      where: { platform },
      create: { platform, encryptedTokens },
      update: { encryptedTokens },
    });
    return { connected: true, platform, publishing: 'simulation' };
  }
  // Renovação sob demanda; nenhum timer consulta tokens/contas no PostgreSQL.
  async refresh(value: unknown) {
    const { platform } = parse(
      z.object({ platform: platformSchema }).strict(),
      value,
    );
    const c = this.configuration(platform);
    const account = await this.db.platformAccount.findUnique({
      where: { platform },
    });
    if (!account) throw new NotFoundException('Conecte a plataforma primeiro');
    const previous = tokenSchema.parse(
      decryptTokens(account.encryptedTokens, this.env.PLATFORM_TOKEN_KEY!),
    );
    if (!previous.refresh_token)
      throw new BadRequestException(
        'Reconecte a plataforma para conceder acesso offline',
      );
    const response = await this.transport(c.token, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        [platform === 'tiktok' ? 'client_key' : 'client_id']: c.clientId,
        client_secret: c.secret,
        grant_type: 'refresh_token',
        refresh_token: previous.refresh_token,
      }),
    });
    if (!response.ok)
      throw new ServiceUnavailableException(
        'Renovação recusada; reconecte a plataforma',
      );
    const tokens = tokenSchema.parse(await response.json());
    const encryptedTokens = encryptTokens(
      {
        ...tokens,
        scope: tokens.scope ?? previous.scope,
        refresh_token: tokens.refresh_token ?? previous.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
      },
      this.env.PLATFORM_TOKEN_KEY!,
    );
    await this.db.platformAccount.update({
      where: { platform },
      data: { encryptedTokens },
    });
    return { connected: true, platform, publishing: 'simulation' };
  }
  async schedule(taskId: string, body: unknown) {
    const { platform, scheduledAt } = parse(scheduleSchema, body);
    const date = new Date(scheduledAt);
    if (
      date.getTime() < Date.now() - 60000 ||
      date.getTime() > Date.now() + 365 * 86400000
    )
      throw new BadRequestException('Agende entre agora e 365 dias');
    const task = await this.db.task.findUnique({ where: { id: taskId } });
    if (
      !task ||
      task.deletedAt ||
      task.operation !== 'clip' ||
      task.status !== 'COMPLETED'
    )
      throw new BadRequestException('Agendamento exige MP4 concluído');
    const entry = await this.db.publication.upsert({
      where: { taskId_platform: { taskId, platform } },
      create: { taskId, platform, scheduledAt: date },
      update: {},
    });
    if (entry.status === 'SCHEDULED') await this.enqueue(entry);
    return entry;
  }
  async enqueue(entry: { id: string; scheduledAt: Date }) {
    await this.queue.add(
      'publish-simulation',
      { publicationId: entry.id },
      {
        jobId: `publication-${entry.id}`,
        delay: Math.max(0, entry.scheduledAt.getTime() - Date.now()),
        attempts: 1,
      },
    );
  }
  async simulate(id: string) {
    const publication = await this.db.publication.findUnique({ where: { id } });
    if (!publication) throw new NotFoundException('Agendamento não encontrado');
    if (publication.status !== 'SCHEDULED') return publication;
    const task = await this.db.task.findUniqueOrThrow({
      where: { id: publication.taskId },
      include: { source: true },
    });
    if (
      task.status !== 'COMPLETED' ||
      task.deletedAt ||
      task.operation !== 'clip' ||
      !task.source.commercialUseVerified
    )
      throw new BadRequestException('Vídeo não autorizado ou incompleto');
    const result = {
      mode: 'simulation',
      published: false,
      platform: publication.platform,
      taskId: task.id,
      editorial: task.editorial,
      video: task.result,
    };
    return this.db.publication.update({
      where: { id },
      data: { status: 'SIMULATED', result: result as Prisma.InputJsonValue },
    });
  }
}
