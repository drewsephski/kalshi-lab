# Engineering validation: September 27, 2026

This is a short implementation smoke record, not the formal EXP-001 measurement
and not a profitability result. The original question and success criteria remain
unchanged. No orders were placed and the $100 mock starting bankroll was untouched.

Recorder version: `market-recorder-v1`.
Git HEAD: `1b3a77900e49be24a9ca7a37b9050ee8a1169c4d`.
The checkout was dirty because this implementation and concurrent local work
were uncommitted. A clean committed implementation is required before formal
research measurements. Runs store the SHA and dirty flag explicitly.

The generated migration was applied to the Neon database configured through root
`.env.local`. Verification queried actual rows and compared them with run counts;
no credentials or connection strings are included here.

| Check                      | Run ID                                 | Persisted result                                                                                                                                                                                                                              |
| -------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Demo one-shot              | `a3077644-8738-4f26-a092-4f3c4b60fb5b` | Completed; 24 tracked markets, 24 rows, all fresh. One unavailable discovery candidate was logged and excluded.                                                                                                                               |
| Production-public one-shot | `77baa0b4-3622-40ba-8efe-27d298e38c7b` | Completed; 3 tracked markets, 3 rows under `kalshi_production_public`, unsigned GETs only.                                                                                                                                                    |
| Continuous demo + Ctrl+C   | `11d5ec06-9e5d-45be-b8d3-3c25722ade64` | Stopped cleanly; 24 markets, 360 rows, including 312 fresh WebSocket rows and 24 initial REST rows. The 24 final shutdown rows are deliberately disconnected/stale. Zero malformed messages or dropped snapshots. Full book refresh observed. |
| Forced demo disconnect     | `9ec91959-9847-486f-ad83-944724777eac` | Stopped cleanly; 3 markets, 18 rows, including 9 fresh WebSocket observations; one recorded reconnect, fresh book snapshots after reconnect, zero malformed messages/drops.                                                                   |

The forced-disconnect check used the same recorder and signed demo stream, with a
local verification harness terminating the socket ten seconds after startup and
aborting the run after 25 seconds. Its REST transport asserted that every request
was a GET to the hard-coded demo origin. The continuous command separately proved
SIGINT handling through `pnpm worker:record`.

## Failures retained and corrected

- `a3ab00bf-808c-4819-bd54-a613a720fb3b`: failed, zero snapshots. Live Postgres.js
  exposed raw Date binding in a SQL expression; the expression now binds an ISO
  timestamp explicitly as `timestamptz`.
- `9ae733f5-e5be-47ef-b74a-de6c5f12293d`: failed, zero snapshots. Demo discovery
  raced with a subsequent market HTTP 404. Implicit unavailable candidates are
  now excluded during initial state verification; explicit tickers still fail.
- `c3d2a547-b0c8-42fa-9ed2-b6653ce78154`: 525 fresh recorded snapshots preserved.
  Its first Ctrl+C test killed the process when the package manager forwarded
  SIGINT more than once. Its row remains `running` with an old heartbeat and no
  `stopped_at`, demonstrating abrupt-loss semantics. Signal handlers are now
  persistent until cleanup completes; the following continuous run stopped
  cleanly. No worker process remains for this old run.

An isolated migration test also caught foreign keys being emitted before their
referenced unique indexes. Composite references now use named unique table
constraints, and the generated migration passes both isolated PostgreSQL and Neon.

The normal test suite is credential-free and exercises real isolated PostgreSQL
schema/query behavior, fixed-point normalization, source boundaries, malformed
messages, sequence gaps/duplicates, deterministic selection, bounded retries and
queue overflow, one-shot/finalization, and repeated shutdown signals in a real
subprocess. Install, tests, lint, typecheck, build, generation, and migration
validation are the required engineering gates; these short smokes do not satisfy
the predefined 30-minute data-quality experiment.

## Verification commands

All passed: `pnpm install`, `pnpm test` (32 tests), `pnpm lint`,
`pnpm check-types`, `pnpm build`, `pnpm db:generate` (no schema drift),
`pnpm db:check`, and `git diff --check`. The additive `pnpm db:migrate`
completed against Neon. `pnpm worker:once`, a production-public one-shot,
`pnpm worker:record`, and the read-only forced-disconnect harness supplied
the live evidence above. All recorder processes launched for these checks
were stopped; the abandoned run row is retained for failure inspection.
