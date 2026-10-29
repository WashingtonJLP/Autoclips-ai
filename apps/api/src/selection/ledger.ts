import { Prisma, PrismaClient } from '@prisma/client';
import { SelectionConfig, SelectionError } from './contracts';
import { llmResponseSchema, LlmResponse } from './provider';
import { Reservation, UsageLedger } from './service';

export async function selectionTransaction<T>(
  db: PrismaClient,
  action: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await db.$transaction(action, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (
        attempt < 3 &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2034', 'P2002'].includes(error.code)
      )
        continue;
      throw error;
    }
  }
  throw new SelectionError('Não foi possível concluir a transação de seleção');
}

export class PrismaUsageLedger implements UsageLedger {
  constructor(
    private readonly db: PrismaClient,
    private readonly day: () => string = () =>
      new Date().toISOString().slice(0, 10),
  ) {}
  private async transaction<T>(
    action: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return selectionTransaction(this.db, action);
  }
  async reserve(
    r: Reservation,
    config: SelectionConfig,
  ): Promise<{ cached?: LlmResponse }> {
    return this.transaction(async (tx) => {
      const existing = await tx.llmCall.findUnique({ where: { key: r.key } });
      if (existing) {
        if (existing.state === 'SUCCEEDED')
          return { cached: llmResponseSchema.parse(existing.response) };
        throw new SelectionError(
          'Chamada já reservada ou falhou; consumo desconhecido exige revisão',
        );
      }
      const day = this.day();
      const budget = await tx.llmBudget.upsert({
        where: { day },
        create: { day },
        update: {},
      });
      // Conta reservas, inclusive tentativas falhas/ambíguas. Cache é retornado antes
      // desta verificação. A transação serializável impede ultrapassar o limite por corrida.
      if (
        r.provider === 'gemini' &&
        (await tx.llmCall.count({ where: { day, provider: 'gemini' } })) >=
          config.geminiDailyRequestLimit
      )
        throw new SelectionError(
          'Limite diário de requisições Gemini atingido; nenhuma chamada enviada',
        );
      const tokens = BigInt(r.inputTokens + r.outputTokens),
        cost = BigInt(r.costMicros);
      if (
        budget.tokens + tokens > BigInt(config.dailyTokenBudget) ||
        budget.costMicros + cost > BigInt(config.dailyCostMicros)
      )
        throw new SelectionError(
          'Orçamento diário insuficiente; chamada bloqueada',
        );
      await tx.llmBudget.update({
        where: { day },
        data: {
          tokens: { increment: tokens },
          costMicros: { increment: cost },
        },
      });
      await tx.llmCall.create({
        data: {
          key: r.key,
          taskId: r.taskId,
          day,
          provider: r.provider,
          model: r.model,
          inputReserved: r.inputTokens,
          outputReserved: r.outputTokens,
          costReservedMicros: r.costMicros,
        },
      });
      return {};
    });
  }
  async settle(r: Reservation, response: LlmResponse): Promise<void> {
    const safe = llmResponseSchema.parse(response);
    await this.transaction(async (tx) => {
      const call = await tx.llmCall.findUniqueOrThrow({
        where: { key: r.key },
      });
      if (call.state !== 'RESERVED')
        throw new SelectionError('Reserva já finalizada');
      const input = safe.usage?.inputTokens,
        output = safe.usage?.outputTokens,
        cost = safe.usage?.costMicros;
      const tokenDifference = BigInt(
        (input ?? call.inputReserved) +
          (output ?? call.outputReserved) -
          call.inputReserved -
          call.outputReserved,
      );
      const costDifference = BigInt(
        (cost ?? call.costReservedMicros) - call.costReservedMicros,
      );
      await tx.llmBudget.update({
        where: { day: call.day },
        data: {
          tokens: { increment: tokenDifference },
          costMicros: { increment: costDifference },
        },
      });
      await tx.llmCall.update({
        where: { key: r.key },
        data: {
          state: 'SUCCEEDED',
          inputTokens: input ?? null,
          outputTokens: output ?? null,
          costMicros: cost ?? null,
          response: JSON.parse(JSON.stringify(safe)) as Prisma.InputJsonValue,
        },
      });
    });
  }
  async fail(r: Reservation): Promise<void> {
    await this.db.llmCall.updateMany({
      where: { key: r.key, state: 'RESERVED' },
      data: { state: 'FAILED' },
    });
    // Não liberar: a inferência pode ter sido realizada antes da falha de rede.
  }
  async summary() {
    const budget = await this.db.llmBudget.findUnique({
      where: { day: this.day() },
    });
    return {
      day: this.day(),
      committedTokens: (budget?.tokens ?? 0n).toString(),
      committedCostMicros: (budget?.costMicros ?? 0n).toString(),
      geminiRequestsReserved: await this.db.llmCall.count({
        where: { day: this.day(), provider: 'gemini' },
      }),
    };
  }
}
