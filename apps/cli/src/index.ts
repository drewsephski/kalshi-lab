import { createKalshiClient, type KalshiMarket } from "@kalshi-lab/kalshi";

import { runSmokeOrder } from "./smoke-order.ts";

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

async function main(): Promise<void> {
  const command = readCommand(process.argv[2]);
  if (command === "smoke-order") {
    await runSmokeOrder(createKalshiClient());
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
