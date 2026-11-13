# salamifocus

A personal GTD application: a native Android client for capture, a desktop web client for processing, local-first storage on both, and a Postgres server they sync through. See [ADR 0001](docs/adr/0001-sync-stack.md) for the stack and [ADR 0002](docs/adr/0002-operations-and-history.md) for how changes are written.

## Layout

| Path | What it is |
|---|---|
| `domain/` | Task rules shared by the server and the web client (TypeScript) |
| `server/` | Node.js app server: sign-in, sync credentials, the write path that applies client operations, and the application's operations and queries |
| `web/` | Desktop web client (React, Vite, PowerSync web SDK) |
| `android/` | Android client (Kotlin, Jetpack Compose, PowerSync Kotlin SDK) |
| `e2e/` | End-to-end tests that drive the real web client in Chromium against the real stack |
| `infra/` | Postgres initialisation and PowerSync service configuration used by `compose.yaml` |

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

For Android, open `android/` in Android Studio, or run `./gradlew installDebug` with an emulator running (JDK 17+). The debug build signs in to `http://10.0.2.2:3100` by default, which is the development machine as seen from the emulator; override it with `-Psalamifocus.serverUrl=…` or on the sign-in screen. Debug builds allow plain HTTP; release builds require HTTPS.

To use a different password, put the output of `pnpm --filter @salamifocus/server hash-password` in `OWNER_PASSWORD_HASH`.

## Tests

```sh
pnpm dev:infra
pnpm test
```

`pnpm test:e2e:web` starts the app server and web client itself (Postgres and PowerSync must be up) and drives the web client in Chromium, with a simulated phone uploading through the real sync endpoint. A small proxy in front of the web client (`e2e/support/network-switch.ts`) cuts it off from the server to test offline behaviour.

The Android end-to-end tests run on an emulator against the app server, through a network switch so they can take the phone offline:

```sh
node --env-file=.env server/src/main.ts &
node e2e/support/network-switch.ts --listen 3199 --control 3198 --target http://127.0.0.1:3100 &
cd android && ./gradlew connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.serverUrl=http://10.0.2.2:3199 \
  -Pandroid.testInstrumentationRunnerArguments.directServerUrl=http://10.0.2.2:3100 \
  -Pandroid.testInstrumentationRunnerArguments.networkControl=http://10.0.2.2:3198
```

Without `networkControl` the offline test is skipped.

The server tests create a throwaway database per test file on the Postgres from `compose.yaml` (`TEST_DATABASE_URL`) and drive the application's public operations and queries, or its HTTP endpoints as a client would.
