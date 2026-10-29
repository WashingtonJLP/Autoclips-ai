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
          words: z
            .array(
              z.object({
                start: z.number().finite().min(0),
                end: z.number().finite().min(0),
                word: z.string().min(1).max(200),
              }),
            )
            .max(2000)
            .optional(),
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
      s.words?.forEach((word, j) => {
        if (
          word.end < word.start ||
          word.start < s.start - 0.05 ||
          word.end > s.end + 0.05 ||
          (j > 0 && word.start < s.words![j - 1].end - 0.05)
        )
          ctx.addIssue({
            code: 'custom',
            message: `Timestamp de palavra inválido no segmento ${i}`,
          });
      });
    });
  });
export type Transcript = z.infer<typeof transcriptSchema>;
export type Segment = Transcript['segments'][number] & { id: number };
const score = z.number().finite().min(0).max(10);
export const criteriaSchema = z
  .array(z.enum(['hook', 'value', 'humor', 'emotion', 'engagement']))
  .min(1)
  .max(5)
  .refine((v) => new Set(v).size === v.length, 'Critérios repetidos');
export const selectionVersion = 'semantic-v2';
export const candidateSchema = z
  .object({
    first: z.number().int().min(0),
    last: z.number().int().min(0),
    title: z.string().trim().min(5).max(100),
    description: z.string().trim().min(10).max(600),
    reason: z.string().trim().min(10).max(600).optional(),
    scores: z
      .object({
        hook: score,
        context: score,
        value: score,
        clarity: score,
        humor: score.optional(),
        emotion: score.optional(),
        engagement: score.optional(),
      })
      .strict(),
  })
  .strict();
export const outputSchema = z
  .object({ clips: z.array(candidateSchema).max(20) })
  .strict();
// Contrato estrito enviado aos provedores reais; leitura de resultados antigos permanece compatível.
export const semanticOutputSchema = z
  .object({
    clips: z
      .array(
        candidateSchema.extend({
          reason: z.string().trim().min(10).max(600),
          scores: z
            .object({
              hook: score,
              context: score,
              value: score,
              clarity: score,
              humor: score,
              emotion: score,
              engagement: score,
            })
            .strict(),
        }),
      )
      .max(20),
  })
  .strict();
export const responseFormat = z.toJSONSchema(semanticOutputSchema);
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
    provider: z.enum(['mock', 'ollama', 'openai', 'gemini']).default('mock'),
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
    criteria: criteriaSchema.default(['hook', 'value']),
    fallback: z.enum(['none', 'heuristic']).default('none'),
    maxRetries: integer(2, 0, 2),
  })
  .refine(
    (v) => v.minDuration <= v.maxDuration,
    'Intervalo de duração inválido',
  );
export type SelectionConfig = z.infer<typeof configSchema>;
export function selectionPolicy(config: SelectionConfig) {
  return {
    version: selectionVersion,
    provider: config.provider,
    model: config.model,
    maxInputTokens: config.maxInputTokens,
    maxOutputTokens: config.maxOutputTokens,
    maxChunks: config.maxChunks,
    maxClips: config.maxClips,
    minDuration: config.minDuration,
    maxDuration: config.maxDuration,
    minScore: config.minScore,
    criteria: config.criteria,
    fallback: config.fallback,
  };
}
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
    fallback: env.LLM_FALLBACK,
    maxRetries: env.LLM_MAX_RETRIES,
  });
}
