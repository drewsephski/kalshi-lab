export type KalshiEnvironment = "demo";

export interface KalshiConfig {
  environment: KalshiEnvironment;
  apiKeyId: string;
  privateKeyPath: string;
}

export interface KalshiBalance {
  balanceCents: number;
  balanceDollars: string;
  portfolioValueCents: number;
  updatedAtMs: number;
}

export interface KalshiMarket {
  ticker: string;
  title: string;
  status?: string;
}

export interface KalshiOrder {
  orderId: string;
  clientOrderId: string;
  ticker: string;
  status: string;
  remainingCount: string;
  filledCount: string;
}

export interface CreateOrderInput {
  ticker: string;
  outcomeSide: "yes";
  action: "buy";
  quantity: 1;
  limitPriceCents: number;
}

export interface CreatedOrder {
  orderId: string;
  clientOrderId: string;
  remainingCount: string;
  filledCount: string;
}
