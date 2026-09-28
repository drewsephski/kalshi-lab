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
