import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { sourceSchema } from './contracts';

export const discoveryRequest = z
  .object({
    connector: z.literal('manifest'),
    query: z.string().trim().min(1).max(200),
  })
  .strict();
export const importRequest = z
  .object({
    connector: z.literal('manifest'),
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
  async search(_connector: 'manifest', query: string) {
    return (await this.manifest())
      .filter((v) => v.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 20);
  }
  async resolve(connector: 'manifest', reference: string) {
    const item = (await this.manifest()).find((v) => v.reference === reference);
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
