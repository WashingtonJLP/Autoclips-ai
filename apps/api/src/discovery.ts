import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { sourceSchema } from './contracts';
import { youtubeVideoId } from './youtube-url';

export const discoveryRequest = z
  .object({
    connector: z.enum(['commons', 'manifest']),
    query: z.string().trim().min(1).max(200),
  })
  .strict();
export const importRequest = z
  .object({
    connector: z.enum(['commons', 'manifest']),
    reference: z.string().min(1).max(1000),
    commercialUseVerified: z.literal(true),
    autoRun: z.boolean().default(true),
  })
  .strict();
export type Discovered = {
  reference: string;
  name: string;
  url: string;
  license: 'CC0' | 'CC-BY-4.0' | 'PERMISSION';
  evidenceUrl: string;
  attribution: string;
  mediaUrl: string;
  evidence: Record<string, unknown>;
};
const clean = (v: string) =>
  v
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim();
export function commonsCandidate(page: unknown): Discovered | null {
  const p = z
    .object({
      title: z.string(),
      imageinfo: z
        .array(
          z.object({
            url: z.url(),
            descriptionurl: z.url(),
            mime: z.string(),
            mediatype: z.string().optional(),
            size: z.number(),
            duration: z.number().optional(),
            timestamp: z.string(),
            sha1: z.string(),
            extmetadata: z
              .object({
                LicenseUrl: z.object({ value: z.string() }).optional(),
                Restrictions: z.object({ value: z.string() }).optional(),
                Artist: z.object({ value: z.string() }).optional(),
                Credit: z.object({ value: z.string() }).optional(),
              })
              .passthrough(),
          }),
        )
        .min(1),
    })
    .safeParse(page);
  if (!p.success) return null;
  const info = p.data.imageinfo[0],
    metadata = info.extmetadata;
  const licenseUrl = metadata.LicenseUrl?.value
    ?.replace(/^http:/, 'https:')
    .replace(/\/(?:deed\.[a-z-]+|legalcode(?:\.[a-z-]+)?)\/?$/, '')
    .replace(/\/$/, '');
  const license =
    licenseUrl === 'https://creativecommons.org/licenses/by/4.0'
      ? 'CC-BY-4.0'
      : licenseUrl === 'https://creativecommons.org/publicdomain/zero/1.0'
        ? 'CC0'
        : null;
  if (
    !license ||
    metadata.Restrictions?.value ||
    !(
      info.mime.startsWith('video/') ||
      (info.mime === 'application/ogg' && info.mediatype === 'VIDEO')
    ) ||
    info.size > 512 * 1024 ** 2
  )
    return null;
  const media = new URL(info.url),
    evidence = new URL(info.descriptionurl);
  if (
    media.protocol !== 'https:' ||
    media.hostname !== 'upload.wikimedia.org' ||
    evidence.protocol !== 'https:' ||
    evidence.hostname !== 'commons.wikimedia.org'
  )
    return null;
  if (license === 'CC-BY-4.0' && !clean(metadata.Artist?.value ?? ''))
    return null;
  const attribution = `${clean(metadata.Artist?.value ?? '')} — ${p.data.title} — ${license} (${licenseUrl}). ${clean(metadata.Credit?.value ?? '')}`;
  return {
    reference: p.data.title,
    name: p.data.title.slice(0, 200),
    url: info.descriptionurl,
    evidenceUrl: info.descriptionurl,
    license,
    attribution: attribution.slice(0, 2000),
    mediaUrl: info.url,
    evidence: {
      provider: 'commons',
      retrievedAt: new Date().toISOString(),
      ...info,
    },
  };
}

export class Discovery {
  constructor(
    private readonly transport: typeof fetch = fetch,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}
  private async json(url: string) {
    const response = await this.transport(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      headers: { 'User-Agent': 'AutoClipsAI/0.1 (authorized video discovery)' },
    });
    if (!response.ok)
      throw new ServiceUnavailableException(
        `Fonte indisponível (${response.status})`,
      );
    const text = await response.text();
    if (Buffer.byteLength(text) > 2_000_000)
      throw new BadRequestException('Catálogo excede limite');
    return JSON.parse(text);
  }
  private async commons(query: string, exact: boolean) {
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.search = new URLSearchParams({
      action: 'query',
      format: 'json',
      prop: 'imageinfo',
      iiprop: 'url|mime|mediatype|size|dimensions|timestamp|sha1|extmetadata',
      ...(exact
        ? { titles: query }
        : {
            generator: 'search',
            gsrsearch: `${query} filetype:video`,
            gsrnamespace: '6',
            gsrlimit: '20',
          }),
    }).toString();
    const data = z
      .object({
        query: z
          .object({ pages: z.record(z.string(), z.unknown()) })
          .optional(),
      })
      .parse(await this.json(url.toString()));
    return Object.values(data.query?.pages ?? {})
      .map(commonsCandidate)
      .filter((v): v is Discovered => v !== null);
  }
  async youtubeOriginal(id: string): Promise<{
    status: 'found' | 'not_found' | 'ambiguous';
    candidate?: Discovered;
  }> {
    if (!/^[\w-]{11}$/.test(id))
      throw new BadRequestException('ID YouTube inválido');
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.search = new URLSearchParams({
      action: 'query',
      format: 'json',
      generator: 'search',
      gsrsearch: `insource:"${id}" filetype:video`,
      gsrnamespace: '6',
      gsrlimit: '6',
      prop: 'imageinfo',
      iiprop: 'url|mime|mediatype|size|dimensions|timestamp|sha1|extmetadata',
    }).toString();
    const data = await this.json(url.href);
    if (data.error)
      throw new ServiceUnavailableException(
        'Não foi possível consultar o catálogo de originais licenciados',
      );
    // Não escolhe arbitrariamente entre resultados de uma busca truncada.
    if (data.continue?.gsroffset !== undefined) return { status: 'ambiguous' };
    const items = Object.values(data.query?.pages ?? {})
      .map(commonsCandidate)
      .filter((item): item is Discovered => {
        if (
          !item ||
          !/^[a-f\d]{40}$/.test(String(item.evidence.sha1)) ||
          typeof item.evidence.duration !== 'number' ||
          item.evidence.duration <= 0 ||
          item.evidence.duration > 7200
        )
          return false;
        const metadata = item.evidence.extmetadata as {
          Credit?: { value?: string };
        };
        const credit = metadata.Credit?.value ?? '';
        const referenced = new Set<string>();
        // Só links diretos no campo de origem/crédito; descrições, busca e títulos
        // parecidos não comprovam correspondência. Não segue redirects ou archive.org.
        for (const match of credit.matchAll(
          /<a\b[^>]*\shref\s*=\s*(["'])(.*?)\1[^>]*>/gi,
        )) {
          try {
            const href = match[2].replace(/&(?:amp|#38|#x26);/gi, '&');
            const video = youtubeVideoId(new URL(href));
            if (video) referenced.add(video);
          } catch {
            /* Metadado incompleto não autoriza associação. */
          }
        }
        return referenced.size === 1 && referenced.has(id);
      });
    if (items.length !== 1)
      return { status: items.length ? 'ambiguous' : 'not_found' };
    return { status: 'found', candidate: items[0] };
  }
  private async manifest() {
    // Catálogo configurado pelo operador; não recebe URLs arbitrárias do cliente.
    const urls = z
      .array(z.url())
      .max(10)
      .parse(JSON.parse(this.env.SOURCE_MANIFEST_URLS ?? '[]'));
    const items: Discovered[] = [];
    for (const url of urls) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
        throw new BadRequestException('Manifesto exige HTTPS');
      const manifest = z
        .object({
          items: z
            .array(
              sourceSchema.omit({ commercialUseVerified: true }).extend({
                id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
                mediaUrl: z.url(),
              }),
            )
            .max(100),
        })
        .strict()
        .parse(await this.json(url));
      for (const item of manifest.items)
        items.push({
          ...item,
          reference: `${url}#${item.id}`,
          evidence: {
            manifestUrl: url,
            retrievedAt: new Date().toISOString(),
            item,
          },
        });
    }
    return items;
  }
  async search(connector: 'commons' | 'manifest', query: string) {
    return connector === 'commons'
      ? this.commons(query, false)
      : (await this.manifest())
          .filter((v) => v.name.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 20);
  }
  async resolve(connector: 'commons' | 'manifest', reference: string) {
    const candidates =
      connector === 'commons'
        ? await this.commons(reference, true)
        : await this.manifest();
    const item = candidates.find((v) =>
      connector === 'commons'
        ? v.reference.replaceAll('_', ' ') === reference.replaceAll('_', ' ')
        : v.reference === reference,
    );
    if (!item)
      throw new BadRequestException(
        'Mídia ou licença não aprovada no catálogo atual',
      );
    return {
      ...item,
      connectorKey: createHash('sha256')
        .update(`${connector}:${reference}:${item.mediaUrl}`)
        .digest('hex'),
    };
  }
}
