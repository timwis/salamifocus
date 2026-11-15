# Notes for agents

Start with the README (layout, running, tests) and `docs/adr/` (decisions). Record new decisions as ADRs.

## Rules

- This repository is public. Keep personal details out of it: no hostnames, domains, server paths, vault names or real people. Use placeholders in examples.
- No secrets in the repository or in `.env`. Secrets live in 1Password; pass them to a command with `op run -- <command>`.
- Every push to `main` publishes the deploy images (see `docs/deploy.md`). Deploying them is a separate, manual step.

## Toolchain

`mise.toml` pins Java, Node and pnpm. In a new checkout or worktree, run `mise trust && mise install`. Don't use another JDK: the Android build needs 17.

The Android build also needs the SDK: set `ANDROID_HOME` (Android Studio installs it in `~/Library/Android/sdk` on macOS) or put `sdk.dir=…` in `android/local.properties`.

## Checking a change

Fastest first:

1. `pnpm typecheck`
2. `pnpm test` (needs `pnpm dev:infra` running)
3. `./gradlew compileDebugKotlin` in `android/`
4. `pnpm test:e2e:web`, and `pnpm test:e2e:android` if an emulator is running

If you can't run a check, say so in your summary.

The TypeScript runs directly on Node with no build step. That rules out parameter properties, enums and namespaces (`erasableSyntaxOnly`), and imports need the `.ts` extension.

## Where changes go

- Schema: add `server/migrations/NNNN_name.sql`. The server applies it when it starts.
- Sync rules: `infra/powersync/sync-config.yaml`. Restart the dev PowerSync container to pick them up. The deployed PowerSync image is built from this file.
- Task rules: `domain/` (shared by the server and the web client). Android repeats the operation names and the rules it needs in `android/app/src/main/kotlin/dev/salamifocus/data/Tasks.kt`, so keep the two in step.

## Worktrees

- Create them in `.worktrees/` (gitignored): `git worktree add .worktrees/<name> -b <name>`.
- Copy `.env` (and `android/local.properties` if it exists), then run `mise trust && mise install && pnpm install`.
- `.planning/` (tickets) exists only in the main checkout.
- Worktrees share one dev stack (Compose project `salamifocus`, app server on :3100). The e2e stack uses fixed ports, so only one e2e run can happen at a time per machine. Check `docker compose -p salamifocus-e2e ps` before starting one.
- Stop processes you started by PID. Broad `pkill -f` patterns can kill other agents' processes or Docker.
