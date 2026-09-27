import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createRecorderStore } from "@kalshi-lab/db";
import * as schema from "@kalshi-lab/db";
import { queryResearch, validateSelection, type Selection } from "./queries.ts";
import { createAnalysis } from "./report.ts";
const selection: Selection = {
  source: "kalshi_production_public",
  from: new Date("2026-01-01T00:00:00Z"),
  to: new Date("2026-01-01T03:00:00Z"),
  runIds: [],
  tickers: [],
  maxRows: 250000,
};
test("query selection rejects source mixing, unbounded windows and invalid filters", () => {
  assert.throws(() =>
    validateSelection({
      ...selection,
      source: "kalshi_demo" as Selection["source"],
    }),
  );
  assert.throws(() =>
    validateSelection({ ...selection, to: new Date("2027-01-01") }),
  );
  assert.throws(() => validateSelection({ ...selection, runIds: ["oops"] }));
  assert.throws(() => validateSelection({ ...selection, maxRows: NaN }));
});
test("read-only research queries apply exact source/run/ticker/window filters, paginate, and reconcile exclusions", async () => {
  const client = new PGlite(),
    db = drizzle(client, { schema });
  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../../db/migrations", import.meta.url),
      ),
    });
    const store = createRecorderStore(db),
      now = selection.from;
    const publicRun = await store.startRun({
      source: "kalshi_production_public",
      gitCommit: "a".repeat(40),
      gitDirty: false,
      recorderVersion: "test",
      config: {},
    });
    const demoRun = await store.startRun({
      source: "kalshi_demo",
      gitCommit: "a".repeat(40),
      gitDirty: false,
      recorderVersion: "test",
      config: {},
    });
    const [publicMarket] = await store.upsertMarkets([
      {
        source: "kalshi_production_public",
        ticker: "A",
        title: "A",
        status: "active",
        metadata: {},
        firstSeenAt: now,
        lastSeenAt: now,
      },
    ]);
    const [demoMarket] = await store.upsertMarkets([
      {
        source: "kalshi_demo",
        ticker: "A",
        title: "A",
        status: "active",
        metadata: {},
        firstSeenAt: now,
        lastSeenAt: now,
      },
    ]);
    assert.ok(publicMarket && demoMarket);
    const snapshot = {
      source: "kalshi_production_public" as const,
      workerRunId: publicRun,
      marketId: publicMarket.id,
      status: "active",
      transport: "rest",
      connected: true,
      stale: false,
      yesBid: "0.47",
      yesAsk: "0.50",
      supplemental: {},
    };
    for (let offset = 0; offset < 2005; offset += 100) {
      const rows = Array.from(
        { length: Math.min(100, 2005 - offset) },
        (_, i) => ({
          ...snapshot,
          id: randomUUID(),
          observedAt: new Date(now.getTime() + (offset + i) * 5000),
          tickerReceivedAt: now,
          stale: offset + i === 3,
        }),
      );
      await store.writeSnapshots(publicRun, rows);
    }
    await store.writeSnapshots(demoRun, [
      {
        ...snapshot,
        source: "kalshi_demo",
        workerRunId: demoRun,
        marketId: demoMarket.id,
        id: randomUUID(),
        observedAt: now,
        tickerReceivedAt: now,
      },
    ]);
    const a = createAnalysis();
    const provenance = await queryResearch(
      db,
      { ...selection, runIds: [publicRun], tickers: ["A"] },
      a.consume,
    );
    assert.equal(provenance.selectedRows, 2005);
    assert.equal(provenance.runs.length, 1);
    assert.equal(a.finish().eligible, 2004);
    assert.equal(a.finish().exclusions.stale, 1);
    const b = createAnalysis();
    const limited = await queryResearch(
      db,
      { ...selection, to: new Date(now.getTime() + 5000) },
      b.consume,
    );
    assert.equal(limited.selectedRows, 1);
    await assert.rejects(
      queryResearch(db, { ...selection, maxRows: 2000 }, () => {}),
      /exceed cap/,
    );
    assert.equal(
      (
        await queryResearch(
          db,
          { ...selection, tickers: ["UNKNOWN"] },
          () => {},
        )
      ).selectedRows,
      0,
    );
  } finally {
    await client.close();
  }
});
