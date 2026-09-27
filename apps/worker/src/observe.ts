import {
  MarketState,
  type MarketDataReader,
  type MarketMetadata,
} from "@kalshi-lab/kalshi";
import { isOpen } from "./universe.ts";
import { errorCode, retry } from "./retry.ts";

/** Verify discovery candidates before fixing the universe for this run. */
export async function observeInitialMarkets(
  reader: MarketDataReader,
  candidates: MarketMetadata[],
  explicit: boolean,
  signal: AbortSignal,
  onUnavailable: (ticker: string, code: string) => void,
): Promise<MarketState[]> {
  const states: MarketState[] = [];
  for (
    let offset = 0;
    offset < candidates.length && !signal.aborted;
    offset += 2
  ) {
    const results = await Promise.allSettled(
      candidates.slice(offset, offset + 2).map(async ({ ticker }) =>
        retry(async () => {
          if (signal.aborted) return null;
          try {
            const market = await reader.getMarket(ticker);
            if (signal.aborted) return null;
            if (market.ticker !== ticker)
              throw new Error("Market response ticker mismatch.");
            if (!isOpen(market, new Date())) {
              if (explicit)
                throw new Error("Explicit market closed during startup.");
              onUnavailable(ticker, "market_no_longer_open");
              return null;
            }
            const state = new MarketState(market, new Date());
            const book = await reader.getOrderbook(ticker);
            if (signal.aborted) return null;
            state.setBook(book, new Date());
            return state;
          } catch (error) {
            if (!explicit && errorCode(error) === "HTTP_404") {
              onUnavailable(ticker, "HTTP_404");
              return null;
            }
            throw error;
          }
        }),
      ),
    );
    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
      if (result.value) states.push(result.value);
    }
  }
  return states;
}
