# OmniFocus migration source investigation

Investigated on 13 November 2026 against installed OmniFocus 4.10.1 (automation build `190.2`). This is the result of planning ticket 02. No personal task titles, notes, tags, or attachment contents were exported into this directory. The live database was queried only for inventory. All export experiments and mutations used a separate fictional document.

## Recommendation and decision

Use the versioned Omni Automation JSON produced by `scripts/export.js` as the importer input, and retain a native OmniFocus backup separately as the original archival record. The format decision awaits user confirmation. This is a recommendation based on the verified fixture, not a claim that a production importer or a full-database migration has been tested.

The user approved importing **all remaining, completed, and dropped items**, with historical items visible only under Everything. Preserve their original and effective lifecycle dates; do not turn children of completed/dropped projects into remaining work merely because their own completion/drop dates are null.

The JSON is a file of records read from OmniFocus in one operation; it requires no per-project selection and does not edit the source. Compared with implementing a parser for native transaction packages, it gives tickets 24/25 explicit, inspectable relationships and dates. Retaining the native source protects the information excluded from this interchange format.

## Evidence and comparison

The fixture contains two nested folders, six projects (parallel, single-action list, paused, sequential, completed, dropped), three hierarchical/multiple tags, thirteen ordinary tasks plus six project root tasks, an Inbox task, nested tasks, completed/dropped tasks, flags, multiline Unicode notes, date-only string inputs and explicit times, two monthly repeat modes, and one embedded attachment. The date-only string inputs were parsed programmatically without time text and became midnight; this does **not** establish that OmniFocus preserves an independent all-day/date-only intent flag.

| Information | Native `.ofocus` | Standard CSV export | Standard text / TaskPaper export | All-roots TaskPaper copy | Automation JSON |
| --- | --- | --- | --- | --- | --- |
| Export scope in this experiment | Whole fictional database | Current Projects view | Current Projects view | Explicitly all Inbox/project roots | Whole database, independent of view |
| Folder nesting | Yes | Omitted | Omitted | Omitted | Yes, parent and ordered child IDs |
| Project/task nesting | Yes | Outline numbering | Indentation | Indentation | Explicit IDs and ordered children |
| Stable source identity | Native IDs | Outline numbers, not source IDs | No | No | Yes |
| Added/modified dates | Added in native records; transaction metadata is not an edit journal | No | No | No | Yes, as exposed by API |
| Completed/drop dates | Yes | Hidden by view in this sample | Hidden by view in this sample | `@done` and `@dropped` for explicitly resolved roots/tasks | Own and effective dates |
| Paused project | Native status | `inactive`; child included | Project present, child omitted, paused status absent | Child included, paused status absent | Explicit `OnHold` |
| Single-action list | Native singleton field | Indistinguishable from parallel | Indistinguishable from parallel | Indistinguishable from parallel | Explicit boolean |
| Sequential children | Native order field | Not represented | `@parallel(false)` | `@parallel(false)` | Explicit boolean |
| Hierarchical/multiple tags | Native tags/links | Leaf tag names; tag tree absent | Path strings on used tags; no independent tag tree | Same | Separate tag tree and task tag IDs |
| Defer/due dates and flags | Yes | Yes, timestamps with offset | Yes, minute precision in sample | Same | UTC instants, local components, floating-zone flag |
| Monthly rules, modes and date anchor | Native fields | Absent | Rule, mode, anchor parameters | Same | Rule, mode, anchor, catch-up flag and task dates |
| Notes | Structured note markup | Plain text | Plain text | Plain text | Plain text |
| Attachment bytes | Separate data archive, verified | Absent | Absent | Absent | Base64, verified against native attachment bytes |
| Original-edit history | No durable journal demonstrated; see below | No | No | No | No |

These columns describe the **actual artifacts**, not every possible configuration of OmniFocus exports. The CSV and normal text were exported from Projects with its existing filtering: 4 projects / 8 ordinary tasks in CSV; text even excluded the paused project's child. An all-inclusive view might recover omitted rows, but cannot supply CSV columns that are absent. The all-roots TaskPaper copy demonstrates that task inclusion can be fixed without fixing missing folders, IDs, statuses, or bytes.

Files:

- `fixtures/representative.json`: proposed importer fixture, exported from the actual fictional document. Its final `source.document` is `saved-fictional`, after the generated native document was moved into the private temporary evidence directory; the IDs and contents match the native package.
- `fixtures/representative.ofocus.zip`: frozen native package, including its two transaction ZIPs and external attachment archive. No document lock file is included. This is a ZIP of an `.ofocus` directory, not an `.ofocus-backup` file.
- `fixtures/representative.csv` and `representative.taskpaper`: standard view-dependent exports.
- `fixtures/representative-all.taskpaper`: explicit all-roots copy using a private pasteboard; the user's clipboard was not replaced.
- `inventory.json`: aggregate-only live inventory and anonymous recurrence rules.

The native package was inspected directly, rather than restoring over a database. `verify_fixture.py` compares its records with JSON identities/names, task dates, repeat rules, and attachment bytes, and checks the remaining structural/lifecycle examples. This proves the selected examples, not a full restore round trip or every possible attachment type.

## Known losses and importer obligations

The JSON keeps note text and attachment bytes separately. It loses rich text formatting and inline attachment placement. It has no original-edit event log, author attribution for pre-migration changes, or user-entered date expression. There is no proven separate date-only flag. Dates keep local components and timezone information: a floating date must not be imported simply as a permanently fixed UTC instant. The fixture uses Europe/London in November; DST transitions and month-end successor calculations remain ticket 17/25 acceptance work.

Linked file URLs are references, not embedded external file bytes. None were found in the live inventory. The attachment serializer supports file/directory wrappers, but only a simple text attachment was verified here. Validate other types at full migration. Notifications, review settings, custom perspectives, tag locations, and UI preferences are outside this format and must not be advertised as preserved. Project properties in this format are intentionally limited to the agreed migration needs; retain the native archive for other metadata.

For ticket 24: map project roots to projects, not duplicate tasks. IDs are scoped to this source database; preserve them for deterministic re-import into an empty system. Keep ordering, task nesting, Inbox IDs, tag hierarchy, own/inherited dates and flags, paused/single-action status, and original added dates. Sequential items must produce a per-item unsupported warning rather than silently becoming parallel. Importer warnings must identify affected attachments and any excluded semantics. Sanitize attachment names on extraction; do not interpret them as filesystem paths.

For ticket 25: preserve `ruleString`, `scheduleType`, `anchorDateKey`, `catchUpAutomatically`, current defer/due dates, and completion/drop dates. The selected date key identifies which current task date is the anchor; it is not itself a calendar date. Preserve unsupported rules in the report instead of approximating them. Completing a project can leave a child with null own completion date but a non-null effective date. The fixture includes this case for both completion and dropping. Do not manufacture historical actions or completion dates for children.

Perspective assertions for future importer tests: completed/dropped items and their effectively resolved descendants appear only in Everything; paused projects remain inspectable under Remaining but unavailable; deferred tasks do not become Available before their dates; explicit flags and inherited flags remain distinguishable. Verify the imported perspective rules using salamifocus semantics, not the exported OmniFocus `status` string alone. Sequential fixture items require an unsupported report until supported.

## Live scope

The final read at 14:05 UTC matched the initial aggregate inventory: 48 folders, 41 projects, 196 tags, **964 ordinary tasks: 569 remaining, 318 effectively completed, 77 effectively dropped**. These counts exclude the 41 project root task objects (1,005 total API task objects). Counts include locally present data only; the separate OmniFocus archive database was not opened or counted.

There are 15 repeating ordinary tasks and no repeating projects: 11 fixed monthly (10 due-anchored, one defer-anchored), two completion-relative monthly (defer-anchored), and **two fixed yearly**. All report `catchUpAutomatically=false`. Yearly rules exceed the agreed monthly scope and must be reported for an explicit migration decision. There are 24 embedded task attachment associations, zero project-root attachments, zero linked file URLs, and zero sequential projects. Attachments were counted, not downloaded from the live database; these are associations rather than guaranteed unique files. Lifecycle counts use effective dates, including inherited resolution.

## Original-edit history

Omni Automation exposes current fields, added/modified timestamps, and lifecycle dates, not a durable sequence of original captures and edits. The fictional native package contains transaction records, including an initial empty snapshot and a later population transaction. Such sync/storage transactions are not a supported complete historical event log: this investigation did not establish retention or authorship and did not inspect a personal backup history. No usable pre-migration edit journal was found through the selected source. Import the current snapshot with import attribution; never invent past edits. Keep native backups if older snapshots matter.

## Reproduction and safety

`export.js` is read-only. It returns JSON for its document context. With OmniFocus installed, the explicit **default document** target reads the live database; the **front document** target reads the selected test document. Use a private location outside version control for personal exports. For example, substitute the absolute script path:

```applescript
tell application "OmniFocus"
  tell default document
    evaluate javascript (read POSIX file "/absolute/path/scripts/export.js" as «class utf8»)
  end tell
end tell
```

Run this through `osascript` and redirect its output to a private JSON file. The returned `source.document`, record counts, and parseable JSON should be checked before using the file. Capture a native backup separately through OmniFocus before actual cutover. No live native backup was made here.

`inventory.js` similarly reads only counts and anonymous repeat metadata. `populate-fictional-document.js` is a mutation script **only for an empty document named `representative`**; its guard rejects a populated document or other name. It creates the fixture, never clears data. The native save from an initially unsaved new document first produced an empty file; that empty result was rejected, the saved empty test document was populated directly, and its data was verified before packaging. The older native synchronous `fileWrapper()` API is unimplemented in 4.10.1. Plain-text export with a `.taskpaper` filename failed; `.txt` succeeded and was copied to the fixture extension. A subsequent external-change save warning was declined. No restore, erase, cleanup, or database switch was performed on the live system.

Run the offline verification:

```sh
python3 investigation/omnifocus/verify_fixture.py
```

## References

The installed application's `OmniFocus.sdef` documents `evaluate javascript` and save/export types. Live API values and saved fictional artifacts provide the comparisons above. Public references checked on 13 November 2026:

- [OmniFocus TaskPaper parameters](https://support.omnigroup.com/omnifocus-taskpaper-reference/)
- [Task properties, including own and effective dates](https://omni-automation.com/omnifocus/task.html)
- [Project root tasks and lifecycle semantics](https://omni-automation.com/omnifocus/project.html)
- [Recurrence rules, schedule types and anchor keys](https://omni-automation.com/omnifocus/task-repeat.html)
- [Task attachments](https://omni-automation.com/omnifocus/task-attachment.html)
- [Document creation and export APIs](https://omni-automation.com/omnifocus/document.html)
- [Private pasteboards](https://omni-automation.com/shared/pasteboard.html)
