# salamifocus

A personal GTD application: a native Android client for capture, a desktop web client for processing, local-first storage on both, and a Postgres server they sync through. See [ADR 0001](docs/adr/0001-sync-stack.md) for the stack and [ADR 0002](docs/adr/0002-operations-and-history.md) for how changes are written.

## Layout

| Path | What it is |
|---|---|
| `domain/` | Task rules shared by the server and the web client (TypeScript) |
| `server/` | Node.js app server: sign-in, sync credentials, the write path that applies client operations, and the application's operations and queries |
| `infra/` | Postgres initialisation and PowerSync service configuration used by `compose.yaml` |

## Running locally

Needs Node 24, pnpm 10 and Docker.

```sh
cp .env.example .env          # development password: salami
pnpm install
pnpm dev:infra                # Postgres on :54329, PowerSync on :8080
pnpm dev:server               # app server on :3100
```

To use a different password, put the output of `pnpm --filter @salamifocus/server hash-password` in `OWNER_PASSWORD_HASH`.

## Tests

```sh
pnpm dev:infra
pnpm test
```

The server tests create a throwaway database per test file on the Postgres from `compose.yaml` (`TEST_DATABASE_URL`) and drive the application's public operations and queries, or its HTTP endpoints as a client would.
