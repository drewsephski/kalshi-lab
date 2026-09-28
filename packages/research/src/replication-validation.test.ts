import assert from "node:assert/strict";
import test from "node:test";
import { assertRunInSessionWindow } from "./replication-validation.ts";

const session = {
  sessionId: "s1",
  runId: "r1",
  kind: "trade" as const,
  collectCommit: "abc123",
  from: "2026-09-28T12:00:00.000Z",
  toExclusive: "2026-09-28T12:30:00.000Z",
};
const run = {
  id: "r1",
  gitCommit: "abc123",
  gitDirty: false,
  status: "completed",
  error: null,
  startedAt: "2026-09-28T12:00:01.000Z",
  stoppedAt: "2026-09-28T12:20:01.000Z",
};

test("committed session selection accepts only clean completed runs within its window", () => {
  assert.doesNotThrow(() => assertRunInSessionWindow(run, session));
  assert.throws(
    () =>
      assertRunInSessionWindow(
        { ...run, startedAt: "2026-09-28T11:59:59.000Z" },
        session,
      ),
    /outside its committed time window/,
  );
  assert.throws(
    () => assertRunInSessionWindow({ ...run, error: "collector_error" }, session),
    /missing, dirty, failed/,
  );
  assert.throws(
    () => assertRunInSessionWindow({ ...run, gitDirty: true }, session),
    /missing, dirty, failed/,
  );
});
