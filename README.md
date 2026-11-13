# salamifocus

A personal GTD application: a native Android client for capture, a desktop web client for processing, local-first storage on both, and a Postgres server they sync through. See [ADR 0001](docs/adr/0001-sync-stack.md) for the stack, [ADR 0003](docs/adr/0003-operations-and-history.md) for how changes are written, and [ADR 0004](docs/adr/0004-hosting-and-deployment.md) for hosting and backups.

## Layout

| Path | What it is |
|---|---|
| `domain/` | Task rules shared by the server and the web client (TypeScript) |
| `server/` | Node.js app server: sign-in, sync credentials, the write path that applies client operations, and the application's operations and queries |
| `web/` | Desktop web client (React, Vite, PowerSync web SDK) |
| `android/` | Android client (Kotlin, Jetpack Compose, PowerSync Kotlin SDK) |
| `e2e/` | End-to-end tests that drive the real web client in Chromium against the real stack |
| `infra/` | Postgres initialisation for `compose.yaml`, and PowerSync's configuration and sync rules (also built into the deployed PowerSync image) |
| `deploy/` | The deployed stack's Compose file, example environment, and reverse proxy and backup snippets |

## Running locally

Needs Node 24, pnpm 10 and Docker.

```sh
cp .env.example .env          # development password: salami
pnpm install
pnpm dev:infra                # Postgres on :54329, PowerSync on :8080
pnpm dev:server               # app server on :3100
pnpm dev:web                  # web client on http://127.0.0.1:5173
```

The web client talks only to the app server, which proxies sync traffic to PowerSync under `/powersync`.

For Android, open `android/` in Android Studio, or run `./gradlew installDebug` with an emulator running (JDK 17+). The debug build signs in to `http://10.0.2.2:3100` by default, which is the development machine as seen from the emulator; override it with `-Psalamifocus.serverUrl=…` or on the sign-in screen. Debug builds allow plain HTTP; release builds require HTTPS and have no default address (see [docs/deploy.md](docs/deploy.md#installing-the-android-app)).

To use a different password, put the output of `pnpm --filter @salamifocus/server hash-password` in `OWNER_PASSWORD_HASH`.

## Deploying

CI publishes the app server image (which includes the built web client) and a PowerSync image to GHCR from `main`. [docs/deploy.md](docs/deploy.md) covers deploying, updating, backups and restoring.

To try the production web client locally, build it with `pnpm --filter @salamifocus/web build` and run `WEB_ROOT=../web/dist pnpm dev:server` (the path is relative to `server/`). It is then served at http://127.0.0.1:3100.

## Tests

```sh
pnpm dev:infra
pnpm test
```

The server tests create a throwaway database per test file on the Postgres from `compose.yaml` (`TEST_DATABASE_URL`) and drive the application's public operations and queries, or its HTTP endpoints as a client would.

The end-to-end tests drive the real clients. Each run starts its own throwaway stack (a second Compose project, `salamifocus-e2e`, from `compose.e2e.yaml`) with an in-memory Postgres, its own PowerSync and its own app server on port 3101. It removes the stack afterwards, so development data is never touched. Docker must be running; the development stack need not be.

```sh
pnpm test:e2e:web       # web client in Chromium; extra arguments go to Playwright
pnpm test:e2e:android   # Android app on the running emulator; needs JDK 17+
```

A simulated other client uploads through the real sync endpoint. A small proxy (`e2e/support/network-switch.ts`) stands between each client and the server so the tests can take that client offline.
