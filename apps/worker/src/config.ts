export interface RecorderConfig {
  source: "demo" | "production_public";
  maxMarkets: number;
  tickers: string[];
  snapshotIntervalMs: number;
  staleMs: number;
}
function integer(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max)
    throw new Error(`Invalid ${name}.`);
  return parsed;
}
export function readRecorderConfig(
  env: NodeJS.ProcessEnv = process.env,
): RecorderConfig {
  const source = env.KALSHI_RECORDER_SOURCE ?? "demo";
  if (source !== "demo" && source !== "production_public")
    throw new Error(
      "KALSHI_RECORDER_SOURCE must be demo or production_public.",
    );
  const maxMarkets = integer(
    env.KALSHI_RECORDER_MAX_MARKETS,
    25,
    1,
    100,
    "KALSHI_RECORDER_MAX_MARKETS",
  );
  const snapshotIntervalMs = integer(
    env.MARKET_SNAPSHOT_INTERVAL_MS,
    5000,
    1000,
    3_600_000,
    "MARKET_SNAPSHOT_INTERVAL_MS",
  );
  const tickers = [
    ...new Set(
      (env.KALSHI_TRACK_TICKERS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ].sort();
  if (
    tickers.length > maxMarkets ||
    tickers.some((ticker) => !/^[A-Za-z0-9._-]+$/.test(ticker))
  )
    throw new Error(
      "Explicit tickers must be valid and fit KALSHI_RECORDER_MAX_MARKETS.",
    );
  return {
    source,
    maxMarkets,
    tickers,
    snapshotIntervalMs,
    staleMs: integer(
      env.MARKET_DATA_STALE_MS,
      Math.max(120_000, snapshotIntervalMs * 2),
      snapshotIntervalMs,
      7_200_000,
      "MARKET_DATA_STALE_MS",
    ),
  };
}
