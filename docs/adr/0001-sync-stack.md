# ADR 0001: Sync stack, web framework and server runtime

- **Status:** Accepted by the user on 13 November 2026 (ticket 01). The prototype has been discarded; its logs are kept as evidence.
- **Date:** 13 November 2026
- **Evidence:** [0001-evidence.md](0001-evidence.md), with raw logs in [0001-evidence/](0001-evidence/)

## Context

salamifocus needs local-first relational storage on a native Kotlin Android client and a desktop web client. Captures and edits must survive offline use and restarts. Reconnection must not duplicate work or silently discard it. The server write path must let the application validate operations and store attributed change records atomically with the mutation. See the spec sections "Relational storage and sync candidate", "Attachment transport", "Reconciliation responsibilities" and "Framework evaluation before commitment".

PowerSync (SQLite on clients, Postgres on the server) was the leading candidate. Ticket 01 asked for a throwaway prototype that tested the hard cases on both real SDKs before any production code depended on it.

## What was tested

These were the versions current on 13 November 2026:

| Component | Version | Maturity label (PowerSync feature-status page) |
|---|---|---|
| PowerSync Service, Open Edition (self-hosted Docker) | 1.28.3 (also run on 1.23.0) | GA |
| Kotlin SDK `com.powersync:core` | 1.16.0 | GA |
| Web SDK `@powersync/web` / `@powersync/react` | 2.7.0 / 2.2.1 | GA |
| Built-in attachment helpers (Kotlin and JS) | bundled in the SDKs above | **Alpha** |
| Sync Streams (edition 3 sync config) | — | GA |
| Postgres bucket storage | — | GA |

The prototype ran a Kotlin/Compose app on an Android 15 emulator and a React page in real Chromium processes with persistent profiles. Both used local SQLite. Postgres 18 had logical replication, the PowerSync service used Postgres bucket storage, and a Node.js app server handled tokens, writes and file transfer. Each client reached the backend through its own switchable TCP proxy, so one "device" could be partitioned while another stayed online. Android was also tested in real airplane mode. Every scenario was scripted and asserted, and the full suite was run several times against both service versions.

## Results

| Requirement | Android (Kotlin SDK) | Web (JS SDK) |
|---|---|---|
| Local data and pending edits survive process kill / browser restart while offline | Pass (SIGKILL, `am force-stop`, airplane mode) | Pass (Chromium process SIGKILLed and relaunched offline) |
| Offline edits queue and upload on reconnection | Pass | Pass |
| Retried upload after lost acknowledgement gives one logical write | Pass, including ack lost then process killed before the retry | Pass, same |
| Different fields of one record changed on two offline clients both survive | Pass (Android vs web) | Pass (web vs web) |
| Same field changed on two offline clients: detectable, losing edit recoverable | Pass. Server detects the conflict from the uploaded previous values, records the losing value, syncs it to both devices, and a restore operation recovers it | Pass |
| Server write path validates and stores the change record atomically with the mutation | Pass. Rejection is recorded and the optimistic write reverts; a crash before commit leaves neither | Pass |
| Audio-sized file transfers separately from its record, survives interruption, resumes | Pass in the foreground only. Needs app-owned resumable transfer and background scheduling (see below) | Download and playback pass |
| Time-dependent local query changes without server contact | Pass, with the app re-evaluating at the next defer boundary | Pass, same |
| Self-hosting and licensing fit a single-user deployment | Pass | Pass |

## Decision

**Go: adopt PowerSync for records. The application owns attachment transfer.** This is the ticket's fallback default, chosen because only the attachment helpers fell short.

1. **Sync.** Use PowerSync Open Edition, self-hosted, version 1.28.x or later. All 1.28 images are Apache-2.0; older images such as 1.23.0 are FSL-1.1-ALv2. Postgres is both the source database and the bucket storage, so no MongoDB is needed. The clients are the PowerSync Kotlin SDK on Android and `@powersync/web` on the desktop web client.

2. **Write path.** Every local write sets `_metadata` to `{op_id, op, actor}`. Synced tables enable `trackMetadata`, `trackPrevious: {onlyWhenChanged: true}` and `ignoreEmptyUpdates`. The client's upload function posts one client transaction at a time to the application server, which applies it in one Postgres transaction:
   - deduplicate on `op_id`, so a retry after a lost acknowledgement is recognised and not reapplied;
   - validate;
   - compare the client's previous values with current server values to detect same-field conflicts;
   - apply as a per-field patch, so edits to different fields merge;
   - write the change record (before, after, actor, operation identity) and any conflict record in the same transaction.

   Business rejections are recorded and acknowledged with 200, not refused with an error status. An error status would leave the transaction at the head of the client's strictly ordered queue and block it forever. Normal sync then reverts the rejected optimistic write, and the client can see the rejection record.

3. **Conflict policy.** PowerSync does not resolve conflicts; it delivers the evidence to the write path. The spike used "last write to reach the server wins, and the overwritten value is kept in a synced conflicts table". Ticket 34 can keep or change that policy without changing the stack, because all the inputs it needs (base value, both operation ids, actor) reach the server.

4. **Attachments.** The application owns the transfer on Android. The prototype's resumable protocol works: query the server's offset, append chunks, verify the SHA-256 on completion. Ticket 21 should run it from a WorkManager worker so uploads continue in the background. The built-in `AttachmentQueue` may still be used as a helper, but no requirement depends on it.
   - The helpers are alpha. The Kotlin README says "Do not rely on this package for production use".
   - The default transport re-sends the whole file. The prototype added resumability on top of the `RemoteStorage` interface.
   - The queue runs inside the app process. When the app was backgrounded, Android froze or cached the process and the upload stalled until the app was reopened. That matches the spec's warning that the row queue alone does not solve Android background transfer.
   - On the web, recordings are only downloaded for playback. The JS `AttachmentQueue` (alpha) did that correctly into IndexedDB, but authenticated streaming from the server is an equally small alternative.

5. **Time-based availability.** Watched queries re-run when tables change, not when time passes. Both clients pass "now" as a query parameter and schedule a re-evaluation at the earliest future defer date. The web client also re-evaluates on `visibilitychange`, and Android should also do so on resume. This must be part of the shared perspective code from ticket 11 onwards.

6. **Web framework.** Use a React single-page app built with Vite, in TypeScript, using `@powersync/react` hooks (`useQuery`, `useStatus`). This is PowerSync's best-documented and most-used web path, and the whole spike client was about 200 lines on it. Vite needs `optimizeDeps.exclude: ['@powersync/web']` and `worker.format: 'es'`. An installable PWA is recommended for storage persistence (see below).

7. **Server runtime.** Use Node.js 24 with TypeScript, in the same language as the web client, so task rules are written in TypeScript (shared by web and server) and Kotlin. PowerSync's own reference backends are Node, `@powersync/node` exists if a server-side local replica is ever useful (for example for the MCP adapter), and Node 24 runs TypeScript directly. The HTTP framework is left to ticket 03; the spike used plain `node:http` with `postgres` and `jose`.

## Consequences and caveats

- **Durability is the app's responsibility at the edges.** Idempotency, validation, change records and conflict detection are application code on the write path. The spike proved the hooks exist and behave; ticket 03 must build them properly.
- **The upload queue is strictly ordered per client.** A transaction that throws blocks later ones. That rules out error statuses for business rejections.
- **Deletes.** A plain SQL `DELETE` carries no `_metadata`. Use `UPDATE … SET _deleted = TRUE, _metadata = …`, or soft deletion as part of ticket 18's lifecycle work. This was not exercised in the spike.
- **Browser storage eviction.** The web database lives in the origin's IndexedDB/OPFS quota and is best-effort by default:
  - Under storage pressure, Chromium and Firefox evict the least recently used origin silently.
  - Users can clear site data, use private windows, or set "delete site data on close".
  - Safari removes script-writable storage after seven days without user interaction, unless the site is installed as a web app.

  Mitigations: call `navigator.storage.persist()` (Chrome grants it heuristically, for example for installed PWAs; Firefox prompts), install the web client as a PWA, show the pending-upload count, and warn when storage is not persisted. Postgres remains the source of truth, so eviction can only lose edits that have not yet uploaded. The headless test profile reported `persisted() = false`.
- **Clock.** Defer evaluation uses the device clock. That is acceptable for a personal app, but worth noting for tests (inject the clock).
- **Not yet verified:** a physical Android device, including OEM battery management; Firefox and Safari; production authentication (the spike used a dev HS256 shared secret, and production should use asymmetric keys via JWKS); deletes; and large data volumes.
- **Footprint.** At idle the PowerSync container used about 130 MiB and the two Postgres containers about 40–50 MiB each. The service image is about 480 MB. This fits the single small self-managed server proposed in ticket 04.
- **Licensing.**
  - PowerSync Service Open Edition: Apache-2.0 (the service repo and the 1.28.x images). Earlier releases are FSL-1.1-ALv2 and become Apache-2.0 two years after release. FSL would permit personal self-hosting anyway.
  - Client SDKs: Apache-2.0.
  - Nothing requires PowerSync Cloud or a commercial agreement.

## Alternatives

The go criteria were met, so the alternatives in the spec's research references (LiveStore, Syncular, Evolu, Electric with TanStack offline transactions, Zero) were not prototyped. Zero's documented offline-write limitations and Electric's write path, which leaves writes to the application, would have needed the same app-owned write path anyway.
