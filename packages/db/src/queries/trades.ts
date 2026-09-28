import { and, desc, eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../schema.ts";
import {
  feeRuleSnapshots,
  marketTrades,
  markets,
  tradeCollectorRuns,
  type FeeSnapshotInput,
  type TradeInput,
} from "../schema.ts";

export function createTradeStore<T extends PgQueryResultHKT>(
  db: PgDatabase<T, typeof schema>,
) {
  return {
    async startRun(input: typeof tradeCollectorRuns.$inferInsert) {
      await db.insert(tradeCollectorRuns).values(input);
      return input.id;
    },
    async marketIds(tickers: string[]) {
      const ids = new Map<string, string>();
      for (const ticker of tickers) {
        const [row] = await db
          .select({ id: markets.id })
          .from(markets)
          .where(
            and(
              eq(markets.source, "kalshi_production_public"),
              eq(markets.ticker, ticker),
            ),
          );
        if (!row) throw new Error(`Market not persisted: ${ticker}`);
        ids.set(ticker, row.id);
      }
      return ids;
    },
    async lastExecutedAt(ticker: string): Promise<Date | null> {
      const [row] = await db
        .select({ at: marketTrades.executedAt })
        .from(marketTrades)
        .where(
          and(
            eq(marketTrades.source, "kalshi_production_public"),
            eq(marketTrades.ticker, ticker),
          ),
        )
        .orderBy(desc(marketTrades.executedAt))
        .limit(1);
      return row?.at ?? null;
    },
    async writeTrades(runId: string, inputs: TradeInput[]) {
      if (
        inputs.length > 1000 ||
        inputs.some(
          (row) =>
            row.collectionRunId !== runId ||
            row.source !== "kalshi_production_public",
        )
      )
        throw new Error("Invalid trade batch.");
      return db.transaction(async (tx) => {
        let inserted = 0,
          duplicates = 0;
        for (const input of inputs) {
          const [row] = await tx
            .insert(marketTrades)
            .values(input)
            .onConflictDoNothing({
              target: [marketTrades.source, marketTrades.providerTradeId],
            })
            .returning({ id: marketTrades.id });
          if (row) {
            inserted++;
            continue;
          }
          const [prior] = await tx
            .select()
            .from(marketTrades)
            .where(
              and(
                eq(marketTrades.source, input.source),
                eq(marketTrades.providerTradeId, input.providerTradeId),
              ),
            );
          if (
            !prior ||
            prior.ticker !== input.ticker ||
            prior.executedAt.getTime() !== input.executedAt.getTime() ||
            prior.yesPrice !== input.yesPrice ||
            prior.noPrice !== input.noPrice ||
            prior.quantity !== input.quantity ||
            prior.aggressorSide !== input.aggressorSide ||
            prior.isBlockTrade !== input.isBlockTrade
          )
            throw new Error(
              `Provider trade ID collision or changed record: ${input.providerTradeId}`,
            );
          duplicates++;
        }
        await tx
          .update(tradeCollectorRuns)
          .set({
            tradesWritten: sql`${tradeCollectorRuns.tradesWritten} + ${inserted}`,
            duplicatesSeen: sql`${tradeCollectorRuns.duplicatesSeen} + ${duplicates}`,
            heartbeatAt: new Date(),
          })
          .where(eq(tradeCollectorRuns.id, runId));
        return { inserted, duplicates };
      });
    },
    async writeFeeSnapshots(inputs: FeeSnapshotInput[]) {
      if (inputs.length > 1000) throw new Error("Fee batch exceeds cap.");
      if (inputs.length) await db.insert(feeRuleSnapshots).values(inputs);
    },
    async heartbeat(runId: string, error: string | null = null) {
      await db
        .update(tradeCollectorRuns)
        .set({ heartbeatAt: new Date(), error })
        .where(eq(tradeCollectorRuns.id, runId));
    },
    async updateCollectionMetrics(runId: string, metrics: Record<string, number>) {
      if (
        Object.values(metrics).some(
          (value) => !Number.isSafeInteger(value) || value < 0,
        )
      )
        throw new Error("Invalid collection metrics.");
      await db
        .update(tradeCollectorRuns)
        .set({
          config: sql`${tradeCollectorRuns.config} || ${JSON.stringify({ collectionMetrics: metrics })}::jsonb`,
        })
        .where(eq(tradeCollectorRuns.id, runId));
    },
    async finishRun(
      runId: string,
      status: "completed" | "stopped" | "failed",
      error: string | null,
    ) {
      await db
        .update(tradeCollectorRuns)
        .set({ status, error, stoppedAt: new Date(), heartbeatAt: new Date() })
        .where(eq(tradeCollectorRuns.id, runId));
    },
  };
}
export type TradeStore = ReturnType<typeof createTradeStore>;
