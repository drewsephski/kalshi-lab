import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createRecorderStore } from "./queries/recorder.ts";
import { createTradeStore } from "./queries/trades.ts";
import * as schema from "./schema.ts";

test("trade IDs deduplicate idempotently and reject changed immutable records", async () => {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../migrations", import.meta.url),
      ),
    });
    const store = createTradeStore(db);
    const recorder = createRecorderStore(db);
    const at = new Date("2026-09-28T14:00:00Z"),
      runId = randomUUID();
    await store.startRun({
      id: runId,
      startedAt: at,
      heartbeatAt: at,
      status: "running",
      gitCommit: "a".repeat(40),
      gitDirty: false,
      config: {},
    });
    const [market] = await recorder.upsertMarkets([
      {
        source: "kalshi_production_public",
        ticker: "T",
        eventTicker: "E",
        title: "Test",
        status: "open",
        metadata: {},
        firstSeenAt: at,
        lastSeenAt: at,
      },
    ]);
    assert.ok(market);
    const input: schema.TradeInput = {
      source: "kalshi_production_public",
      providerTradeId: "provider-id",
      marketId: market.id,
      ticker: "T",
      eventTicker: "E",
      executedAt: at,
      receivedAt: at,
      yesPrice: "0.4000",
      noPrice: "0.6000",
      quantity: "1.50",
      takerOutcomeSide: "no",
      takerBookSide: "ask",
      aggressorSide: "no_buy",
      sideProvenance: "provider_explicit",
      isBlockTrade: false,
      rawMetadata: {},
      collectionRunId: runId,
    };
    assert.deepEqual(await store.writeTrades(runId, [input]), {
      inserted: 1,
      duplicates: 0,
    });
    assert.deepEqual(await store.writeTrades(runId, [input]), {
      inserted: 0,
      duplicates: 1,
    });
    await assert.rejects(
      () => store.writeTrades(runId, [{ ...input, quantity: "2.00" }]),
      /collision/,
    );
    const [run] = await db.select().from(schema.tradeCollectorRuns);
    assert.equal(run?.tradesWritten, 1);
    assert.equal(run?.duplicatesSeen, 1);
    assert.equal((await db.select().from(schema.marketTrades)).length, 1);
  } finally {
    await client.close();
  }
});
