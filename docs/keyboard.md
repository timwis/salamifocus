# Desktop key bindings

The web client is meant to be used from the keyboard. This is the reference for what each key does. Later tickets add to it; ticket 19 checks the whole workflow end to end.

## Rules

- **Regions.** The screen has up to three regions: perspective navigation, the perspective's sidebar, and the main outline. Each region is one stop in the Tab order. **Tab** and **Shift+Tab** move between regions, and arrow keys move within one.
- **Plain keys are commands only when you are not typing.** Single-letter and digit commands are ignored while a text field has focus.
- **Avoid browser and OS shortcuts.** Bindings do not use Cmd or Ctrl with letters (new tab, find, reload, close), and do not use F6 or Alt+letter, which browsers and Linux desktops claim.
- **Escape** abandons the edit in progress. **Enter** saves it.

## Everywhere

| Key | Action |
|---|---|
| 1 | Go to Inbox |
| 2 | Go to Projects (focus goes to the sidebar) |
| Tab / Shift+Tab | Next / previous region |

## Perspective navigation

| Key | Action |
|---|---|
| ↑ / ↓ | Previous / next perspective |

## Projects sidebar

Folders, projects and single-action lists. Selecting a folder shows every project inside it.

| Key | Action |
|---|---|
| ↑ / ↓, Home / End | Move and select only that item |
| Shift+↑ / Shift+↓ | Move and add the item to the selection |
| Cmd+↑ / Cmd+↓ on macOS, Ctrl+↑ / Ctrl+↓ on Linux | Move without changing the selection (macOS keeps Ctrl+arrows for Mission Control) |
| Space | Add or remove the item from the selection |
| → | Expand a folder, or go to its first item |
| ← | Collapse a folder, or go to the folder containing the item |
| Enter or F2 | Rename |
| N | New project |
| S | New single-action list |
| F | New folder |
| Alt+↑ / Alt+↓ | Move the item up or down among its siblings |
| Alt+→ | Move the item into the folder just above it |
| Alt+← | Move the item out of its folder |

A new item goes at the end of the focused folder, or just after the focused project or list.

With the mouse, click selects, Cmd/Ctrl+click adds or removes an item, and Shift+click selects a range. Double-click renames.

## Outline

The task rows of the current perspective. In Projects, each selected project has a heading row.

| Key | Action |
|---|---|
| ↑ / ↓, Home / End | Previous / next row, first / last row |
| Enter | Edit the task, starting in its title |
| Space | Complete the task. It leaves the outline and the row now in its place becomes current |
| Alt+↑ / Alt+↓ | Move the task up or down within its project. The order is for your reading only; it never makes one task wait for another |
| N | New task straight after the current row (on a project heading: at the top of that project). Enter saves it and starts another; Enter on an empty row or Escape stops |

### Editing a task

The task's fields, in order: title, then note. Later tickets add tags, defer and due dates between them. Each field is saved when you leave it.

| Key | Action |
|---|---|
| Tab / Shift+Tab | Next / previous field, keeping the change (wraps round) |
| Enter in the title | Save and stop editing (a blank title is refused) |
| Enter in the note | New line |
| Cmd+Enter on macOS, Ctrl+Enter on Linux, in the note | Save and stop editing |
| Escape | Abandon the field you are in and stop editing; fields you already left stay saved |
