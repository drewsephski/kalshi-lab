import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  normalizeMarket,
  normalizeOrderbook,
  normalizeQuote,
} from "./market-data.ts";
import { complement, units } from "./decimal.ts";
import { KalshiPublicMarketDataClient } from "./public-client.ts";
import { KalshiClient } from "./client.ts";
import { MarketState } from "./market-state.ts";
import { parseMarketMessage, SequenceTracker } from "./messages.ts";
import { reconnectDelay } from "./stream.ts";

const market = {
  ticker: "TEST",
  yes_sub_title: "Fallback title",
  status: "active",
  yes_bid_dollars: "0.1234",
  yes_ask_dollars: "0.9000",
  volume_fp: "9007199254740993.01",
  open_interest_fp: "100.00",
};

test("normalizes current fixed-point fields exactly and preserves optional metadata", () => {
  const result = normalizeMarket(market);
  assert.equal(result.title, "Fallback title");
  assert.equal(result.yesBid, "0.1234");
  assert.equal(result.noAsk, "0.8766");
  assert.equal(result.noBid, "0.1000");
  assert.equal(result.volume, "9007199254740993.01");
  assert.equal(result.closeTime, null);
  assert.equal(complement("0.9999"), "0.0001");
  assert.equal(units(result.volume, 2), 900719925474099301n);
  for (const value of [0.5, "NaN", "1.0001", "0.12345", "-0.01"])
    assert.throws(() => normalizeQuote({ yes_bid_dollars: value }));
});

test("normalizes books best first, removes zero levels, and handles empty sides", () => {
  assert.deepEqual(
    normalizeOrderbook({
      orderbook_fp: {
        yes_dollars: [
          ["0.1200", "1.00"],
          ["0.9000", "2.50"],
          ["0.5000", "0.00"],
        ],
        no_dollars: null,
      },
    }),
    {
      yes: [
        ["0.9000", "2.50"],
        ["0.1200", "1.00"],
      ],
      no: [],
    },
  );
  assert.throws(() => normalizeOrderbook({ orderbook: {} }));
});

test("public client sends only unsigned GETs to its fixed origin", async () => {
  const calls: string[] = [];
  const client = new KalshiPublicMarketDataClient({
    fetch: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "https://external-api.kalshi.com");
      assert.equal(init?.method, "GET");
      assert.equal(init?.headers, undefined);
      assert.equal(init?.body, undefined);
      assert.equal(init?.redirect, "error");
      calls.push(url.pathname);
      return Response.json(
        url.pathname.endsWith("orderbook")
          ? { orderbook_fp: { yes_dollars: [], no_dollars: [] } }
          : url.pathname.endsWith("/TEST")
            ? { market }
            : { markets: [market], cursor: "next" },
      );
    },
  });
  assert.equal((await client.listMarkets()).cursor, "next");
  await client.getMarket("TEST");
  await client.getOrderbook("TEST");
  assert.equal(calls.length, 3);
  assert.equal("createOrder" in client, false);
  assert.equal("cancelOrder" in client, false);
  assert.throws(
    () => new KalshiPublicMarketDataClient({ apiKeyId: "forbidden" } as never),
    /no credentials/,
  );
});

test("demo market data remains signed and cannot be switched to production", async () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const config = {
    environment: "demo" as const,
    apiKeyId: "test",
    privateKeyPath: "unused",
  };
  const client = new KalshiClient(config, {
    privateKey,
    fetch: async (url, init) => {
      assert.equal(
        new URL(String(url)).origin,
        "https://external-api.demo.kalshi.co",
      );
      assert.ok(new Headers(init?.headers).get("KALSHI-ACCESS-SIGNATURE"));
      return Response.json({ markets: [market] });
    },
  });
  await client.listMarkets();
  assert.equal(client.source, "kalshi_demo");
  assert.throws(
    () =>
      new KalshiClient({ ...config, environment: "production" } as never, {
        privateKey,
      }),
    /demo/,
  );
});

test("malformed and unknown socket messages do not throw; unsafe books are marked", () => {
  for (const input of ["{", "null", "[]", '{"type":"ticker","msg":{}}'])
    assert.equal(parseMarketMessage(input).kind, "malformed");
  assert.deepEqual(parseMarketMessage('{"type":"future_channel","msg":null}'), {
    kind: "ignored",
  });
  assert.deepEqual(parseMarketMessage('{"type":"orderbook_delta","msg":{}}'), {
    kind: "malformed",
    bookUnsafe: true,
  });
  assert.equal(
    parseMarketMessage(
      JSON.stringify({
        type: "ticker",
        msg: {
          ...market,
          market_ticker: "TEST",
          price_dollars: "0.4000",
          ts_ms: 1234,
        },
      }),
    ).kind,
    "event",
  );
});

test("sequence handling is per subscription and rejects duplicates and gaps", () => {
  const sequences = new SequenceTracker();
  assert.equal(sequences.accept(1, 2), "accept");
  assert.equal(sequences.accept(2, 40), "accept");
  assert.equal(sequences.accept(1, 2), "duplicate");
  assert.equal(sequences.accept(1, 3), "accept");
  assert.equal(sequences.accept(1, 5), "gap");
});

test("book deltas preserve exact sizes, derive executable asks, and invalidate underflow", () => {
  const state = new MarketState(normalizeMarket(market), new Date(0));
  assert.equal(state.executableQuote().yesBid, null);
  state.setBook(
    { yes: [["0.1234", "1.00"]], no: [["0.8765", "2.00"]] },
    new Date(1),
  );
  assert.equal(state.executableQuote().yesAsk, "0.1235");
  assert.equal(state.executableQuote().yesAskSize, "2.00");
  assert.equal(
    state.apply(
      {
        type: "orderbook_delta",
        ticker: "TEST",
        side: "yes",
        price: "0.1234",
        delta: 25n,
        sid: 1,
        seq: 1,
        eventAt: null,
      },
      new Date(2),
    ),
    true,
  );
  assert.equal(state.executableQuote().yesBidSize, "1.25");
  assert.equal(
    state.apply(
      {
        type: "orderbook_delta",
        ticker: "TEST",
        side: "yes",
        price: "0.1234",
        delta: -126n,
        sid: 1,
        seq: 2,
        eventAt: null,
      },
      new Date(3),
    ),
    false,
  );
  assert.equal(state.currentBook(), null);
});

test("reconnect backoff grows and stays bounded", () => {
  assert.equal(
    reconnectDelay(0, () => 1),
    1000,
  );
  assert.equal(
    reconnectDelay(3, () => 1),
    8000,
  );
  assert.equal(
    reconnectDelay(100, () => 1),
    30_000,
  );
  assert.ok(reconnectDelay(0, () => 0) >= 800);
});
