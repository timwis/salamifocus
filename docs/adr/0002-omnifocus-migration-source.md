---
status: proposed
date: 2026-11-13
status_note: "Proposed for the export mechanism; the user accepted the completed-history scope on 13 November 2026."
---

# OmniFocus migration source and completed history

salamifocus must replace the user's OmniFocus working system without requiring two ongoing sources of truth. Propose a versioned JSON export produced by a read-only Omni Automation script as the importer input, retaining an ordinary native OmniFocus backup as the archival fallback, so the importer consumes an explicit automation contract. The user accepted importing all remaining, completed and dropped items present in the source; adoption of the export mechanism still requires user confirmation.

## Considered Options

- **Native database or backup as importer input:** the native fixture preserves structured notes and additional metadata. Consuming it directly requires interpreting storage transactions, capability markers and external attachment packages. Keep it as the original record; prefer the explicit automation contract for the importer.
- **CSV:** the tested export depended on the current view and omitted folders, stable source identities, recurrence and attachment contents. Outline numbering is not a stable identity.
- **TaskPaper:** useful for optional interchange. Explicit copying of all task roots recovered completed/dropped tasks and repeat parameters, but still omitted folders, stable identities, paused/single-action status and attachment contents. It is insufficient as the complete migration source.

## Consequences

The importer needs a source that preserves folder and tag hierarchies, project types and statuses, nested tasks, identities, dates, notes, flags, recurrence, and historical completion information. Selecting that source defines the importer contract for tickets 24 and 25.

The script reads the whole selected database without per-project selection or dependence on the current perspective. The initial contract is `salamifocus.omnifocus-export`, version 1, implemented by [export.js](../../investigation/omnifocus/scripts/export.js). It carries source identities, ordered relationships, current fields, own and effective lifecycle dates, recurrence parameters, and embedded attachment contents. Project roots must map to projects rather than duplicate tasks.

**Accepted history scope:** import all remaining, completed, and dropped items present in the source. Historical items appear only under Everything. Preserve inherited completion/drop dates separately from an item's own dates, so descendants of resolved projects do not become remaining work. This covers the exported database; separately archived OmniFocus databases are not automatically included.

- The exporter becomes maintained migration tooling. Changes to its contract require explicit version handling and fixture verification.
- Notes retain text but lose rich formatting and inline attachment placement. Attachment bytes remain associated with their tasks. Linked files remain references; their external bytes are not included.
- Dates retain UTC values, local components and floating-zone flags. Do not treat every date as a fixed UTC instant. Original date-only input intent is not established by the source. DST and month-end recurrence behaviour still need importer tests.
- Preserve repeat rules, schedule type, anchor date key, catch-up policy and current task dates. Report unsupported rules and structures against the affected items instead of approximating them. The live inventory includes two yearly repeats beyond the agreed monthly scope.
- The export supplies a snapshot, not an original-edit journal. Attribute imported records to the import; do not manufacture pre-migration edits. Native storage transactions have not been established as a complete, durable edit history.
- Custom perspectives, notifications, review settings and other excluded metadata are not preserved by this contract. The import report must disclose unsupported or lossy information.
- Verification covers the fictional examples and a simple embedded attachment, not every attachment type or a full restore round trip. A full migration rehearsal, perspective checks, and review of losses are required before cutover. No decision here authorizes changes to the existing OmniFocus database.

The investigation used a separate fictional database in OmniFocus 4.10.1. Its structured export was checked against saved native records, including identities, dates, monthly repeat rules and attachment bytes. The live database was queried only for aggregate counts; a full personal export and migration rehearsal have not been performed.

Evidence: [Export investigation](../../investigation/omnifocus/README.md), [fictional fixture](../../investigation/omnifocus/fixtures/representative.json), and [verification script](../../investigation/omnifocus/verify_fixture.py).
