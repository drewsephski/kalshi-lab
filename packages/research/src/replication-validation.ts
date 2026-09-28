export interface SessionRun {
  id: string;
  gitCommit: string;
  gitDirty: boolean;
  status: string;
  error: string | null;
  startedAt: string;
  stoppedAt: string | null;
}

export function assertRunInSessionWindow(
  run: SessionRun | undefined,
  input: {
    runId: string;
    sessionId: string;
    kind: "trade" | "book";
    collectCommit: string;
    from: string;
    toExclusive: string;
  },
): void {
  const invalidRun = new Error(
    `Session ${input.sessionId} has missing, dirty, failed, or SHA-mismatched ${input.kind} run ${input.runId}.`,
  );
  if (!run) throw invalidRun;
  if (
    run.id !== input.runId ||
    run.gitDirty ||
    run.gitCommit !== input.collectCommit ||
    !(input.kind === "book"
      ? ["completed", "stopped"].includes(run.status)
      : run.status === "completed") ||
    run.error !== null
  )
    throw invalidRun;
  if (run.stoppedAt === null) throw invalidRun;
  const startedAt = Date.parse(run.startedAt),
    stoppedAt = Date.parse(run.stoppedAt),
    from = Date.parse(input.from),
    toExclusive = Date.parse(input.toExclusive);
  if (
    ![startedAt, stoppedAt, from, toExclusive].every(Number.isFinite) ||
    startedAt < from ||
    stoppedAt <= startedAt ||
    stoppedAt > toExclusive
  )
    throw new Error(
      `Session ${input.sessionId} ${input.kind} run ${input.runId} is outside its committed time window.`,
    );
}
