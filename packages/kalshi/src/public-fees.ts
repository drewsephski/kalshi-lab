import { record, text } from "./market-data.ts";

function multiplier(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100
  )
    throw new Error("Invalid fee multiplier.");
  return value.toFixed(4);
}
function optionalType(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return text(value);
}
export interface PublicEventFee {
  eventTicker: string;
  seriesTicker: string;
  feeType: string | null;
  feeMultiplier: string | null;
  rawMetadata: Record<string, unknown>;
}
export interface PublicSeriesFee {
  seriesTicker: string;
  feeType: string | null;
  feeMultiplier: string | null;
  rawMetadata: Record<string, unknown>;
}
export interface PublicEventFeeChange extends PublicEventFee {
  id: string;
  scheduledAt: Date;
}
export interface PublicSeriesFeeChange extends PublicSeriesFee {
  id: string;
  scheduledAt: Date;
}
export function normalizePublicEventFee(value: unknown): PublicEventFee {
  const raw = record(value);
  return {
    eventTicker: text(raw.event_ticker),
    seriesTicker: text(raw.series_ticker),
    feeType: optionalType(raw.fee_type_override),
    feeMultiplier: multiplier(raw.fee_multiplier_override),
    rawMetadata: raw,
  };
}
export function normalizePublicSeriesFee(value: unknown): PublicSeriesFee {
  const raw = record(value);
  return {
    seriesTicker: text(raw.ticker),
    feeType: optionalType(raw.fee_type),
    feeMultiplier: multiplier(raw.fee_multiplier),
    rawMetadata: raw,
  };
}
export function normalizePublicEventFeeChange(
  value: unknown,
): PublicEventFeeChange {
  const raw = record(value);
  const scheduledAt = new Date(text(raw.scheduled_ts));
  if (!Number.isFinite(scheduledAt.getTime()))
    throw new Error("Invalid fee change time.");
  return { ...normalizePublicEventFee(raw), id: text(raw.id), scheduledAt };
}
export function normalizePublicSeriesFeeChange(
  value: unknown,
): PublicSeriesFeeChange {
  const raw = record(value);
  const scheduledAt = new Date(text(raw.scheduled_ts));
  if (!Number.isFinite(scheduledAt.getTime()))
    throw new Error("Invalid series fee change time.");
  return {
    ...normalizePublicSeriesFee({
      ...raw,
      ticker: raw.series_ticker,
    }),
    id: text(raw.id),
    scheduledAt,
  };
}
