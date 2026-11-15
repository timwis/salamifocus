# Desktop key bindings

The web client is meant to be used from the keyboard. This is the reference for what each key does. Later tickets add to it; ticket 19 checks the whole workflow end to end.

## Rules

- **Regions.** The screen has up to three regions: perspective navigation, the perspective's sidebar, and the main outline. Each region is one stop in the Tab order. **Tab** and **Shift+Tab** move between regions, and arrow keys move within one.
- **Plain keys are commands only when you are not typing.** Single-letter and digit commands are ignored while a text field has focus.
- **Avoid browser and OS shortcuts.** Bindings do not use Cmd or Ctrl with letters (new tab, find, reload, close), and do not use F6 or Alt+letter, which browsers and Linux desktops claim.
- **Escape** abandons the edit in progress. **Enter** saves it.
- **Where the keys go.** The region with keyboard focus has an accent line along its top, and its current row is outlined in blue. In other regions the current row and selection stay marked in grey.
- **The mouse keeps the keys working.** Clicking a perspective opens it with focus in its sidebar (or its outline, if it has no sidebar). Clicking empty space in a region puts focus back on that region's current row.

## Everywhere

| Key | Action |
|---|---|
| 1 | Go to Inbox |
| 2 | Go to Projects (focus goes to the sidebar) |
| 3 | Go to Tags (focus goes to the sidebar) |
| Tab / Shift+Tab | Next / previous region |
| V / Shift+V | In Projects and Tags: show the next / previous of **Available**, **Remaining** and **Everything** (see [Visibility](#visibility)) |
| C | Capture to the Inbox without leaving where you are. Enter saves and clears the box for the next one; Enter on an empty box or Escape closes it, and focus goes back where it was. The **+ Capture** button does the same |

## Visibility

Projects and Tags can show more or less of the system. The choice is shown above the outline, kept in the address (so a reload keeps it), and remembered for each perspective while the app is open. Both start at Remaining.

- **Available**: only tasks that can be worked on now. Blocked and deferred tasks, and tasks in paused projects, are left out; a deferred task joins when its date arrives. A prerequisite whose parent is left out is shown where the parent was.
- **Remaining**: every unfinished task, blocked and deferred ones and those in paused projects included.
- **Everything**: completed tasks as well, each in its place, struck through and marked **Completed** with the day and time. Completing a task here leaves it in place.

Clicking a choice does the same as V, without moving keyboard focus.

## Perspective navigation

| Key | Action |
|---|---|
| ↑ / ↓ | Previous / next perspective, staying in the navigation |
| Enter | Open the perspective and move focus into it |

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
| P | Pause the project or single-action list, or resume it if it is paused |
| Alt+↑ / Alt+↓ | Move the item up or down among its siblings |
| Alt+→ | Move the item into the folder just above it |
| Alt+← | Move the item out of its folder |

A new item goes at the end of the focused folder, or just after the focused project or list.

A paused project stays in the sidebar, marked **Paused**, and can still be selected and edited. None of its tasks is available until it is resumed: they show under Remaining and Everything, never under Available. Its heading in the outline says **Paused**, and elsewhere (in Tags) its tasks say **Project paused**.

With the mouse, click selects, Cmd/Ctrl+click adds or removes an item, and Shift+click selects a range. Double-click renames. The **+ Project**, **+ List** and **+ Folder** buttons below the sidebar do the same as N, S and F, and the **Pause** or **Resume** button does the same as P for the current item.

## Tags sidebar

Tags nest to any depth. One tag is selected at a time; selecting it covers its descendants too.

| Key | Action |
|---|---|
| ↑ / ↓, Home / End | Move and select that tag |
| Cmd+↑ / Cmd+↓ on macOS, Ctrl+↑ / Ctrl+↓ on Linux | Move without changing the selection |
| Space | Select the tag, or clear the selection if it is already selected |
| → | Expand a tag, or go to its first child |
| ← | Collapse a tag, or go to its parent |
| Enter or F2 | Rename |
| N | New tag, just after the current one (after its children, if it has any) |
| Alt+↑ / Alt+↓ | Move the tag up or down among its siblings |
| Alt+→ | Move the tag inside the tag just above it |
| Alt+← | Move the tag out of its parent |

With the mouse, click selects and double-click renames. The **+ Tag** button does the same as N.

## Outline

The task rows of the current perspective. Inbox lists every unfinished task that still lacks a project (a single-action list counts) or a tag, oldest first; once it has both it leaves, and the row now in its place becomes current. In Projects, each selected project has a heading row, and a task nested beneath another (one of its prerequisites) is indented under it, to any depth. Nesting only happens within a project, so indenting does nothing in Tags or the Inbox. A task with an unfinished task beneath it waits on it: its row is marked **Blocked**. Completing its last unfinished child makes it available, but it still needs completing itself. Siblings never wait on each other, whatever their order, and a child never waits on its parent. A deferred task is marked **Deferred until** its date, and so is every task beneath it (a deferred project defers all of its tasks); it comes back by itself when the date arrives, even with the app left open or offline. A deferred child still blocks its parent. A due date is shown on the row as **Due** and never changes whether a task can be worked on; a task beneath another, or in a project with a due date, shows the earliest of those due dates. In Tags, each tag in the selected branch that has tasks has a heading row with its full path, such as "@Computer : Shallow work : Low energy"; a task carrying several of those tags appears under each, and completing it removes every appearance.

| Key | Action |
|---|---|
| ↑ / ↓, Home / End | Previous / next row, first / last row |
| Enter | Edit the task, starting in its title. On a project heading: edit the project's dates |
| P | Edit the task's project |
| T | Edit the task's tags |
| Space | Complete the task. It leaves the outline (except under Everything) and the row now in its place becomes current. On a completed task, under Everything: mark it unfinished again |
| Alt+↑ / Alt+↓ | Move the task, with its children, up or down among its siblings. The order is for your reading only; it never makes one task wait for another |
| Alt+→ | Indent: make the task a prerequisite of the task above it at the same level (it becomes that task's last child). Its own children come with it |
| Alt+← | Outdent: move the task out of its parent, to just after it. Its own children come with it |
| N | New task straight after the current row and its children, beneath the same parent (on a project heading: at the top of that project). In Tags, it goes at the end of the current row's tag group, carries that tag, and waits in the Inbox until it has a project. Enter saves it and starts another; Enter on an empty row or Escape stops. The **+ New task** button does the same |

### Editing a task

The task's fields, in order: title, project, tags, defer until, due, then note. Each field is saved when you leave it, except the project and tags, which are kept when you leave them and saved when you stop editing (so a task you are editing does not vanish from the outline when it gets both in the Inbox, or loses the selected tag in Tags).

| Key | Action |
|---|---|
| Tab / Shift+Tab | Next / previous field, keeping the change (wraps round) |
| Enter in the title | Save and stop editing (a blank title is refused) |
| Typing in project | Lists the projects and single-action lists whose name or folder path contains what you typed, then **New project** with that name (unless one already has it) |
| ↑ / ↓ in project | Choose among the listed projects |
| Enter in project | Put the task in the chosen project, at the end (out of any parent, but with its own children still beneath it); with nothing typed, save and stop editing |
| Enter on **New project** | Ask which folder it goes in: type to list folders by name or path, or, before typing anything, choose **No folder**. Enter picks one, Tab picks one and moves to the next field, Escape goes back to the name. The project is created at the end of that folder when you stop editing |
| Backspace in empty project | Take the task out of its project; its children go with it |
| Typing in tags | Lists the tags whose name or path contains what you typed |
| ↑ / ↓ in tags | Choose among the listed tags |
| Enter in tags | Add the chosen tag; with nothing typed, save and stop editing |
| Backspace in empty tags | Remove the last tag |
| Typing in defer until or due | Shows the date it means beside the field, or **Not a date**. Counts from today: "1 week", "3 days", or 3d, 2w, 1m (a month), 1y. Also "today", "tomorrow", a weekday ("fri", "next friday") and dates ("1 Dec", "1/12", "2027-01-04"), each with an optional time ("tomorrow 9am"). Without a time, a defer date means the start of that day and a due date 17:00, in your time zone |
| Enter or Tab in defer until or due | Save the date (and, with Enter, stop editing). Not a date: stays in the field until it is one, is emptied, or Escape abandons it. Clicking away from the editor discards it, keeping the date the field had |
| Empty defer until or due | Clears the date |
| Enter in the note | New line |
| Cmd+Enter on macOS, Ctrl+Enter on Linux, in the note | Save and stop editing |
| Escape | Abandon the field you are in and stop editing; fields you already left stay saved |

### Editing a project's dates

A project's heading shows its own defer and due dates. Enter on the heading (or double-click) opens two fields, **Defer project until** and **Project due**, which read dates as a task's do. Every task in the project is deferred until the project's date, as well as any of its own, and is due by the project's due date if that is earlier than its own.

| Key | Action |
|---|---|
| Tab / Shift+Tab | The other field, saving this one |
| Enter | Save and stop editing. Not a date: stays in the field, as in a task's date fields |
| Empty field | Clears that date |
| Escape | Abandon the field you are in and stop editing |
