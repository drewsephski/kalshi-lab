import assert from "node:assert/strict";
import test from "node:test";
import { KalshiPublicMarketDataClient } from "./public-client.ts";
import { normalizePublicTrade } from "./public-trades.ts";

const raw = {
  trade_id: "id-1",
  ticker: "TEST",
  count_fp: "2.50",
  yes_price_dollars: "0.4000",
  no_price_dollars: "0.6000",
  taker_outcome_side: "no",
  taker_book_side: "ask",
  created_time: "2026-09-28T14:00:00.123456Z",
  is_block_trade: false,
};
test("trade normalization preserves fixed point, ID and explicit provider direction", () => {
  const trade = normalizePublicTrade(raw);
  assert.equal(trade.tradeId, "id-1");
  assert.equal(trade.quantity, "2.50");
  assert.equal(trade.aggressorSide, "no_buy");
  assert.equal(trade.aggressorProvenance, "provider_explicit");
  assert.equal(
    normalizePublicTrade({ ...raw, taker_book_side: "bid" }).aggressorSide,
    "unknown",
  );
  assert.equal(
    normalizePublicTrade({ ...raw, taker_outcome_side: undefined })
      .aggressorSide,
    "unknown",
  );
  assert.throws(
    () => normalizePublicTrade({ ...raw, count_fp: "0.00" }),
    /positive/,
  );
  assert.throws(
    () => normalizePublicTrade({ ...raw, no_price_dollars: "0.5900" }),
    /complements/,
  );
});
test("trade pagination keeps unsigned GET, explicit query filters and descending order", async () => {
  const calls: URL[] = [];
  const client = new KalshiPublicMarketDataClient({
    fetch: async (input, init) => {
      const url = new URL(String(input));
      calls.push(url);
      assert.equal(init?.method, "GET");
      assert.equal(init?.headers, undefined);
      assert.equal(init?.redirect, "error");
      return Response.json({
        trades: [raw],
        cursor: calls.length === 1 ? "next" : "",
      });
    },
  });
  const first = await client.listTrades({
    ticker: "TEST",
    minTs: 123,
    isBlockTrade: false,
  });
  assert.equal(first.cursor, "next");
  await client.listTrades({
    ticker: "TEST",
    minTs: 123,
    cursor: first.cursor!,
  });
  assert.equal(calls[0]!.pathname, "/trade-api/v2/markets/trades");
  assert.equal(calls[0]!.searchParams.get("min_ts"), "123");
  assert.equal(calls[1]!.searchParams.get("cursor"), "next");
  await assert.rejects(
    () => client.listTrades({ ticker: "TEST", limit: 1001 }),
    /page size/,
  );
});
