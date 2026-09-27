# Kalshi Lab

Kalshi Lab is an experimental prediction-market research system. Its current
execution environment is **Kalshi demo only**; it is not production-ready and
does not claim profitability.

## Current milestone

The first milestone is a small, reusable TypeScript client and explicit CLI
smoke checks for authenticated demo access. The only account-mutating command
places one tiny demo order, retrieves it, and cancels it.

Experiment metadata records an **initial experiment bankroll of $100**. This is
the demo account's starting mock bankroll, not a promise about the current API
balance. Orders and fills may change the live demo balance; the CLI reads that
value from Kalshi and never resets it.

## Workspace

- `apps/web`: Next.js shell for future research surfaces.
- `apps/cli`: explicit balance, market-list, and smoke-order commands.
- `apps/worker`: reserved for later market-data and research jobs.
- `packages/kalshi`: the monorepo's sole Kalshi API boundary. It owns demo
  configuration, request signing, API types, and REST calls.
- `packages/ui`, `packages/eslint-config`, `packages/typescript-config`: shared
  workspace packages.

Authenticated requests use a hard-coded demo origin in `packages/kalshi`; the
client accepts no configurable host. `KALSHI_ENV` must be exactly `demo`.
Signing supports Kalshi Ed25519 and RSA private keys using Node's built-in
crypto module.

## Setup

Use Node 24 or newer and pnpm 11. Install dependencies, copy the example
environment file, then set your API credentials:

```sh
pnpm install
cp .env.example .env
```

Create an API key for the **Kalshi demo account** and save the downloaded
private key locally. Keep the private key outside version control (for example,
under `.secrets/`, which Git ignores). Fill in `.env`:

```env
KALSHI_ENV=demo
KALSHI_API_KEY_ID=your-demo-api-key-id
KALSHI_PRIVATE_KEY_PATH=../../.secrets/kalshi-demo.pem
```

The CLI resolves a relative private-key path from `apps/cli`; an absolute path
also works.

Never commit `.env`, private keys, or API secrets. The key must be an
unencrypted PEM in Ed25519 or RSA format. If a key is encrypted, use a local
unencrypted key file with restrictive filesystem permissions for this initial
CLI workflow.

## Demo commands

These commands are explicit; development, lint, type checking, tests, and builds
never place orders.

```sh
pnpm kalshi:balance
pnpm kalshi:markets
pnpm kalshi:smoke-order
```

The balance and markets commands are read-only. The smoke-order command is the
only mutating command: it deterministically picks an open demo market and
submits one post-only YES buy for one contract at a 1¢ limit. It then retrieves,
cancels, and checks that same order. If a later step fails after creation, it
makes a best-effort cancellation attempt. Kalshi demo liquidity is not
representative of production liquidity.

## Development checks

```sh
pnpm lint
pnpm check-types
pnpm test
pnpm build
```

## Safety and future work

This integration has no production mode and no user-supplied base URL. Do not
add authenticated production endpoints. Preserve prior experiment results and
the starting bankroll record; document a hypothesis, evaluation metrics,
strategy version, and Git commit SHA for every future strategy change. Do not
hide losing experiments or treat demo results as evidence of production
performance.

Later milestones may add market recording, immutable experiment tracking,
strategy research, WeatherNext data, and research tooling. Persistence,
workers, WebSockets, automated strategies, and dashboard work are outside the
current milestone.
