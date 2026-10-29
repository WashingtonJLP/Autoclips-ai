import { z } from 'zod';
import {
  responseFormat,
  Segment,
  SelectionConfig,
  SelectionError,
} from './contracts';

export type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  costMicros?: number;
};
export type LlmResponse = { content: string; usage?: Usage };
export const llmResponseSchema = z
  .object({
    content: z.string().max(128000),
    usage: z
      .object({
        inputTokens: z.number().int().min(0).max(1000000000).optional(),
        outputTokens: z.number().int().min(0).max(1000000000).optional(),
        costMicros: z.number().int().min(0).max(1000000000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type LlmRequest = {
  model: string;
  messages: { role: 'system' | 'user'; content: string }[];
  segments: Segment[];
  maxOutputTokens: number;
  minDuration: number;
  maxDuration: number;
};
export interface LlmProvider {
  readonly name: string;
  readonly simulated: boolean;
  // Pior custo possível da chamada em milionésimos de USD; null bloqueia o envio.
  quote(inputTokens: number, outputTokens: number): number | null;
  generate(request: LlmRequest): Promise<LlmResponse>;
}
export class LlmUnavailableError extends SelectionError {}
export class LlmHttpError extends LlmUnavailableError {
  constructor(
    readonly status: number,
    readonly retryAfterMs = 0,
  ) {
    super(`API de IA recusou a solicitação (${status})`);
  }
  get retryable() {
    return [429, 500, 502, 503, 504].includes(this.status);
  }
}
export class UnavailableProvider implements LlmProvider {
  readonly simulated = false;
  constructor(
    readonly name: string,
    readonly reason: string,
  ) {}
  quote() {
    return 0;
  }
  async generate(): Promise<LlmResponse> {
    throw new LlmUnavailableError(this.reason);
  }
}
async function boundedResponse(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new LlmUnavailableError('IA retornou uma resposta vazia');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 128000) throw new SelectionError('Resposta IA excede limite');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks).toString('utf8');
}
export function estimateInput(request: LlmRequest): number {
  // Limite conservador por bytes UTF-8, incluindo instruções e schema; não é consumo medido.
  return (
    Buffer.byteLength(
      JSON.stringify({ messages: request.messages, format: responseFormat }),
      'utf8',
    ) + 64
  );
}
export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock';
  readonly simulated = true;
  quote() {
    return 0;
  }
  async generate(request: LlmRequest): Promise<LlmResponse> {
    const clips = [];
    for (let i = 0; i < request.segments.length && clips.length < 20; i++) {
      const first = request.segments[i];
      let last = first;
      for (let j = i; j < request.segments.length; j++) {
        const next = request.segments[j];
        if (next.end - first.start > request.maxDuration) break;
        last = next;
        if (last.end - first.start >= Math.min(30, request.maxDuration)) break;
      }
      if (
        last.end - first.start < request.minDuration ||
        last.end - first.start > request.maxDuration
      )
        continue;
      const text = request.segments
        .filter((s) => s.id >= first.id && s.id <= last.id)
        .map((s) => s.text)
        .join(' ');
      const topic = first.text
        .replace(/[^\p{L}\p{N} ]/gu, '')
        .split(/\s+/)
        .slice(0, 6)
        .join(' ');
      clips.push({
        first: first.id,
        last: last.id,
        title: `Uma ideia em foco: ${topic}`.slice(0, 100),
        description: `Neste recorte, acompanhe uma ideia sobre ${topic}. Reveja o contexto e os detalhes na fonte original.`,
        reason:
          'Seleção de teste simulada; não houve análise semântica por IA.',
        scores: {
          hook: /\?|como|por que|erro|segredo/i.test(first.text) ? 8 : 5,
          context: 7,
          value: /\d|exemplo|aprend|passo|dica/i.test(text) ? 8 : 6,
          clarity: text.split(/\s+/).length >= 8 ? 8 : 4,
        },
      });
    }
    // Sem inferência nem tokens faturados. As pontuações são heurísticas de teste.
    return {
      content: JSON.stringify({ clips }),
      usage: { inputTokens: 0, outputTokens: 0, costMicros: 0 },
    };
  }
}
const usageCount = z.number().int().min(0).max(1000000000).optional();
const ollamaResponse = z.object({
  message: z.object({ content: z.string() }),
  done: z.literal(true),
  done_reason: z.string().optional(),
  prompt_eval_count: usageCount,
  eval_count: usageCount,
});
export class OllamaProvider implements LlmProvider {
  readonly name = 'ollama';
  readonly simulated = false;
  constructor(
    private readonly url: string,
    private readonly transport: typeof fetch = fetch,
  ) {
    const parsed = new URL(url);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      throw new SelectionError('URL Ollama inválida');
    // Somente inferência local. Endpoints cloud/pagos não são suportados por este adaptador.
    if (
      ![
        'localhost',
        '127.0.0.1',
        '[::1]',
        'host.docker.internal',
        'ollama',
      ].includes(parsed.hostname)
    )
      throw new SelectionError('Ollama deve ser um serviço local aprovado');
  }
  quote() {
    return 0;
  }
  async generate(request: LlmRequest): Promise<LlmResponse> {
    const response = await this.transport(
      `${this.url.replace(/\/$/, '')}/api/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(120000),
        redirect: 'error',
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          format: responseFormat,
          stream: false,
          options: {
            temperature: 0,
            num_predict: request.maxOutputTokens,
            num_ctx: estimateInput(request) + request.maxOutputTokens,
            num_thread: 2,
            num_gpu: 0,
          },
          keep_alive: 0,
        }),
      },
    );
    if (!response.ok)
      throw new SelectionError(`API LLM indisponível (${response.status})`);
    const raw = await response.text();
    if (Buffer.byteLength(raw) > 128000)
      throw new SelectionError('Resposta LLM excede limite');
    const data = ollamaResponse.parse(JSON.parse(raw));
    // A camada de seleção registra consumo mesmo quando a geração terminou por limite.
    return {
      content: data.done_reason === 'length' ? '' : data.message.content,
      usage: {
        inputTokens: data.prompt_eval_count,
        outputTokens: data.eval_count,
      },
    };
  }
}
export function createProvider(
  config: SelectionConfig,
  env: NodeJS.ProcessEnv = process.env,
): LlmProvider {
  if (config.provider === 'mock') return new MockLlmProvider();
  if (env.LLM_ALLOW_EXTERNAL !== 'true')
    throw new SelectionError(
      'Chamadas LLM fora do simulador não foram habilitadas',
    );
  if (config.provider === 'openai') return new OpenAiProvider(env);
  if (config.provider === 'gemini') return new GeminiProvider(env);
  if (config.model === 'mock-v1')
    throw new SelectionError('Configure um modelo local explícito');
  if (/cloud|https?:/i.test(config.model))
    throw new SelectionError('Modelos cloud não são permitidos');
  return new OllamaProvider(env.LLM_OLLAMA_URL ?? 'http://127.0.0.1:11434');
}

// A gratuidade depende do projeto Google e deve ser confirmada pelo operador.
// Nunca presume que uma chave Gemini pertence ao nível gratuito.
export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';
  readonly simulated = false;
  private readonly inputRate: number;
  private readonly outputRate: number;
  constructor(
    private readonly env: NodeJS.ProcessEnv,
    private readonly transport: typeof fetch = fetch,
  ) {
    if (
      env.LLM_ALLOW_EXTERNAL !== 'true' ||
      !env.GEMINI_API_KEY ||
      !/^gemini-[a-z0-9.-]+$/.test(env.LLM_MODEL ?? '')
    )
      throw new SelectionError(
        'Configure GEMINI_API_KEY, modelo Gemini explícito e LLM_ALLOW_EXTERNAL',
      );
    const free = env.GEMINI_FREE_TIER_CONFIRMED === 'true';
    this.inputRate = free ? 0 : Number(env.LLM_INPUT_USD_PER_MILLION);
    this.outputRate = free ? 0 : Number(env.LLM_OUTPUT_USD_PER_MILLION);
    if (
      !free &&
      (env.LLM_ALLOW_PAID !== 'true' ||
        ![this.inputRate, this.outputRate].every(
          (v) => Number.isFinite(v) && v > 0 && v <= 10000,
        ))
    )
      throw new SelectionError(
        'Gemini exige confirmação do nível gratuito ou autorização e preços para consumo pago',
      );
  }
  quote(input: number, output: number) {
    return Math.ceil(input * this.inputRate + output * this.outputRate);
  }
  async generate(request: LlmRequest): Promise<LlmResponse> {
    const { $schema: _schema, ...schema } = responseFormat;
    void _schema;
    const response = await this.transport(
      `https://generativelanguage.googleapis.com/v1beta/models/${request.model}:generateContent`,
      {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(120000),
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.env.GEMINI_API_KEY!,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: request.messages
                  .filter((m) => m.role === 'system')
                  .map((m) => m.content)
                  .join('\n'),
              },
            ],
          },
          contents: request.messages
            .filter((m) => m.role === 'user')
            .map((m) => ({ role: 'user', parts: [{ text: m.content }] })),
          generationConfig: {
            temperature: 0,
            maxOutputTokens: request.maxOutputTokens,
            responseMimeType: 'application/json',
            responseJsonSchema: schema,
            ...(/^gemini-2\.5-flash/.test(request.model)
              ? { thinkingConfig: { thinkingBudget: 0 } }
              : {}),
          },
        }),
      },
    );
    if (!response.ok) {
      const retry = response.headers.get('retry-after');
      const seconds = Number(retry);
      const delay =
        retry && !Number.isFinite(seconds)
          ? Math.max(0, Date.parse(retry) - Date.now())
          : seconds * 1000;
      await response.body?.cancel();
      throw new LlmHttpError(
        response.status,
        Number.isFinite(delay) ? Math.min(30000, delay) : 0,
      );
    }
    const raw = await boundedResponse(response);
    const data = z
      .object({
        candidates: z
          .array(
            z.object({
              finishReason: z.string(),
              content: z
                .object({
                  parts: z.array(z.object({ text: z.string().optional() })),
                })
                .optional(),
            }),
          )
          .optional(),
        usageMetadata: z.object({
          promptTokenCount: z.number().int().nonnegative(),
          candidatesTokenCount: z.number().int().nonnegative().optional(),
          thoughtsTokenCount: z.number().int().nonnegative().optional(),
        }),
      })
      .parse(JSON.parse(raw));
    const input = data.usageMetadata.promptTokenCount;
    const output =
      (data.usageMetadata.candidatesTokenCount ?? 0) +
      (data.usageMetadata.thoughtsTokenCount ?? 0);
    return {
      content:
        data.candidates?.[0]?.finishReason === 'STOP'
          ? (data.candidates[0].content?.parts
              .map((p) => p.text ?? '')
              .join('') ?? '')
          : '',
      usage: {
        inputTokens: input,
        outputTokens: output,
        costMicros: this.quote(input, output),
      },
    };
  }
}

// Preços são limites conservadores em USD por milhão de tokens, definidos pelo
// operador para o modelo escolhido. Nenhum preço/modelo pago é presumido.
export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai';
  readonly simulated = false;
  private readonly inputRate: number;
  private readonly outputRate: number;
  constructor(
    private readonly env: NodeJS.ProcessEnv,
    private readonly transport: typeof fetch = fetch,
  ) {
    if (env.LLM_ALLOW_EXTERNAL !== 'true' || env.LLM_ALLOW_PAID !== 'true')
      throw new SelectionError(
        'Consumo pago exige autorização explícita LLM_ALLOW_PAID=true',
      );
    if (!env.OPENAI_API_KEY || !env.LLM_MODEL || env.LLM_MODEL === 'mock-v1')
      throw new SelectionError(
        'Configure OPENAI_API_KEY e um modelo explícito',
      );
    this.inputRate = Number(env.LLM_INPUT_USD_PER_MILLION);
    this.outputRate = Number(env.LLM_OUTPUT_USD_PER_MILLION);
    if (
      ![this.inputRate, this.outputRate].every(
        (v) => Number.isFinite(v) && v > 0 && v <= 10000,
      )
    )
      throw new SelectionError(
        'Configure os limites positivos de preço do modelo',
      );
  }
  quote(input: number, output: number) {
    return Math.ceil(input * this.inputRate + output * this.outputRate);
  }
  async generate(request: LlmRequest): Promise<LlmResponse> {
    const { $schema: _schema, ...schema } = responseFormat;
    void _schema;
    const response = await this.transport(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(120000),
        headers: {
          Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          max_completion_tokens: request.maxOutputTokens,
          store: false,
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'clips', strict: true, schema },
          },
        }),
      },
    );
    if (!response.ok)
      throw new SelectionError(`API LLM indisponível (${response.status})`);
    const raw = await response.text();
    if (Buffer.byteLength(raw) > 128000)
      throw new SelectionError('Resposta LLM excede limite');
    const data = z
      .object({
        choices: z
          .array(
            z.object({
              finish_reason: z.string(),
              message: z.object({
                content: z.string().nullable(),
                refusal: z.string().nullable().optional(),
              }),
            }),
          )
          .min(1),
        usage: z.object({
          prompt_tokens: z.number().int().nonnegative(),
          completion_tokens: z.number().int().nonnegative(),
        }),
      })
      .parse(JSON.parse(raw));
    const choice = data.choices[0];
    return {
      content:
        choice.finish_reason === 'stop' && !choice.message.refusal
          ? (choice.message.content ?? '')
          : '',
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
        costMicros: this.quote(
          data.usage.prompt_tokens,
          data.usage.completion_tokens,
        ),
      },
    };
  }
}
