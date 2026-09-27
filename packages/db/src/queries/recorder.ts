import { and, eq, or, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../schema.ts";
import {
  markets,
  marketSnapshots,
  workerRuns,
  type MarketInput,
  type RunHealth,
  type RunInput,
  type SnapshotInput,
} from "../schema.ts";

/** All snapshot writes and run counters commit in one transaction. */
export function createRecorderStore<T extends PgQueryResultHKT>(
  db: PgDatabase<T, typeof schema>,
) {
  return {
    async ping(): Promise<void> {
      await db.execute(sql`select 1`);
    },
    async startRun(input: RunInput): Promise<string> {
      const [run] = await db
        .insert(workerRuns)
        .values(input)
        .onConflictDoNothing({ target: workerRuns.id })
        .returning({ id: workerRuns.id });
      if (!run && !input.id) throw new Error("Could not start worker run.");
      return run?.id ?? input.id!;
    },
    async upsertMarkets(inputs: MarketInput[]) {
      if (!inputs.length) return [];
      if (inputs.length > 100)
        throw new Error("Market batch exceeds 100 rows.");
      await db
        .insert(markets)
        .values(inputs)
        .onConflictDoUpdate({
          target: [markets.source, markets.ticker],
          set: {
            eventTicker: sql`excluded.event_ticker`,
            title: sql`excluded.title`,
            subtitle: sql`excluded.subtitle`,
            status: sql`excluded.status`,
            openTime: sql`excluded.open_time`,
            closeTime: sql`excluded.close_time`,
            expirationTime: sql`excluded.expiration_time`,
            metadata: sql`excluded.metadata`,
            lastSeenAt: sql`greatest(${markets.lastSeenAt}, excluded.last_seen_at)`,
          },
          // Concurrent older observations must never overwrite newer metadata.
          setWhere: sql`excluded.last_seen_at >= ${markets.lastSeenAt}`,
        });
      return db
        .select()
        .from(markets)
        .where(
          or(
            ...inputs.map((input) =>
              and(
                eq(markets.source, input.source),
                eq(markets.ticker, input.ticker),
              ),
            ),
          ),
        );
    },
    async setMarketsTracked(runId: string, count: number): Promise<void> {
      await db
        .update(workerRuns)
        .set({ marketsTracked: count })
        .where(eq(workerRuns.id, runId));
    },
    async writeSnapshots(
      runId: string,
      inputs: SnapshotInput[],
      health: RunHealth = {},
    ): Promise<number> {
      if (inputs.length > 100)
        throw new Error("Snapshot batch exceeds 100 rows.");
      if (inputs.some((row) => row.workerRunId !== runId))
        throw new Error("Snapshot run mismatch.");
      return db.transaction(async (tx) => {
        const inserted = inputs.length
          ? await tx
              .insert(marketSnapshots)
              .values(inputs)
              .onConflictDoNothing()
              .returning({ observedAt: marketSnapshots.observedAt })
          : [];
        const lastObserved = inserted.reduce<Date | null>(
          (latest, row) =>
            !latest || row.observedAt > latest ? row.observedAt : latest,
          null,
        );
        await tx
          .update(workerRuns)
          .set({
            ...health,
            heartbeatAt: new Date(),
            snapshotsWritten: sql`${workerRuns.snapshotsWritten} + ${inserted.length}`,
            ...(lastObserved
              ? {
                  lastSuccessfulObservationAt: sql`greatest(${workerRuns.lastSuccessfulObservationAt}, ${lastObserved.toISOString()}::timestamptz)`,
                }
              : {}),
          })
          .where(eq(workerRuns.id, runId));
        return inserted.length;
      });
    },
    async finishRun(
      runId: string,
      status: "completed" | "stopped" | "failed",
      health: RunHealth,
    ): Promise<void> {
      const now = new Date();
      await db
        .update(workerRuns)
        .set({ ...health, status, stoppedAt: now, heartbeatAt: now })
        .where(eq(workerRuns.id, runId));
    },
  };
}
export type RecorderStore = ReturnType<typeof createRecorderStore>;
