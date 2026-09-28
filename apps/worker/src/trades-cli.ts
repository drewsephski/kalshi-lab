import { execFileSync } from "node:child_process";
import { KalshiPublicMarketDataClient } from "@kalshi-lab/kalshi";
import { createDatabase } from "@kalshi-lab/db";
import { installShutdownHandlers } from "./shutdown.ts";
import { collectTrades } from "./trades.ts";

const args = process.argv.slice(2);
if (
  args.length &&
  !(args.length === 1 && args[0] === "--once") &&
  !(
    args.length === 2 &&
    args[0] === "--duration-minutes" &&
    /^\d+$/.test(args[1]!)
  )
)
  throw new Error("Usage: worker:trades [--once | --duration-minutes N]");
const minutes = args[0] === "--duration-minutes" ? Number(args[1]) : null;
if (
  minutes !== null &&
  (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 120)
)
  throw new Error("Duration must be 1..120 minutes.");
const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const gitDirty = Boolean(
  execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(),
);
const controller = new AbortController();
const remove = installShutdownHandlers(controller);
const database = createDatabase();
try {
  await collectTrades({
    reader: new KalshiPublicMarketDataClient(),
    db: database.db,
    signal: controller.signal,
    once: args.includes("--once"),
    durationMs: minutes === null ? null : minutes * 60_000,
    gitCommit,
    gitDirty,
    log: (event, fields) =>
      console.log(
        JSON.stringify({ at: new Date().toISOString(), event, ...fields }),
      ),
  });
} finally {
  remove();
  await database.close();
}
