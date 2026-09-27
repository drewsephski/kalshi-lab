import { execFileSync } from "node:child_process";
import {
  createKalshiClient,
  KalshiPublicMarketDataClient,
} from "@kalshi-lab/kalshi";
import { createDatabase, createRecorderStore } from "@kalshi-lab/db";
import { readRecorderConfig } from "./config.ts";
import { recordMarkets } from "./recorder.ts";
import { errorCode } from "./retry.ts";
import { installShutdownHandlers } from "./shutdown.ts";

async function main(): Promise<void> {
  if (process.argv.slice(2).some((arg) => arg !== "--once"))
    throw new Error("Usage: worker [--once].");
  const config = readRecorderConfig();
  const reader =
    config.source === "demo"
      ? createKalshiClient()
      : new KalshiPublicMarketDataClient();
  const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const gitDirty = Boolean(
    execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(),
  );
  const controller = new AbortController();
  const removeSignalHandlers = installShutdownHandlers(controller);
  const database = createDatabase();
  try {
    await recordMarkets({
      reader,
      store: createRecorderStore(database.db),
      config,
      signal: controller.signal,
      once: process.argv.includes("--once"),
      gitCommit,
      gitDirty,
      log: (event, fields) =>
        console.log(
          JSON.stringify({ at: new Date().toISOString(), event, ...fields }),
        ),
    });
  } finally {
    await database.close();
    removeSignalHandlers();
  }
}
main().catch((error: unknown) => {
  console.error(
    JSON.stringify({ event: "worker_failed", code: errorCode(error) }),
  );
  process.exitCode = 1;
});
