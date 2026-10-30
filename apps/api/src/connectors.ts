import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Discovery, Discovered } from './discovery';

export type Candidate = {
  identity: string;
  platform: string;
  externalId?: string;
  url: string;
  title: string;
  author?: string;
  duration?: number;
  language?: string;
  publishedAt?: string;
  mediaUrl?: string;
  rightsConfirmed: boolean;
  accessible: boolean;
  reason?: string;
  metadata: Record<string, unknown>;
};
export interface Connector {
  readonly platform: string;
  matches(url: URL): boolean;
  resolve(url: URL): Promise<Candidate>;
  search(query: string, limit: number, channel?: string): Promise<Candidate[]>;
}
export const hash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function normalizedUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443')
  )
    throw new BadRequestException('Use um link HTTPS público sem credenciais');
  url.hash = '';
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_|fbclid|gclid)/.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url;
}
async function json(url: URL | string, headers?: Record<string, string>) {
  const response = await fetch(url, {
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  if (response.status === 404)
    throw new BadRequestException(
      'Vídeo ou canal não encontrado na plataforma. Confira o link ou envie o original autorizado.',
    );
  if ([401, 403].includes(response.status))
    throw new BadRequestException(
      'A plataforma recusou o acesso aos metadados. Revise a integração ou envie o original autorizado.',
    );
  if (!response.ok)
    throw new ServiceUnavailableException(
      `Consulta à plataforma falhou (${response.status})`,
    );
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2_000_000)
        throw new BadRequestException('Resposta da plataforma excede o limite');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
function blocked(
  platform: string,
  externalId: string,
  url: string,
  title = 'Vídeo descoberto',
): Candidate {
  return {
    identity: hash([platform, externalId]),
    platform,
    externalId,
    url,
    title,
    rightsConfirmed: false,
    accessible: false,
    reason:
      'Este vídeo não possui autorização de reutilização registrada. Envie o original e registre a autorização.',
    metadata: {},
  };
}
export class YouTubeConnector implements Connector {
  readonly platform = 'youtube';
  matches(u: URL) {
    return [
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'youtu.be',
    ].includes(u.hostname);
  }
  async resolve(u: URL) {
    const id =
      u.hostname === 'youtu.be'
        ? u.pathname.slice(1)
        : (u.searchParams.get('v') ??
          u.pathname.match(/^\/(?:shorts|embed)\/([^/]+)$/)?.[1]);
    if (!id || !/^[\w-]{11}$/.test(id))
      throw new BadRequestException('Informe um link de vídeo do YouTube');
    const item = blocked(
      this.platform,
      id,
      `https://www.youtube.com/watch?v=${id}`,
    );
    if (process.env.YOUTUBE_API_KEY) {
      const url = new URL('https://www.googleapis.com/youtube/v3/videos');
      url.search = new URLSearchParams({
        part: 'snippet,contentDetails,status',
        id,
        key: process.env.YOUTUBE_API_KEY,
      }).toString();
      const video = (await json(url)).items?.[0];
      if (!video)
        throw new BadRequestException('Vídeo não encontrado ou não disponível');
      Object.assign(item, {
        title: video.snippet.title,
        author: video.snippet.channelTitle,
        language: video.snippet.defaultAudioLanguage,
        publishedAt: video.snippet.publishedAt,
        duration: isoDuration(video.contentDetails.duration),
        metadata: { license: video.status.license },
      });
    } else {
      const url = new URL('https://www.youtube.com/oembed');
      url.searchParams.set('url', item.url);
      url.searchParams.set('format', 'json');
      const data = await json(url);
      Object.assign(item, { title: data.title, author: data.author_name });
      item.reason += ' Duração e busca exigem YOUTUBE_API_KEY no servidor.';
    }
    return item;
  }
  async search(query: string, limit: number, channel?: string) {
    if (!process.env.YOUTUBE_API_KEY)
      throw new BadRequestException(
        'Busca YouTube exige YOUTUBE_API_KEY; nenhum download é autorizado por essa chave',
      );
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.search = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      q: query,
      maxResults: String(Math.min(10, limit)),
      order: 'date',
      key: process.env.YOUTUBE_API_KEY,
      ...(channel ? { channelId: channel } : {}),
    }).toString();
    const data = await json(url);
    const items: Candidate[] = [];
    for (const v of data.items ?? [])
      items.push(
        await this.resolve(
          new URL(`https://www.youtube.com/watch?v=${v.id.videoId}`),
        ),
      );
    return items;
  }
}
export function isoDuration(v: string) {
  const m = v.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  return m
    ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
    : undefined;
}
export class VimeoConnector implements Connector {
  readonly platform = 'vimeo';
  matches(u: URL) {
    return ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(
      u.hostname,
    );
  }
  async resolve(u: URL) {
    const id = u.pathname.match(/(?:\/video)?\/(\d+)$/)?.[1];
    if (!id) throw new BadRequestException('Informe um link de vídeo Vimeo');
    const item = blocked(this.platform, id, `https://vimeo.com/${id}`);
    const url = new URL('https://vimeo.com/api/oembed.json');
    url.searchParams.set('url', item.url);
    const data = await json(url);
    return {
      ...item,
      title: data.title,
      author: data.author_name,
      duration: data.duration,
    };
  }
  async search(): Promise<Candidate[]> {
    throw new BadRequestException(
      'Vimeo: consulte metadados por link; busca de catálogo ainda não disponível',
    );
  }
}
export class TwitchConnector implements Connector {
  readonly platform = 'twitch';
  matches(u: URL) {
    return ['twitch.tv', 'www.twitch.tv'].includes(u.hostname);
  }
  async resolve(u: URL) {
    const id = u.pathname.match(/^\/videos\/(\d+)$/)?.[1];
    if (!id) throw new BadRequestException('Informe um link de VOD da Twitch');
    const item = blocked(
      this.platform,
      id,
      `https://www.twitch.tv/videos/${id}`,
    );
    const data = await this.request(`videos?id=${id}`);
    const video = data.data?.[0];
    if (!video) throw new BadRequestException('VOD não encontrado');
    return {
      ...item,
      title: video.title,
      author: video.user_name,
      language: video.language,
      duration: isoDuration(`PT${String(video.duration).toUpperCase()}`),
      publishedAt: video.published_at,
    };
  }
  private request(path: string) {
    if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_ACCESS_TOKEN)
      throw new BadRequestException(
        'Metadados Twitch exigem TWITCH_CLIENT_ID e TWITCH_ACCESS_TOKEN oficiais. Você pode enviar o original autorizado.',
      );
    return json(`https://api.twitch.tv/helix/${path}`, {
      'Client-Id': process.env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${process.env.TWITCH_ACCESS_TOKEN}`,
    });
  }
  async search(_query: string, limit: number, channel?: string) {
    if (!channel || !/^\d+$/.test(channel))
      throw new BadRequestException(
        'Monitoramento Twitch exige o ID numérico do canal; busca global de VODs não disponível',
      );
    const data = await this.request(
      `videos?user_id=${channel}&first=${Math.min(10, limit)}&sort=time`,
    );
    const items: Candidate[] = [];
    for (const v of data.data ?? [])
      items.push(
        await this.resolve(new URL(`https://www.twitch.tv/videos/${v.id}`)),
      );
    return items;
  }
}
export class CommonsConnector implements Connector {
  readonly platform = 'commons';
  constructor(private readonly discovery = new Discovery()) {}
  matches(u: URL) {
    return u.hostname === 'commons.wikimedia.org';
  }
  private candidate(item: Discovered): Candidate {
    return {
      ...blocked(this.platform, item.reference, item.url),
      title: item.name,
      author: item.attribution,
      duration:
        typeof item.evidence.duration === 'number'
          ? item.evidence.duration
          : undefined,
      mediaUrl: item.mediaUrl,
      accessible: true,
      metadata: { catalog: item },
    };
  }
  async resolve(u: URL) {
    const title = decodeURIComponent(u.pathname.replace(/^\/wiki\//, ''));
    if (!title.startsWith('File:'))
      throw new BadRequestException(
        'Informe a página File: do Wikimedia Commons',
      );
    return this.candidate(await this.discovery.resolve('commons', title));
  }
  async search(query: string, limit: number) {
    return (await this.discovery.search('commons', query))
      .slice(0, limit)
      .map((v) => this.candidate(v));
  }
}
export class ManifestConnector implements Connector {
  readonly platform = 'manifest';
  constructor(private readonly discovery = new Discovery()) {}
  matches() {
    return false;
  }
  async resolve(): Promise<Candidate> {
    throw new BadRequestException('Use o catálogo autorizado para esta origem');
  }
  async search(query: string, limit: number) {
    return (await this.discovery.search('manifest', query))
      .slice(0, limit)
      .map((item) => ({
        ...blocked(this.platform, item.reference, item.url),
        title: item.name,
        author: item.attribution,
        mediaUrl: item.mediaUrl,
        accessible: true,
        metadata: { catalog: item },
      }));
  }
}
export class DirectConnector implements Connector {
  readonly platform = 'direct';
  matches(u: URL) {
    return /\.(mp4|webm|ogv|mov|mp3|wav|m4a)$/i.test(u.pathname);
  }
  async resolve(u: URL) {
    return {
      ...blocked(
        this.platform,
        u.toString(),
        u.toString(),
        decodeURIComponent(u.pathname.split('/').at(-1)!),
      ),
      accessible: true,
      mediaUrl: u.toString(),
      reason:
        'Arquivo direto. O acesso público e a integridade serão validados ao importar; confirme a autorização apenas se solicitada.',
    };
  }
  async search(): Promise<Candidate[]> {
    throw new BadRequestException(
      'Arquivo direto aceita links; para descoberta use um catálogo autorizado',
    );
  }
}
export class Connectors {
  readonly all: Connector[] = [
    new YouTubeConnector(),
    new TwitchConnector(),
    new VimeoConnector(),
    new CommonsConnector(),
    new ManifestConnector(),
    new DirectConnector(),
    new FeedConnector(),
  ];
  resolve(value: string) {
    const u = normalizedUrl(value),
      connector = this.all.find((c) => c.matches(u));
    if (!connector)
      throw new BadRequestException(
        'Origem não reconhecida. Envie o arquivo original autorizado.',
      );
    return connector.resolve(u);
  }
  search(platform: string, query: string, limit: number, channel?: string) {
    const connector = this.all.find((c) => c.platform === platform);
    if (!connector)
      throw new BadRequestException('Plataforma de busca não suportada');
    return connector.search(query, limit, channel);
  }
}

export class FeedConnector implements Connector {
  readonly platform = 'rss';
  matches() {
    return false;
  }
  async resolve(): Promise<Candidate> {
    throw new BadRequestException(
      'Use a busca RSS para descobrir episódios; importe o link autorizado do episódio.',
    );
  }
  async search(query: string, limit: number, channel?: string) {
    const response = await fetch(
      `${process.env.WORKER_URL ?? 'http://127.0.0.1:8000'}/feeds`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.WORKER_API_TOKEN ?? ''}`,
        },
        body: JSON.stringify({ query, ...(channel ? { url: channel } : {}) }),
        signal: AbortSignal.timeout(60000),
      },
    );
    const data = await response.json();
    if (!response.ok)
      throw new BadRequestException(
        typeof data.detail === 'string'
          ? data.detail
          : 'Não foi possível consultar o feed',
      );
    return data.items
      .slice(0, limit)
      .map(
        (item: {
          externalId: string;
          url: string;
          title: string;
          accessible: boolean;
          metadata: Record<string, unknown>;
        }) => ({
          ...blocked(this.platform, item.externalId, item.url, item.title),
          ...item,
          metadata: item.metadata,
          rightsConfirmed: false,
        }),
      );
  }
}
