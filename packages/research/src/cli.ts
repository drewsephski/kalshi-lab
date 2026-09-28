import { parseSelection } from "./arguments.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createDatabase } from "@kalshi-lab/db";
import { queryResearch } from "./queries.ts";
import {
  consoleSummary,
  createAnalysis,
  gitProvenance,
  verdict,
} from "./report.ts";
import { DEFAULT_OPTIONS } from "./microstructure.ts";

async function main() {
  const { selection, options, output, formal } = parseSelection(
    process.argv.slice(2),
  );
  const git = gitProvenance();
  if (formal && git.gitDirty)
    throw new Error("Formal analysis requires a clean working tree.");
  if (formal && JSON.stringify(options) !== JSON.stringify(DEFAULT_OPTIONS))
    throw new Error(
      "EXP-002 formal analysis requires the predefined timing options.",
    );
  const analysis = createAnalysis(options);
  const database = createDatabase();
  try {
    const dataset = await queryResearch(
      database.db,
      selection,
      analysis.consume,
    );
    if (
      formal &&
      dataset.runs.some(
        (r) =>
          r.status === "running" ||
          r.gitDirty ||
          r.config.snapshotIntervalMs !== options.cadenceMs ||
          r.config.once !== false,
      )
    )
      throw new Error(
        "Formal EXP-002 requires stopped clean-SHA continuous runs at the predefined cadence.",
      );
    const result = analysis.finish();
    if (result.total !== dataset.selectedRows)
      throw new Error("Row reconciliation failed.");
    if (formal && JSON.stringify(gitProvenance()) !== JSON.stringify(git))
      throw new Error("Git state changed during formal analysis.");
    const report = {
      generatedAt: new Date().toISOString(),
      provenance: {
        ...git,
        formal,
        source: selection.source,
        window: {
          from: selection.from.toISOString(),
          toExclusive: selection.to.toISOString(),
        },
        requestedRunIds: selection.runIds,
        requestedTickers: selection.tickers,
        maxRows: selection.maxRows,
        firstObservation: dataset.firstObservation,
        lastObservation: dataset.lastObservation,
        datasetSha256: dataset.datasetSha256,
        runs: dataset.runs,
      },
      ...result,
      decision: verdict(result),
    };
    console.log(
      `Window: ${selection.from.toISOString()} → ${selection.to.toISOString()} (exclusive)\nRuns: ${dataset.runs.map((r) => r.id).join(", ")}\nSHA: ${git.gitCommit} | dirty: ${git.gitDirty}\n${consoleSummary(result)}`,
    );
    if (output) {
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, {
        flag: "wx",
      });
    }
  } finally {
    await database.close();
  }
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Research failed.");
  process.exitCode = 1;
});
