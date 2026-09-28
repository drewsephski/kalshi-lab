import { fixed } from "../spread.ts";
import type { Identity, MakerObservation, Sample } from "./types.ts";
export const GAP_MS = 7500;
export const HOLD_MS = 60000;
export function identify(ticker: string, eventTicker: string | null): Identity {
  // Player/line suffixes are deliberately dropped. No guessed mapping for
  // unsupported formats: unknown families cannot satisfy independence gates.
  const sport = eventTicker?.match(
    /^KX(NFL|MLB|NBA|WNBA|NHL|NCAAF|ATPMATCH|WTAMATCH|UEFANL|CANPL|LALIGA)[A-Z0-9]*-(\d{2}[A-Z]{3}\d{2}(?:\d{4})?[A-Z]+)(?:-|$)/,
  );
  // Frozen before evaluation output, checked against public event metadata.
  // Merge hourly/threshold variants into a city-day; merge all Trump speech
  // windows into one speaker exposure because daily and weekly events overlap.
  const weather = eventTicker?.match(
    /^KXTEMP(CHI|LAX|MIA|NYC)HS?-(\d{2}[A-Z]{3}\d{2})\d{2}$/,
  );
  const mentions = /^KXTRUMP(?:MENTION|SAY)-/.test(eventTicker ?? "");
  return {
    ticker,
    eventTicker,
    family: sport
      ? `${sport[1]}:${sport[2]}`
      : weather
        ? `temperature:${weather[1]}:${weather[2]}`
        : mentions
          ? "mentions:TRUMP"
          : null,
    category: sport
      ? "Sports"
      : weather
        ? "Climate and Weather"
        : mentions
          ? "Mentions"
          : null,
  };
}
export function prepareMaker(input: readonly MakerObservation[]) {
  const rows = [...input].sort(
    (a, b) =>
      a.observedAt.getTime() - b.observedAt.getTime() ||
      a.id.localeCompare(b.id),
  );
  const samples: (Sample | null)[] = [];
  const exclusions: Record<string, number> = {};
  let previous: MakerObservation | undefined,
    segment = 0;
  for (const r of rows) {
    const time = r.observedAt.getTime();
    let reason: string | null = null;
    const bookTime = r.bookReceivedAt?.getTime(),
      tickerTime = r.tickerReceivedAt?.getTime();
    if (!Number.isFinite(time)) throw new Error("Invalid observation time.");
    if (
      !previous ||
      previous.workerRunId !== r.workerRunId ||
      time - previous.observedAt.getTime() > GAP_MS
    )
      segment++;
    if (r.stale) reason = "stale";
    else if (!r.connected) reason = "disconnected";
    else if (!["open", "active"].includes(r.status)) reason = "closed";
    else if (
      bookTime === undefined ||
      tickerTime === undefined ||
      !Number.isFinite(bookTime) ||
      !Number.isFinite(tickerTime) ||
      bookTime > time ||
      tickerTime > time ||
      time - bookTime > GAP_MS ||
      time - tickerTime > GAP_MS
    )
      reason = "receipt_not_fresh";
    else if (
      previous?.workerRunId === r.workerRunId &&
      previous.observedAt.getTime() === time
    )
      reason = "duplicate";
    else {
      try {
        const bid = fixed(r.yesBid, 4),
          ask = fixed(r.yesAsk, 4),
          bidSize = fixed(r.yesBidSize, 2),
          askSize = fixed(r.yesAskSize, 2);
        if (
          bid > ask ||
          ask > 10000n ||
          bidSize <= 0n ||
          askSize <= 0n ||
          bidSize >= 10n ** 24n ||
          askSize >= 10n ** 24n
        )
          throw new Error("Invalid quote.");
        const volume = r.volume === null ? null : fixed(r.volume, 2);
        samples.push({
          id: r.id,
          run: r.workerRunId,
          time,
          segment,
          bookTime,
          tickerTime,
          bid,
          ask,
          bidSize,
          askSize,
          volume,
          raw: r,
        });
      } catch {
        reason = "missing_or_invalid_quote";
      }
    }
    if (reason) {
      exclusions[reason] = (exclusions[reason] ?? 0) + 1;
      samples.push(null);
      segment++;
    }
    previous = r;
  }
  return {
    samples,
    exclusions,
    total: rows.length,
    eligible: samples.filter(Boolean).length,
  };
}
export function qualifies(s: Sample): boolean {
  return (
    s.ask - s.bid >= 200n &&
    s.bidSize >= 1000n &&
    s.askSize >= 1000n &&
    s.bid % 100n === 0n &&
    s.ask % 100n === 0n &&
    s.bid > 0n &&
    s.ask < 10000n
  );
}
