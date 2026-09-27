import type { RecorderStore, RunHealth, SnapshotInput } from "@kalshi-lab/db";

/** Bounded FIFO. Retries retain IDs, timestamps, and values captured before I/O. */
export class SnapshotQueue {
  private readonly batches: SnapshotInput[][] = [];
  droppedSnapshots = 0;
  snapshotsWritten = 0;
  lastSuccessfulObservationAt: Date | null = null;
  private readonly capacity: number;
  constructor(capacity = 12) {
    this.capacity = capacity;
  }
  get pendingBatches(): number {
    return this.batches.length;
  }
  enqueue(batch: SnapshotInput[]): void {
    if (!batch.length) return;
    if (this.batches.length === this.capacity)
      this.droppedSnapshots += this.batches.shift()!.length;
    this.batches.push(batch);
  }
  async flush(
    store: Pick<RecorderStore, "writeSnapshots">,
    runId: string,
    health: RunHealth,
  ): Promise<void> {
    while (this.batches.length) {
      const batch = this.batches[0]!;
      const inserted = await store.writeSnapshots(runId, batch, {
        ...health,
        droppedSnapshots: this.droppedSnapshots,
      });
      this.snapshotsWritten += inserted;
      this.lastSuccessfulObservationAt = batch.reduce<Date | null>(
        (latest, row) =>
          !latest || row.observedAt > latest ? row.observedAt : latest,
        this.lastSuccessfulObservationAt,
      );
      this.batches.shift();
    }
  }
}
