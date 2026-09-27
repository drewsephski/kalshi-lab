import { complement, count, decimal, units } from "./decimal.ts";
import type { MarketMessage } from "./messages.ts";
import type {
  Level,
  MarketMetadata,
  MarketQuote,
  Orderbook,
} from "./market-data.ts";

export class MarketState {
  market: MarketMetadata;
  quote: MarketQuote;
  tickerReceivedAt: Date;
  metadataReceivedAt: Date;
  bookReceivedAt: Date | null = null;
  bookVerifiedAt: Date | null = null;
  eventAt: Date | null = null;
  lastTrade: Record<string, unknown> | null = null;
  private book: { yes: Map<string, string>; no: Map<string, string> } | null =
    null;
  private readonly tradeIds = new Set<string>();

  constructor(market: MarketMetadata, receivedAt: Date) {
    this.market = market;
    this.quote = { ...market };
    this.tickerReceivedAt = receivedAt;
    this.metadataReceivedAt = receivedAt;
  }
  refreshMarket(market: MarketMetadata, receivedAt: Date): void {
    this.market = market;
    this.quote = { ...market };
    this.tickerReceivedAt = receivedAt;
    this.metadataReceivedAt = receivedAt;
  }
  setBook(book: Orderbook, receivedAt: Date): void {
    this.book = { yes: new Map(book.yes), no: new Map(book.no) };
    this.bookReceivedAt = receivedAt;
    this.bookVerifiedAt = receivedAt;
  }
  invalidateBook(): void {
    this.book = null;
    this.bookReceivedAt = null;
    this.bookVerifiedAt = null;
  }
  /** false means incremental state is unsafe; reconnect for a new snapshot. */
  apply(event: MarketMessage, receivedAt: Date): boolean {
    if (event.ticker !== this.market.ticker) return true;
    if (event.type === "ticker") {
      if (event.eventAt && this.eventAt && event.eventAt < this.eventAt)
        return true;
      this.quote = event.quote;
      this.tickerReceivedAt = receivedAt;
      this.eventAt = event.eventAt;
    } else if (event.type === "orderbook_snapshot") {
      this.setBook(event.book, receivedAt);
    } else if (event.type === "orderbook_delta") {
      if (!this.book) return false;
      const side = this.book[event.side];
      const size = units(side.get(event.price) ?? "0.00", 2) + event.delta;
      if (size < 0n || size >= 10n ** 24n) {
        this.invalidateBook();
        return false;
      }
      if (size === 0n) side.delete(event.price);
      else side.set(event.price, count(decimal(size, 2)));
      this.bookReceivedAt = receivedAt;
    } else {
      if (this.tradeIds.has(event.tradeId)) return true;
      this.tradeIds.add(event.tradeId);
      if (this.tradeIds.size > 1000)
        this.tradeIds.delete(this.tradeIds.values().next().value!);
      this.lastTrade = {
        id: event.tradeId,
        yesPrice: event.price,
        quantity: event.quantity,
        takerSide: event.takerSide,
        eventAt: event.eventAt?.toISOString() ?? null,
        receivedAt: receivedAt.toISOString(),
      };
    }
    return true;
  }
  currentBook(): Orderbook | null {
    if (!this.book) return null;
    const sort = (side: Map<string, string>): Level[] =>
      [...side].sort((a, b) => b[0].localeCompare(a[0]));
    return { yes: sort(this.book.yes), no: sort(this.book.no) };
  }
  executableQuote(): MarketQuote & {
    noBidSize: string | null;
    noAskSize: string | null;
  } {
    const book = this.currentBook();
    if (!book)
      return {
        ...this.quote,
        yesBid: null,
        yesAsk: null,
        noBid: null,
        noAsk: null,
        yesBidSize: null,
        yesAskSize: null,
        noBidSize: null,
        noAskSize: null,
      };
    const yes = book.yes[0];
    const no = book.no[0];
    return {
      ...this.quote,
      yesBid: yes?.[0] ?? null,
      noBid: no?.[0] ?? null,
      yesAsk: complement(no?.[0] ?? null),
      noAsk: complement(yes?.[0] ?? null),
      yesBidSize: yes?.[1] ?? null,
      noAskSize: yes?.[1] ?? null,
      noBidSize: no?.[1] ?? null,
      yesAskSize: no?.[1] ?? null,
    };
  }
}
