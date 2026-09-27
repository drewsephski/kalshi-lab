import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createRecorderStore } from "./queries/recorder.ts";
import * as schema from "./schema.ts";
import { createDatabase } from "./client.ts";

function postgresCode(code: string) {
  return (error: unknown): boolean => {
    if (error && typeof error === "object") {
      if ("code" in error && error.code === code) return true;
      if ("cause" in error) return postgresCode(code)(error.cause);
    }
    return false;
  };
}

// Real PostgreSQL semantics and the generated migration, isolated in memory.
test("recorder queries preserve source boundaries, history, and idempotent counters", async () => {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../migrations", import.meta.url),
      ),
    });
    const store = createRecorderStore(db);
    await store.ping();
    const source = "kalshi_demo" as const;
    const runId = await store.startRun({
      source,
      gitCommit: "a".repeat(40),
      gitDirty: false,
      recorderVersion: "test",
      config: {},
    });
    const firstSeenAt = new Date("2026-01-01T00:00:00Z");
    const input = {
      source,
      ticker: "SAME",
      title: "First",
      status: "active",
      metadata: {},
      firstSeenAt,
      lastSeenAt: firstSeenAt,
    };
    const [demo] = await store.upsertMarkets([input]);
    const [publicMarket] = await store.upsertMarkets([
      { ...input, source: "kalshi_production_public" },
    ]);
    assert.ok(demo && publicMarket);
    assert.notEqual(demo.id, publicMarket.id);
    const later = new Date("2026-01-02T00:00:00Z");
    const [updated] = await store.upsertMarkets([
      { ...input, title: "Updated", firstSeenAt: later, lastSeenAt: later },
    ]);
    assert.equal(updated?.id, demo.id);
    assert.equal(updated?.firstSeenAt.toISOString(), firstSeenAt.toISOString());
    const [older] = await store.upsertMarkets([input]);
    assert.equal(older?.title, "Updated");
    await store.setMarketsTracked(runId, 1);
    const snapshot: schema.SnapshotInput = {
      id: randomUUID(),
      source,
      workerRunId: runId,
      marketId: demo.id,
      observedAt: later,
      tickerReceivedAt: later,
      status: "active",
      transport: "rest",
      connected: true,
      stale: false,
      yesBid: "0.1234",
      volume: "9007199254740993.01",
      supplemental: {},
    };
    assert.equal(await store.writeSnapshots(runId, [snapshot]), 1);
    assert.equal(await store.writeSnapshots(runId, [snapshot]), 0);
    // A retry with a new ID but the same observation key is also harmless.
    assert.equal(
      await store.writeSnapshots(runId, [{ ...snapshot, id: randomUUID() }]),
      0,
    );
    const [stored] = await db.select().from(schema.marketSnapshots);
    assert.equal(stored?.yesBid, "0.1234");
    assert.equal(stored?.volume, "9007199254740993.01");
    await assert.rejects(
      store.writeSnapshots(runId, [
        {
          ...snapshot,
          id: randomUUID(),
          marketId: publicMarket.id,
          observedAt: new Date(later.getTime() + 1),
        },
      ]),
      postgresCode("23503"),
    );
    await assert.rejects(
      store.writeSnapshots(runId, [
        {
          ...snapshot,
          id: randomUUID(),
          observedAt: new Date(later.getTime() + 1),
          yesBid: "1.5000",
        },
      ]),
      postgresCode("23514"),
    );
    await assert.rejects(
      store.writeSnapshots("different-run", [snapshot]),
      /run mismatch/,
    );
    await store.finishRun(runId, "completed", { error: null });
    const [run] = await db.select().from(schema.workerRuns);
    assert.equal(run?.snapshotsWritten, 1);
    assert.equal(run?.marketsTracked, 1);
    assert.equal(run?.status, "completed");
    assert.equal(
      run?.lastSuccessfulObservationAt?.toISOString(),
      later.toISOString(),
    );
    assert.ok(run?.stoppedAt);
  } finally {
    await client.close();
  }
});

test("database configuration requires a PostgreSQL connection string", () => {
  assert.throws(() => createDatabase(""), /DATABASE_URL/);
  assert.throws(() => createDatabase("https://example.com"), /PostgreSQL URL/);
});
