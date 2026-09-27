import assert from "node:assert/strict";
import { constants, generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";
import { buildPresignText, signRequest } from "./auth.ts";
import { parseKalshiConfig } from "./config.ts";
import { generateClientOrderId, KalshiClient } from "./client.ts";

test("builds the Kalshi pre-sign text with an uppercase method", () => {
  assert.equal(
    buildPresignText("1715793600123", "get", "/trade-api/v2/portfolio/balance"),
    "1715793600123GET/trade-api/v2/portfolio/balance",
  );
});

test("removes query parameters from the path before signing", () => {
  assert.equal(
    buildPresignText(
      1715793600123,
      "GET",
      "/trade-api/v2/portfolio/orders?limit=5",
    ),
    "1715793600123GET/trade-api/v2/portfolio/orders",
  );
});

test("creates signatures compatible with Ed25519 and RSA-PSS verification", () => {
  const message = Buffer.from("123GET/trade-api/v2/portfolio/balance");
  const ed25519 = generateKeyPairSync("ed25519");
  const edSignature = Buffer.from(
    signRequest(
      ed25519.privateKey,
      "123",
      "GET",
      "/trade-api/v2/portfolio/balance",
    ),
    "base64",
  );
  assert.equal(verify(null, message, ed25519.publicKey, edSignature), true);

  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const rsaSignature = Buffer.from(
    signRequest(
      rsa.privateKey,
      "123",
      "GET",
      "/trade-api/v2/portfolio/balance",
    ),
    "base64",
  );
  assert.equal(
    verify(
      "RSA-SHA256",
      message,
      {
        key: rsa.publicKey,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
      },
      rsaSignature,
    ),
    true,
  );
});

test("requires demo environment and both credential fields", () => {
  assert.throws(() => parseKalshiConfig({}), /KALSHI_ENV must be set/);
  assert.throws(
    () => parseKalshiConfig({ KALSHI_ENV: "production" }),
    /KALSHI_ENV must be set/,
  );
  assert.throws(
    () =>
      parseKalshiConfig({ KALSHI_ENV: "demo", KALSHI_API_KEY_ID: "key-id" }),
    /KALSHI_PRIVATE_KEY_PATH is required/,
  );
  assert.throws(
    () =>
      parseKalshiConfig({
        KALSHI_ENV: "demo",
        KALSHI_PRIVATE_KEY_PATH: ".secrets/key.pem",
      }),
    /KALSHI_API_KEY_ID is required/,
  );
  assert.deepEqual(
    parseKalshiConfig({
      KALSHI_ENV: "demo",
      KALSHI_API_KEY_ID: "demo-key",
      KALSHI_PRIVATE_KEY_PATH: ".secrets/key.pem",
    }),
    {
      environment: "demo",
      apiKeyId: "demo-key",
      privateKeyPath: ".secrets/key.pem",
    },
  );
});

test("generates unique UUID client order IDs", () => {
  const first = generateClientOrderId();
  const second = generateClientOrderId();
  assert.match(first, /^[0-9a-f-]{36}$/i);
  assert.notEqual(first, second);
});

test("signs only the fixed demo origin request pathname", async () => {
  const keyPair = generateKeyPairSync("ed25519");
  let requestedUrl: URL | undefined;
  let requestedInit: RequestInit | undefined;
  const client = new KalshiClient(
    {
      environment: "demo",
      apiKeyId: "demo-key-id",
      privateKeyPath: "unused-with-injected-key",
    },
    {
      privateKey: keyPair.privateKey,
      now: () => 1_715_793_600_123,
      fetch: async (input, init) => {
        requestedUrl = new URL(input.toString());
        requestedInit = init;
        return new Response(JSON.stringify({ markets: [] }), { status: 200 });
      },
    },
  );

  await client.getMarkets({ limit: 5 });

  assert.equal(requestedUrl?.origin, "https://external-api.demo.kalshi.co");
  assert.equal(requestedUrl?.pathname, "/trade-api/v2/markets");
  assert.equal(requestedUrl?.search, "?status=open&limit=5");
  assert.equal(requestedInit?.redirect, "error");
  const headers = new Headers(requestedInit?.headers);
  const signature = Buffer.from(
    headers.get("KALSHI-ACCESS-SIGNATURE") ?? "",
    "base64",
  );
  assert.equal(
    verify(
      null,
      Buffer.from("1715793600123GET/trade-api/v2/markets"),
      keyPair.publicKey,
      signature,
    ),
    true,
  );
});

test("builds a bounded one-contract, post-only demo order request", async () => {
  const keyPair = generateKeyPairSync("ed25519");
  let requestBody = "";
  let requestedUrl = "";
  const client = new KalshiClient(
    { environment: "demo", apiKeyId: "demo-key-id", privateKeyPath: "unused" },
    {
      privateKey: keyPair.privateKey,
      newClientOrderId: () => "stable-test-order-id",
      fetch: async (input, init) => {
        requestedUrl = input.toString();
        requestBody = String(init?.body ?? "");
        return new Response(
          JSON.stringify({
            order_id: "kalshi-order-id",
            client_order_id: "stable-test-order-id",
            fill_count: "0.00",
            remaining_count: "1.00",
          }),
          { status: 201 },
        );
      },
    },
  );

  const created = await client.createOrder({
    ticker: "DEMO-MARKET",
    outcomeSide: "yes",
    action: "buy",
    quantity: 1,
    limitPriceCents: 1,
  });
  const payload: unknown = JSON.parse(requestBody);
  assert.deepEqual(payload, {
    ticker: "DEMO-MARKET",
    client_order_id: "stable-test-order-id",
    side: "bid",
    count: "1.00",
    price: "0.0100",
    time_in_force: "good_till_canceled",
    self_trade_prevention_type: "taker_at_cross",
    post_only: true,
    cancel_order_on_pause: true,
  });
  assert.equal(
    requestedUrl,
    "https://external-api.demo.kalshi.co/trade-api/v2/portfolio/events/orders",
  );
  assert.equal(created.orderId, "kalshi-order-id");
  await assert.rejects(
    client.createOrder({
      ticker: "DEMO-MARKET",
      outcomeSide: "yes",
      action: "buy",
      quantity: 2,
      limitPriceCents: 1,
    } as never),
    /exactly 1 contract/,
  );
});
