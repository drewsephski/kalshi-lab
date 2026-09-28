# EXP-005 official fee API inspection — 2026-09-28

Inspection recorded before changing collection code. The official current OpenAPI document at `https://docs.kalshi.com/openapi.yaml` was retrieved at `2026-09-28T15:48:57Z`; SHA-256: `0adbb5855cdd4817d61daad7a91b99256d71f083bb10b8232ea52658b4d740a9`.

It documents `GET /series/fee_changes` (`GetSeriesFeeChanges`) with optional `series_ticker` and `show_historical` (default `false`) parameters. Its response is `series_fee_change_arr`; each entry contains `id`, `series_ticker`, `fee_type`, `fee_multiplier`, and `scheduled_ts`. This provides dated historical series-level fee changes not collected by the existing EXP-004/EXP-005 event-only collector. The event endpoint remains necessary because its dated overrides layer on the series rule.

The first EXP-005 session attempt and Session 2 were launched before this omission was found. Their original runs and code SHAs are preserved. After this inspection is committed, the smallest collector change will add the official historical series endpoint for subsequent sessions and a separately identified supplemental read-only retrieval for already-selected series. No experiment protocol criteria or prior evidence will be changed.

Other current official references inspected in this research:

- `GET /events/{event_ticker}` exposes current `fee_type_override` and `fee_multiplier_override`.
- `GET /events/fee_changes` returns scheduled event override changes; paired null override values clear the event override.
- `GET /series/{series_ticker}` exposes current series `fee_type` and `fee_multiplier` only.
- The official fee schedule PDF is dated “Last updated and effective: July 7, 2026”; its raw download attempt returned HTTP 429, so no local raw-document hash is claimed.

Current OpenAPI does not specify a cursor for series fee changes. The series history result must therefore be retained as returned and its response completeness limitation reported if the API response indicates truncation or failure.

Unsigned live GET verification at approximately `2026-09-28T16:01:20Z` used `show_historical=true`. `KXATPMATCH` returned one record (`quadratic_with_maker_fees`, multiplier `1`, scheduled `2025-11-15T08:00:00Z`), raw response SHA-256 `4bb6814e785beaaa1b0cddf68ea25ee65978609d5931c420c3d8211c6c5e4630`. `KXTEMPMIAH` returned zero records, raw response SHA-256 `6780c8eb7edbb5e1ca3b15166f17cef054befacb2cc8f4bc479c54074a9a2c18`. Eight additional EXP-004 series checked through the read-only client also returned zero records; the ATP record confirms the endpoint can expose dated historical changes. This proves fee type/multiplier history exists for at least one series, but does not by itself establish event overrides or separate maker/taker multipliers.
