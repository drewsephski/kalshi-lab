import assert from "node:assert/strict";
import test from "node:test";
import { parseSelection } from "./arguments.ts";
const args = [
  "--from",
  "2026-01-01T00:00:00.000Z",
  "--to",
  "2026-01-01T03:00:00.000Z",
];
test("research CLI requires bounded UTC ranges and source-separated filters", () => {
  assert.throws(() => parseSelection([]), /Usage/);
  assert.throws(
    () =>
      parseSelection([
        "--from",
        "2026-01-01T00:00:00-06:00",
        "--to",
        "2026-01-01T03:00:00Z",
      ]),
    /Usage/,
  );
  assert.throws(
    () => parseSelection([...args, "--source", "kalshi_demo"]),
    /production-public/,
  );
  assert.throws(
    () => parseSelection([...args, "--runs", "invalid"]),
    /run selection/,
  );
  assert.throws(() => parseSelection([...args, "--unknown"]));
  assert.throws(() => parseSelection([...args, "--max-rows", "0"]), /maxRows/);
  assert.equal(
    parseSelection([...args, "--tickers", "B,A,B", "--formal"]).formal,
    true,
  );
  assert.deepEqual(
    parseSelection([...args, "--tickers", "B,A,B"]).selection.tickers,
    ["A", "B"],
  );
});
