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
  if (config.model === 'mock-v1')
    throw new SelectionError('Configure um modelo local explícito');
  if (/cloud|https?:/i.test(config.model))
    throw new SelectionError('Modelos cloud não são permitidos');
  return new OllamaProvider(env.LLM_OLLAMA_URL ?? 'http://127.0.0.1:11434');
}
