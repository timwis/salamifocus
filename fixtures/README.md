# Behaviour fixtures

Client-neutral examples of how the system behaves: given these records and this clock, expect this availability and these perspective contents. They pin down rules that every client works out for itself offline, so the server tests, the web client and (from ticket 23) the Android client all run the same files. The clients share expected behaviour, not code.

Each file is one scenario with a list of `examples`.

```json
{
  "name": "What the example shows",
  "clock": "2026-11-16T09:00:00.000Z",
  "records": {
    "projects": [{ "id": "report", "name": "Quarterly report", "kind": "project", "folder_id": null, "position": "a0" }],
    "tasks": [{ "id": "compile", "title": "Compile the report", "project_id": "report", "parent_id": null, "position": "a0", "created_at": "…", "completed_at": null }]
  },
  "expect": {
    "unavailable": { "compile": [] },
    "perspectives": [{ "perspective": "projects", "selection": ["report"], "groups": [{ "id": "report", "tasks": [{ "id": "compile", "depth": 1 }] }] }]
  }
}
```

- **`clock`** is the time the expectations hold at. A runner sets its clock to it.
- **`records`** are rows of the synced tables (`folders`, `projects`, `tags`, `tasks`, `task_tags`) with their column names. Ids are short names; a runner gives each a fresh UUID, and replaces it wherever it appears (in `id` and in columns ending `_id`), so examples can run side by side against one database. Columns left out take their defaults.
- **`unavailable`** says, for each listed task, why it cannot be worked on now: `completed`, `blocked` (waiting on an unfinished child) and, in later tickets, more. An empty list means the task is available. A client checks the tasks it can show; until there is a way to show completed tasks, a client may skip those.
- **`perspectives`** says what a perspective shows with a sidebar selection: its groups in order (a project or tag, by id), and each group's tasks in order with their depth in the hierarchy (1 at the top level). Groups and tasks not listed must not appear.

Runners: `server/test/behaviour.test.ts` and `e2e/tests/web-behaviour.spec.ts`.
