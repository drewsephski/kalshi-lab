import assert from "node:assert/strict";
import test from "node:test";
import { KalshiPublicMarketDataClient } from "@kalshi-lab/kalshi";
import { fetchTradeWindow } from "./trades.ts";

const row = (id: string, second: number) => ({
  trade_id: id,
  ticker: "T",
  count_fp: "1.00",
  yes_price_dollars: "0.4000",
  no_price_dollars: "0.6000",
  taker_outcome_side: "no",
  taker_book_side: "ask",
  is_block_trade: false,
  created_time: new Date(1_000_000 + second * 1000).toISOString(),
});
test("paged trade retrieval deduplicates IDs and returns timestamp order", async () => {
  const requests: URL[] = [];
  const client = new KalshiPublicMarketDataClient({
    fetch: async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      return Response.json(
        requests.length === 1
          ? { trades: [row("b", 2), row("a", 1)], cursor: "next" }
          : { trades: [row("a", 1), row("c", 0)], cursor: "" },
      );
    },
  });
  const trades = await fetchTradeWindow(client, "T", 999);
  assert.deepEqual(
    trades.map((t) => t.tradeId),
    ["c", "a", "b"],
  );
  assert.equal(requests[1]!.searchParams.get("cursor"), "next");
  assert.equal(requests[1]!.searchParams.get("min_ts"), "999");
});
test("repeating cursor is a continuity failure", async () => {
  const client = new KalshiPublicMarketDataClient({
    fetch: async () => Response.json({ trades: [row("a", 1)], cursor: "loop" }),
  });
  await assert.rejects(
    () => fetchTradeWindow(client, "T", 0),
    /Repeated trade cursor/,
  );
});
