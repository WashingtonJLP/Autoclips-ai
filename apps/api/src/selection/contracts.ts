import { z } from 'zod';

export const transcriptSchema = z
  .object({
    duration: z.number().finite().positive().max(7200),
    segments: z
      .array(
        z.object({
          start: z.number().finite().min(0),
          end: z.number().finite().positive(),
          text: z.string().trim().min(1).max(4000),
        }),
      )
      .min(1)
      .max(10000),
  })
  .superRefine((v, ctx) => {
    v.segments.forEach((s, i) => {
      if (
        s.end <= s.start ||
        s.end > v.duration + 0.05 ||
        (i > 0 && s.start < v.segments[i - 1].end - 0.05)
      )
        ctx.addIssue({
          code: 'custom',
          message: `Timestamp inválido no segmento ${i}`,
        });
    });
  });
export type Transcript = z.infer<typeof transcriptSchema>;
export type Segment = Transcript['segments'][number] & { id: number };
const score = z.number().finite().min(0).max(10);
export const candidateSchema = z
  .object({
    first: z.number().int().min(0),
    last: z.number().int().min(0),
    title: z.string().trim().min(5).max(100),
    description: z.string().trim().min(10).max(600),
    scores: z
      .object({ hook: score, context: score, value: score, clarity: score })
      .strict(),
  })
  .strict();
export const outputSchema = z
  .object({ clips: z.array(candidateSchema).max(20) })
  .strict();
export const responseFormat = z.toJSONSchema(outputSchema);
export type Candidate = z.infer<typeof candidateSchema>;
export type SelectedClip = Candidate & {
  id: string;
  start: number;
  end: number;
  score: number;
  classification: 'destaque' | 'recomendado' | 'revisar';
  excerpt: string;
};
export class SelectionError extends Error {}

const integer = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);
const configSchema = z
  .object({
    provider: z.enum(['mock', 'ollama', 'openai']).default('mock'),
    model: z.string().min(1).max(100).default('mock-v1'),
    maxInputTokens: integer(6000, 2000, 32000),
    maxOutputTokens: integer(1600, 400, 8000),
    dailyTokenBudget: integer(100000, 0, 10000000),
    dailyCostMicros: integer(0, 0, 1000000000),
    runTokenBudget: integer(30000, 0, 500000),
    runCostMicros: integer(0, 0, 1000000000),
    maxChunks: integer(8, 1, 30),
    maxClips: integer(5, 1, 10),
    minDuration: z.coerce.number().min(1).max(60).default(5),
    maxDuration: z.coerce.number().min(1).max(180).default(60),
    minScore: z.coerce.number().min(0).max(10).default(4.5),
  })
  .refine(
    (v) => v.minDuration <= v.maxDuration,
    'Intervalo de duração inválido',
  );
export type SelectionConfig = z.infer<typeof configSchema>;
export function readSelectionConfig(
  env: NodeJS.ProcessEnv = process.env,
): SelectionConfig {
  return configSchema.parse({
    provider: env.LLM_PROVIDER,
    model: env.LLM_MODEL,
    maxInputTokens: env.LLM_MAX_INPUT_TOKENS,
    maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
    dailyTokenBudget: env.LLM_DAILY_TOKEN_BUDGET,
    dailyCostMicros: env.LLM_DAILY_COST_MICROS,
    runTokenBudget: env.LLM_RUN_TOKEN_BUDGET,
    runCostMicros: env.LLM_RUN_COST_MICROS,
    maxChunks: env.LLM_MAX_CHUNKS,
    maxClips: env.LLM_MAX_CLIPS,
    minDuration: env.LLM_MIN_DURATION,
    maxDuration: env.LLM_MAX_DURATION,
    minScore: env.LLM_MIN_SCORE,
  });
}
