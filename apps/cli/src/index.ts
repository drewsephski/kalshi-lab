import { createKalshiClient, type KalshiMarket } from "@kalshi-lab/kalshi";

type Command = "balance" | "markets" | "smoke-order";

function readCommand(value: string | undefined): Command {
  if (value === "balance" || value === "markets" || value === "smoke-order") {
    return value;
  }
  throw new Error(
    "Usage: kalshi-lab <balance|markets|smoke-order>. The smoke-order command is the only command that places an order.",
  );
}

function formatMarketLine(market: KalshiMarket): string {
  return `${market.ticker} | ${market.title}${market.status ? ` | ${market.status}` : ""}`;
}

async function runSmokeOrder(): Promise<void> {
  const client = createKalshiClient();
  const markets = await client.getMarkets({ limit: 100 });
  const market = markets
    .filter(
      (candidate) =>
        candidate.ticker.length > 0 &&
        candidate.title.length > 0 &&
        (candidate.status === undefined ||
          candidate.status === "active" ||
          candidate.status === "open"),
    )
    .sort((left, right) => left.ticker.localeCompare(right.ticker))[0];

  if (!market) {
    throw new Error(
      "No suitable open demo market was returned; no order was placed.",
    );
  }

  console.log(`Selected open demo market: ${market.ticker} | ${market.title}`);
  console.log("Placing one post-only YES contract at a 1¢ limit price.");

  let createdOrderId: string | undefined;
  let cancellationAttempted = false;
  try {
    const created = await client.createOrder({
      ticker: market.ticker,
      outcomeSide: "yes",
      action: "buy",
      quantity: 1,
      limitPriceCents: 1,
    });
    createdOrderId = created.orderId;
    console.log(`Created order: ${created.orderId} (${created.clientOrderId})`);

    const retrieved = await client.getOrder(created.orderId);
    console.log(`Retrieved order status: ${retrieved.status}`);

    cancellationAttempted = true;
    await client.cancelOrder(created.orderId, market.ticker);
    const finalOrder = await client.getOrder(created.orderId);
    console.log(`Final order status: ${finalOrder.status}`);
    if (finalOrder.status !== "canceled") {
      throw new Error(
        `Expected the smoke order to be canceled, but Kalshi reports "${finalOrder.status}".`,
      );
    }
  } finally {
    if (createdOrderId && !cancellationAttempted) {
      try {
        await client.cancelOrder(createdOrderId, market.ticker);
        console.error(`Cleanup canceled order ${createdOrderId}.`);
      } catch (cleanupError) {
        const detail =
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError);
        console.error(
          `Cleanup could not cancel order ${createdOrderId}: ${detail}`,
        );
      }
    }
  }
}

async function main(): Promise<void> {
  const command = readCommand(process.argv[2]);
  if (command === "smoke-order") {
    await runSmokeOrder();
    return;
  }

  const client = createKalshiClient();

  if (command === "balance") {
    const balance = await client.getBalance();
    console.log("Kalshi environment: demo");
    console.log(`Balance: $${Number(balance.balanceDollars).toFixed(2)}`);
    return;
  }

  if (command === "markets") {
    const markets = await client.getMarkets({ limit: 20 });
    console.log("Kalshi environment: demo");
    if (markets.length === 0) {
      console.log("No open demo markets returned.");
      return;
    }
    for (const market of markets.slice(0, 10)) {
      console.log(formatMarketLine(market));
    }
    return;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Kalshi CLI failed: ${message}`);
  process.exitCode = 1;
});
