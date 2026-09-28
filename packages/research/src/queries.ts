import { createHash } from "node:crypto";
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import {
  marketSnapshots as s,
  markets as m,
  workerRuns as r,
} from "@kalshi-lab/db";
import type { Observation } from "./microstructure.ts";
export interface Selection {
  source: "kalshi_production_public";
  from: Date;
  to: Date;
  runIds: string[];
  tickers: string[];
  maxRows: number;
}
export function validateSelection(selection: Selection): void {
  if (selection.source !== "kalshi_production_public")
    throw new Error("Research requires production-public source.");
  const duration = selection.to.getTime() - selection.from.getTime();
  if (!Number.isFinite(duration) || duration <= 0 || duration > 7 * 86400000)
    throw new Error("Specify a UTC window of at most seven days.");
  if (
    !Number.isSafeInteger(selection.maxRows) ||
    selection.maxRows < 1 ||
    selection.maxRows > 250000
  )
    throw new Error("maxRows must be 1..250000.");
  if (
    selection.runIds.length > 100 ||
    selection.runIds.some(
      (id) =>
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
          id,
        ),
    )
  )
    throw new Error("Invalid/broad run selection.");
  if (
    selection.tickers.length > 100 ||
    selection.tickers.some((t) => !/^[A-Za-z0-9._-]+$/.test(t))
  )
    throw new Error("Invalid/broad ticker selection.");
}
/** Consistent read-only MVCC view, indexed filters, keyset pages, explicit hard cap.
 * Keep at most one market history in the data-access layer; never LIMIT silently.
 */
export async function queryResearch<
  T extends PgQueryResultHKT,
  TSchema extends Record<string, unknown>,
>(
  db: PgDatabase<T, TSchema>,
  selection: Selection,
  consume: (ticker: string, rows: Observation[]) => void,
  makerFields = false,
) {
  validateSelection(selection);
  return db.transaction(
    async (tx) => {
      const filters = and(
        eq(s.source, selection.source),
        gte(s.observedAt, selection.from),
        lt(s.observedAt, selection.to),
        selection.runIds.length
          ? inArray(s.workerRunId, selection.runIds)
          : undefined,
        selection.tickers.length
          ? inArray(m.ticker, selection.tickers)
          : undefined,
      );
      const [count] = await tx
        .select({
          rows: sql<number>`count(*)::integer`,
          firstObservation: sql<string | null>`min(${s.observedAt})::text`,
          lastObservation: sql<string | null>`max(${s.observedAt})::text`,
        })
        .from(s)
        .innerJoin(m, eq(s.marketId, m.id))
        .where(filters);
      if (!count || count.rows > selection.maxRows)
        throw new Error(
          "Selected rows exceed cap; narrow the window/run/tickers. No partial report produced.",
        );
      const universe = await tx
        .selectDistinct({ id: m.id, ticker: m.ticker })
        .from(s)
        .innerJoin(m, eq(s.marketId, m.id))
        .where(filters)
        .orderBy(asc(m.ticker));
      if (universe.length > 100)
        throw new Error(
          "Selected markets exceed 100; narrow the window/tickers.",
        );
      const runIds = await tx
        .selectDistinct({ id: s.workerRunId })
        .from(s)
        .innerJoin(m, eq(s.marketId, m.id))
        .where(filters);
      if (runIds.length > 100)
        throw new Error("Selected runs exceed 100; narrow the window/runs.");
      const runs = runIds.length
        ? await tx
            .select()
            .from(r)
            .where(
              and(
                eq(r.source, selection.source),
                inArray(
                  r.id,
                  runIds.map((run) => run.id),
                ),
              ),
            )
            .orderBy(asc(r.startedAt))
        : [];
      const hash = createHash("sha256");
      for (const market of universe) {
        hash.update(`${market.ticker}\n`);
        const rows: Observation[] = [];
        let cursor: { at: string; id: string } | undefined;
        while (true) {
          const page: (Observation & { cursorTimestamp: string })[] = await tx
            .select({
              ...(makerFields
                ? {
                    eventTicker: m.eventTicker,
                    bookReceivedAt: s.bookReceivedAt,
                    tickerReceivedAt: s.tickerReceivedAt,
                  }
                : {}),
              id: s.id,
              workerRunId: s.workerRunId,
              observedAt: s.observedAt,
              cursorTimestamp: sql<string>`to_char(${s.observedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
              stale: s.stale,
              connected: s.connected,
              status: s.status,
              yesBid: s.yesBid,
              yesAsk: s.yesAsk,
              yesBidSize: s.yesBidSize,
              yesAskSize: s.yesAskSize,
              volume: s.volume,
              supplemental: s.supplemental,
            })
            .from(s)
            .innerJoin(m, eq(s.marketId, m.id))
            .where(
              and(
                filters,
                eq(s.marketId, market.id),
                cursor
                  ? sql`(${s.observedAt}, ${s.id}) > (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
                  : undefined,
              ),
            )
            .orderBy(asc(s.observedAt), asc(s.id))
            .limit(2000);
          for (const row of page) hash.update(`${JSON.stringify(row)}\n`);
          rows.push(...page);
          if (rows.length > count.rows)
            throw new Error(
              "Pagination exceeded selected row count; no partial report produced.",
            );
          if (page.length < 2000) break;
          const last = page.at(-1)!;
          cursor = { at: last.cursorTimestamp, id: last.id };
        }
        consume(market.ticker, rows);
      }
      return {
        selectedRows: count.rows,
        firstObservation: count.firstObservation
          ? new Date(count.firstObservation).toISOString()
          : null,
        lastObservation: count.lastObservation
          ? new Date(count.lastObservation).toISOString()
          : null,
        datasetSha256: hash.digest("hex"),
        runs,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
