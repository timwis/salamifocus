# Evidence for ADR 0001: PowerSync sync spike (ticket 01)

All figures come from the final run on 13 November 2026, against PowerSync Service 1.28.3, Kotlin SDK 1.16.0 and `@powersync/web` 2.7.0. Raw output is in [0001-evidence/](0001-evidence/):

- `web-scenarios.log`: 21/21 checks
- `android-scenarios.log`: 26/26 checks, plus one observation
- `android-record.log`: real microphone capture
- `server-excerpt.log`: the server's own record of duplicates, conflicts, rejections and resume offsets

The same suites also passed in full against service 1.23.0.

## Set-up

- **Infrastructure (Docker):** Postgres 18 with `wal_level=logical` and a `powersync` publication; a second Postgres for bucket storage; PowerSync Open Edition with an edition-3 Sync Streams config that syncs `tasks`, `change_log` and `conflicts` to every client.
- **App server (Node 24, TypeScript):** issues HS256 dev tokens. `POST /upload` applies a client transaction inside one Postgres transaction. A tus-like resumable file store accepts `HEAD` for the offset, `PATCH` to append and `POST …/complete` for SHA-256 verification. It also has fault injection: drop the acknowledgement after commit, refuse uploads, crash before commit, and throttle file uploads.
- **Clients:** a Kotlin/Compose app on the Android 15 emulator (Pixel 9 Pro image), and a React page in separate Chromium processes with persistent profiles.
- **Network:** each simulated device reaches the backend through its own TCP proxy that can be switched offline. Android was also tested with real airplane mode.
- **Kill:** Android used `kill -9` as root and `am force-stop`. The web used SIGKILL of the whole browser process, followed by a relaunch on the same profile.

## 1. Local data and pending edits survive termination while offline

| | Evidence |
|---|---|
| Android | In airplane mode, a capture was added and another task renamed (2 pending uploads), then the process was SIGKILLed. After restarting, still offline: `pending 2 \| t1 A1 renamed offline \| t2 A1 captured offline \| connected false`. The server had seen neither write. The queue also survived `am force-stop`. When airplane mode was turned off, both uploaded. |
| Web | Offline, a capture was added and another task renamed (2 pending), then the Chromium process was SIGKILLed and relaunched offline: `pending 2 \| t1 W1 renamed offline \| t2 W1 captured offline`. After reconnecting, both uploaded. |

Web eviction risk: `navigator.storage.persisted()` returned `false` in the test profile. Storage was IndexedDB, using the SDK's `auto` VFS choice. The ADR lists what can evict this data and the mitigations.

## 2. Offline edits upload on reconnection; a retry after a lost acknowledgement gives one logical write

Both clients ran two cases:

- **Ack dropped on a capture.** The server commits, then closes the socket. The client retries, and the server logs `duplicate_op_ignored`. Postgres ends with one task row and one change record with `upload_attempts = 2`.
- **Ack dropped, then all uploads refused, then the process or browser is killed.** The client still showed `pending 1`, because it never saw success. After the restart the retry was deduplicated: one change record with `upload_attempts = 2` and a task `version` incremented exactly once.

The identity comes from the application: a client-generated `op_id` in `_metadata`, used as the primary key of `change_log`. The SDK's `CrudEntry.clientId` is a local counter, not a stable key.

## 3. Different fields changed on two offline clients

- **Web vs web:** A renamed a task and B edited its notes, both offline. The server and both clients ended with `title = W3 title from A` and `notes = W3 notes from B`, and no conflict was recorded.
- **Android vs web:** the same pattern. The server ended with `{"title":"A3 title from Android","notes":"A3 notes from web"}`.

This works because the upload `PATCH` contains only changed columns, and the server applies it per field.

## 4. Same field changed on two offline clients

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

## 5. Validation and atomic change records on the server write path

- **Validation:** a rename to a title the test rule forbids was stored optimistically on the client, rejected by the server (`op_rejected`), recorded in `change_log` with `outcome = rejected`, and acknowledged. Sync then reverted the client to the valid title, and the rejection record was visible on the client. This passed on both clients.
- **Atomicity:** a fault threw after the task update and the change-log insert, but before commit. Nothing was persisted. The client retried and the operation applied once: one change record with `upload_attempts = 1`, and the task updated. This passed on both clients.

## 6. Audio-sized file from Android: transferred separately, interrupted, resumed

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

## 7. Time-dependent local query without server contact

- **Android:** a task was deferred by 8 s in airplane mode. The UI's accessibility tree showed `task:<id>:deferred` and then `task:<id>:available`, still offline.
- **Web:** a task was deferred by 5 s while offline. The rendered cell went from `no` to `yes` 108 ms after `defer_until`, still offline.

The mechanism is application code. "Now" is a query parameter, and a timer fires at the earliest future `defer_until`. PowerSync watches tables, not the clock.

## 8. Self-hosting and licensing

- **Self-hosting:** Docker image `journeyapps/powersync-service` (about 480 MB). It needs a source Postgres with logical replication and a publication, plus bucket storage, which can be Postgres. At idle it used about 130 MiB of RAM; each Postgres used about 40–50 MiB. Upgrading in place from 1.23.0 to 1.28.3 migrated storage automatically, and connected clients reconnected without intervention.
- **Licensing:**
  - The service repository and the 1.28.3 image packages declare Apache-2.0.
  - The 1.23.0 image declares FSL-1.1-ALv2, which converts to Apache-2.0 after two years and permits non-competing use such as personal self-hosting.
  - The SDKs are Apache-2.0.
  - No PowerSync Cloud account or commercial agreement is needed.

## Limits of this evidence

- The Android tests ran on an emulator. A physical device, including OEM battery management, is still to be verified in tickets 05, 20 and 21.
- Only Chromium was tested on the web. Firefox and Safari are not covered.
- Deletes, production authentication (JWKS) and large datasets were not exercised.
