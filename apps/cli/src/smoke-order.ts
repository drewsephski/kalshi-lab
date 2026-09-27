import type { KalshiClient } from "@kalshi-lab/kalshi";

export async function runSmokeOrder(
  client: Pick<
    KalshiClient,
    "getMarkets" | "createOrder" | "getOrder" | "cancelOrder"
  >,
): Promise<void> {
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
  let cancellationSucceeded = false;
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

    await client.cancelOrder(created.orderId, market.ticker);
    cancellationSucceeded = true;
    const finalOrder = await client.getOrder(created.orderId);
    console.log(`Final order status: ${finalOrder.status}`);
    if (finalOrder.status !== "canceled") {
      throw new Error(
        `Expected the smoke order to be canceled, but Kalshi reports "${finalOrder.status}".`,
      );
    }
  } finally {
    if (createdOrderId && !cancellationSucceeded) {
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
