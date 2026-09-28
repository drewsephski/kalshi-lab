import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePublicEventFee,
  normalizePublicEventFeeChange,
  normalizePublicSeriesFee,
  normalizePublicSeriesFeeChange,
} from "./public-fees.ts";

test("public event, series and dated fee changes retain exact source metadata", () => {
  const event = normalizePublicEventFee({
    event_ticker: "E",
    series_ticker: "S",
    fee_type_override: null,
    fee_multiplier_override: null,
  });
  assert.equal(event.feeType, null);
  assert.equal(event.feeMultiplier, null);
  const series = normalizePublicSeriesFee({
    ticker: "S",
    fee_type: "quadratic",
    fee_multiplier: 1,
  });
  assert.equal(series.feeMultiplier, "1.0000");
  const seriesChange = normalizePublicSeriesFeeChange({
    id: "series-change",
    series_ticker: "S",
    fee_type: "quadratic_with_maker_fees",
    fee_multiplier: 0.5,
    scheduled_ts: "2026-09-28T14:00:00Z",
  });
  assert.equal(seriesChange.feeType, "quadratic_with_maker_fees");
  assert.equal(seriesChange.feeMultiplier, "0.5000");
  assert.equal(seriesChange.scheduledAt.toISOString(), "2026-09-28T14:00:00.000Z");
  const change = normalizePublicEventFeeChange({
    id: "id",
    event_ticker: "E",
    series_ticker: "S",
    fee_type_override: "quadratic",
    fee_multiplier_override: 0.5,
    scheduled_ts: "2026-09-28T14:00:00Z",
  });
  assert.equal(change.scheduledAt.toISOString(), "2026-09-28T14:00:00.000Z");
  assert.equal(change.feeMultiplier, "0.5000");
  assert.throws(
    () =>
      normalizePublicEventFeeChange({
        ...change.rawMetadata,
        scheduled_ts: "bad",
      }),
    /fee change time/,
  );
});
