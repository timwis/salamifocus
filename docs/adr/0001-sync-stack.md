---
status: accepted
date: 2026-11-13
status_note: "Accepted by the user on 13 November 2026 (ticket 01). The prototype has been discarded; its logs are kept as evidence."
---

# Sync stack, web framework and server runtime

salamifocus needs local-first relational storage on native Kotlin Android and desktop web clients, with offline durability and an application-owned write path for validation and atomic, attributed change records. Adopt self-hosted PowerSync for records, Postgres for source and bucket storage, React/Vite for the web client and Node.js 24/TypeScript for the server, while the application owns attachment transfer. This is ticket 01's fallback default: the [prototype](#appendix-powersync-sync-spike-evidence-ticket-01), whose raw logs are in [0001-evidence/](0001-evidence/), met the record-sync criteria on both SDKs, but the attachment helpers fell short.

## Considered Options

The go criteria were met, so the alternatives in the spec's research references (LiveStore, Syncular, Evolu, Electric with TanStack offline transactions, Zero) were not prototyped. Zero's documented offline-write limitations and Electric's write path, which leaves writes to the application, would have needed the same app-owned write path anyway.

## Consequences

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

## Appendix: PowerSync sync spike evidence (ticket 01)

All figures come from the final run on 13 November 2026, against PowerSync Service 1.28.3, Kotlin SDK 1.16.0 and `@powersync/web` 2.7.0. Raw output is in [0001-evidence/](0001-evidence/):

- `web-scenarios.log`: 21/21 checks
- `android-scenarios.log`: 26/26 checks, plus one observation
- `android-record.log`: real microphone capture
- `server-excerpt.log`: the server's own record of duplicates, conflicts, rejections and resume offsets

The same suites also passed in full against service 1.23.0.

### Decision context

salamifocus needs local-first relational storage on a native Kotlin Android client and a desktop web client. Captures and edits must survive offline use and restarts. Reconnection must not duplicate work or silently discard it. The server write path must let the application validate operations and store attributed change records atomically with the mutation. See the spec sections "Relational storage and sync candidate", "Attachment transport", "Reconciliation responsibilities" and "Framework evaluation before commitment".

PowerSync (SQLite on clients, Postgres on the server) was the leading candidate. Ticket 01 asked for a throwaway prototype that tested the hard cases on both real SDKs before any production code depended on it.

**Go: adopt PowerSync for records. The application owns attachment transfer.** This is the ticket's fallback default, chosen because only the attachment helpers fell short.

### What was tested

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

### Results

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

### Set-up

- **Infrastructure (Docker):** Postgres 18 with `wal_level=logical` and a `powersync` publication; a second Postgres for bucket storage; PowerSync Open Edition with an edition-3 Sync Streams config that syncs `tasks`, `change_log` and `conflicts` to every client.
- **App server (Node 24, TypeScript):** issues HS256 dev tokens. `POST /upload` applies a client transaction inside one Postgres transaction. A tus-like resumable file store accepts `HEAD` for the offset, `PATCH` to append and `POST …/complete` for SHA-256 verification. It also has fault injection: drop the acknowledgement after commit, refuse uploads, crash before commit, and throttle file uploads.
- **Clients:** a Kotlin/Compose app on the Android 15 emulator (Pixel 9 Pro image), and a React page in separate Chromium processes with persistent profiles.
- **Network:** each simulated device reaches the backend through its own TCP proxy that can be switched offline. Android was also tested with real airplane mode.
- **Kill:** Android used `kill -9` as root and `am force-stop`. The web used SIGKILL of the whole browser process, followed by a relaunch on the same profile.

### 1. Local data and pending edits survive termination while offline

| | Evidence |
|---|---|
| Android | In airplane mode, a capture was added and another task renamed (2 pending uploads), then the process was SIGKILLed. After restarting, still offline: `pending 2 \| t1 A1 renamed offline \| t2 A1 captured offline \| connected false`. The server had seen neither write. The queue also survived `am force-stop`. When airplane mode was turned off, both uploaded. |
| Web | Offline, a capture was added and another task renamed (2 pending), then the Chromium process was SIGKILLed and relaunched offline: `pending 2 \| t1 W1 renamed offline \| t2 W1 captured offline`. After reconnecting, both uploaded. |

Web eviction risk: `navigator.storage.persisted()` returned `false` in the test profile. Storage was IndexedDB, using the SDK's `auto` VFS choice. The ADR lists what can evict this data and the mitigations.

### 2. Offline edits upload on reconnection; a retry after a lost acknowledgement gives one logical write

Both clients ran two cases:

- **Ack dropped on a capture.** The server commits, then closes the socket. The client retries, and the server logs `duplicate_op_ignored`. Postgres ends with one task row and one change record with `upload_attempts = 2`.
- **Ack dropped, then all uploads refused, then the process or browser is killed.** The client still showed `pending 1`, because it never saw success. After the restart the retry was deduplicated: one change record with `upload_attempts = 2` and a task `version` incremented exactly once.

The identity comes from the application: a client-generated `op_id` in `_metadata`, used as the primary key of `change_log`. The SDK's `CrudEntry.clientId` is a local counter, not a stable key.

### 3. Different fields changed on two offline clients

- **Web vs web:** A renamed a task and B edited its notes, both offline. The server and both clients ended with `title = W3 title from A` and `notes = W3 notes from B`, and no conflict was recorded.
- **Android vs web:** the same pattern. The server ended with `{"title":"A3 title from Android","notes":"A3 notes from web"}`.

This works because the upload `PATCH` contains only changed columns, and the server applies it per field.

### 4. Same field changed on two offline clients

The hook: `trackPrevious: {onlyWhenChanged: true}` makes each uploaded `PATCH` carry the values the client believed it was replacing. The server compares those with the current row inside the write transaction.

Web vs web result:

```
conflicts: field=title base_value="W3 title from A" winning_value="W4 title from B"
           losing_value="W4 title from A" winning_op_id=… losing_op_id=…
```

- Both clients converge to the same value.
- The conflict row syncs to both devices, so the losing device can see it.
- A `restore_conflict_loser` operation put the overwritten title back.

The Android vs web run gave the same result, with `losing_value = A4 title from web` restored from Android.

The spike's policy was "last arrival at the server wins, the loser is kept". Because the base value and both op ids reach the server, ticket 34 can choose a different policy.

### 5. Validation and atomic change records on the server write path

- **Validation:** a rename to a title the test rule forbids was stored optimistically on the client, rejected by the server (`op_rejected`), recorded in `change_log` with `outcome = rejected`, and acknowledged. Sync then reverted the client to the valid title, and the rejection record was visible on the client. This passed on both clients.
- **Atomicity:** a fault threw after the task update and the change-log insert, but before commit. Nothing was persisted. The client retried and the operation applied once: one change record with `upload_attempts = 1`, and the task updated. This passed on both clients.

### 6. Audio-sized file from Android: transferred separately, interrupted, resumed

Synthetic 8 MiB payload, with the server throttled to 400 KiB/s:

- The task row reached Postgres while the file was still uploading. The record and the bytes travel separately.
- The process was SIGKILLed mid-upload with 1,201,186 bytes on the server. When the app was reopened, the upload resumed.
- The network was then cut with 1,780,710 bytes on the server, and resumed again on reconnection.
- Upload attempts started at offsets `0, 1266722, 1780710`.
- The assembled server file's SHA-256 matched `sha256sum` of the device's file. There was one inbox entry, and the device kept its local copy after the upload.
- The web client downloaded the recording through `AttachmentQueue` into IndexedDB (`state 3`) and rendered an `<audio>` player.

Real microphone capture (`android-record.log`): the UI's Record and Stop buttons produced a 12,666-byte AAC file. The server identified it as `ISO Media, MP4 v2`, and the web `<audio>` element loaded it with a duration of 6.14 s.

**Observation: background.** Pressing HOME during an upload stalled it. The server's partial file stayed at 1,515,726 bytes for the next 35 s, and it completed only after the app was reopened. An earlier run logged `ActivityManager: freezing <pid> dev.salamifocus.spike`. The attachment queue runs in-process, with no WorkManager integration.

**Helper maturity:**

- Both platforms label the helpers Alpha, and the Kotlin README says "Do not rely on this package for production use".
- The default transport re-sends the whole file. Resumability here came from the prototype's own `RemoteStorage` implementation.
- The local state enums differ across SDKs. On Kotlin, `QUEUED_DOWNLOAD = 0` and `QUEUED_UPLOAD = 1`; on JS, `QUEUED_UPLOAD = 0` and `QUEUED_DOWNLOAD = 1`. This is harmless because the table is local-only, but it is a trap for shared tooling.

### 7. Time-dependent local query without server contact

- **Android:** a task was deferred by 8 s in airplane mode. The UI's accessibility tree showed `task:<id>:deferred` and then `task:<id>:available`, still offline.
- **Web:** a task was deferred by 5 s while offline. The rendered cell went from `no` to `yes` 108 ms after `defer_until`, still offline.

The mechanism is application code. "Now" is a query parameter, and a timer fires at the earliest future `defer_until`. PowerSync watches tables, not the clock.

### 8. Self-hosting and licensing

- **Self-hosting:** Docker image `journeyapps/powersync-service` (about 480 MB). It needs a source Postgres with logical replication and a publication, plus bucket storage, which can be Postgres. At idle it used about 130 MiB of RAM; each Postgres used about 40–50 MiB. Upgrading in place from 1.23.0 to 1.28.3 migrated storage automatically, and connected clients reconnected without intervention.
- **Licensing:**
  - The service repository and the 1.28.3 image packages declare Apache-2.0.
  - The 1.23.0 image declares FSL-1.1-ALv2, which converts to Apache-2.0 after two years and permits non-competing use such as personal self-hosting.
  - The SDKs are Apache-2.0.
  - No PowerSync Cloud account or commercial agreement is needed.

### Limits of this evidence

- The Android tests ran on an emulator. A physical device, including OEM battery management, is still to be verified in tickets 05, 20 and 21.
- Only Chromium was tested on the web. Firefox and Safari are not covered.
- Deletes, production authentication (JWKS) and large datasets were not exercised.
