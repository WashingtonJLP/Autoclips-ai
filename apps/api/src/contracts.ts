import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const url = z.url().refine((v) => /^https?:\/\//.test(v), 'Use URL HTTP(S)');
const segmentSchema = z
  .object({
    start: z.number().finite().min(0),
    end: z.number().finite().positive(),
    text: z.string().min(1).max(5000),
  })
  .strict()
  .refine((v) => v.end > v.start, 'Segmento inválido');
export const sourceSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    url,
    license: z.enum(['CC0', 'CC-BY-4.0', 'PERMISSION']),
    evidenceUrl: url,
    attribution: z.string().trim().min(1).max(2000),
    commercialUseVerified: z.literal(true),
  })
  .strict();

export const jobSchema = z
  .object({
    sourceId: z.string().min(1).max(100),
    path: z
      .string()
      .min(1)
      .max(500)
      .refine(
        (v) => !v.includes('..') && !/^[\\/]|:/.test(v),
        'Caminho relativo obrigatório',
      ),
    operation: z.enum(['transcribe', 'clip']),
    autoRun: z.boolean().optional(),
    start: z.number().finite().min(0).optional(),
    end: z.number().finite().positive().optional(),
    segments: z.array(segmentSchema).max(5000).optional(),
    burn_subtitles: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.autoRun && v.operation !== 'transcribe')
      ctx.addIssue({
        code: 'custom',
        message: 'Fluxo automático começa pela transcrição',
      });
    if (
      v.operation === 'transcribe' &&
      [v.start, v.end, v.segments, v.burn_subtitles].some(
        (value) => value !== undefined,
      )
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Transcrição aceita apenas fonte e caminho',
      });
    }
    if (v.burn_subtitles && !v.segments?.length) {
      ctx.addIssue({ code: 'custom', message: 'Legendas exigem segmentos' });
    }
    if (
      v.operation === 'clip' &&
      (v.start === undefined ||
        v.end === undefined ||
        v.end <= v.start ||
        v.end - v.start > 180)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Corte deve ter início/fim válidos e até 180 segundos',
      });
    }
  });

export function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestException(result.error.issues);
  return result.data;
}
