import { normaliseTitle, positionAt, positionBetween, tagPathSeparator, titleProblem } from '@salamifocus/domain';
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { isTyping, useCurrentRow, useRovingFocus } from '../focus.ts';
import { tagsInOrder, useTags, useTaskTags } from '../tags/data.tsx';
import { completeTask, createTask, nestTask, reorderTask } from '../writes.ts';
import { TaskEditor, type Field } from './TaskEditor.tsx';

export interface OutlineTask {
  id: string;
  title: string;
  note: string | null;
  position: string | null;
  projectId: string | null;
  /** Shown on the row where the project is not already the heading. */
  projectName?: string | null;
  /** Where the task sits in a project's hierarchy: 1 at the top level, 2 beneath a parent, and so on. */
  depth?: number;
  /** The task it is shown beneath, if any. */
  parentId?: string | null;
}

/** A run of tasks, under a heading when it is a project or tag, in outline order. One task can appear in several groups. */
export interface OutlineGroup {
  id: string;
  heading: string | null;
  tasks: OutlineTask[];
  /** Where a task added here goes, or absent if tasks cannot be added here. */
  newTask?: { projectId: string | null; tagId: string | null };
  /** Whether the tasks are in an order and hierarchy of their own (a project's), which new tasks slot into and Alt+arrows change. */
  ordered: boolean;
}

type Row = { key: string; group: OutlineGroup } & ({ kind: 'heading' } | { kind: 'task'; task: OutlineTask; index: number });

type Editing =
  | { mode: 'task'; rowKey: string; startIn: Field }
  | { mode: 'draft'; groupId: string; parentId: string | null; depth: number; after: string | null; before: string | null; returnTo: string | null };

const EMPTY = 'empty';
const headingKey = (group: OutlineGroup) => `group:${group.id}`;
const taskKey = (group: OutlineGroup, taskId: string) => `${group.id}/${taskId}`;

const parentOf = (task: OutlineTask) => task.parentId ?? null;
const depthOf = (task: OutlineTask) => task.depth ?? 1;
const siblingsOf = (group: OutlineGroup, parentId: string | null) => group.tasks.filter((t) => parentOf(t) === parentId);
const childrenOf = (group: OutlineGroup, task: OutlineTask) => siblingsOf(group, task.id);

/** The index just past a task's children (and theirs) in the outline. */
function subtreeEnd(tasks: readonly OutlineTask[], index: number) {
  let end = index + 1;
  while (end < tasks.length && depthOf(tasks[end]!) > depthOf(tasks[index]!)) end++;
  return end;
}

/**
 * Where a draft row sits among a group's tasks: before the first sibling placed after it, else after its
 * parent's last descendant. Last where tasks are oldest first.
 */
function draftIndex(group: OutlineGroup, parentId: string | null, after: string | null) {
  const { tasks } = group;
  if (!group.ordered) return tasks.length;
  const next = tasks.findIndex((t) => parentOf(t) === parentId && (after === null || (t.position !== null && t.position > after)));
  if (next !== -1) return next;
  const parent = tasks.findIndex((t) => t.id === parentId);
  return parent === -1 ? tasks.length : subtreeEnd(tasks, parent);
}

/**
 * The main task outline: compact rows, grouped under project headings where
 * there are projects. One stop in the Tab order; arrow keys move between rows.
 */
export function Outline({
  title,
  summary,
  groups,
  empty,
}: {
  title: string;
  summary?: ReactNode;
  groups: OutlineGroup[];
  empty: ReactNode;
}) {
  const rows: Row[] = groups.flatMap((group) => [
    ...(group.heading !== null ? [{ key: headingKey(group), group, kind: 'heading' as const }] : []),
    ...group.tasks.map((task, index) => ({ key: taskKey(group, task.id), group, kind: 'task' as const, task, index })),
  ]);
  const tags = useTags();
  const taskTags = useTaskTags();
  const current = useCurrentRow(rows.map((r) => r.key));
  const [editing, setEditing] = useState<Editing | null>(null);
  const focused = rows[current.index] ?? null;

  // The task being edited can disappear, for example when another device completes it.
  const editedTaskGone = editing?.mode === 'task' && !rows.some((r) => r.key === editing.rowKey);
  useEffect(() => {
    if (editedTaskGone) setEditing(null);
  }, [editedTaskGone]);
  const roving = useRovingFocus<HTMLDivElement>(editing?.mode === 'draft' ? 'draft' : (current.key ?? EMPTY));

  function focusRow(index: number) {
    const row = rows[Math.max(0, Math.min(index, rows.length - 1))];
    if (!row) return;
    roving.claim();
    current.set(row.key);
  }

  function startDraft() {
    if (!focused?.group.newTask) return;
    const { group } = focused;
    roving.claim();
    if (focused.kind === 'heading') {
      const first = siblingsOf(group, null)[0];
      setEditing({ mode: 'draft', groupId: group.id, parentId: null, depth: 1, after: null, before: first?.position ?? null, returnTo: focused.key });
    } else {
      // A new task goes after the current one and its children, beneath the same parent.
      const { task } = focused;
      const after = task.position;
      const parentId = parentOf(task);
      // Skip siblings sharing this position (two offline devices can create them) so there is room between the bounds.
      const next = siblingsOf(group, parentId).find((t) => t.id !== task.id && t.position !== null && (after === null || t.position > after));
      setEditing({ mode: 'draft', groupId: group.id, parentId, depth: depthOf(task), after, before: next?.position ?? null, returnTo: focused.key });
    }
  }

  function openEditor(key: string) {
    roving.claim();
    current.set(key);
    setEditing({ mode: 'task', rowKey: key, startIn: 'title' });
  }

  /**
   * While something is being edited, pressing on another row acts at once rather than on click: closing the
   * editor reshapes the outline before the button is released, so the click would land elsewhere. The action
   * waits until the editor's own blur handling has finished, so that does not undo it.
   */
  function actOnPress(event: MouseEvent, key: string, action: () => void) {
    if (!editing || event.button !== 0 || (editing.mode === 'task' && editing.rowKey === key)) return;
    setTimeout(action);
  }

  async function finishDraft(title: string | null, keepGoing: boolean) {
    if (editing?.mode !== 'draft') return;
    const group = groups.find((g) => g.id === editing.groupId);
    if (title === null || !group?.newTask) {
      setEditing(null);
      current.set(editing.returnTo);
      return;
    }
    const id = crypto.randomUUID();
    const { projectId, tagId } = group.newTask;
    const position = group.ordered ? positionBetween(editing.after, editing.before) : null;
    // Enter saves and starts the next task straight after this one.
    setEditing(keepGoing ? { ...editing, after: position, returnTo: taskKey(group, id) } : null);
    current.await(taskKey(group, id));
    await createTask(id, projectId, title, position, tagId ? [tagId] : [], editing.parentId);
  }

  /** The current task, where its group has an order and hierarchy that can be changed. */
  function movable() {
    return focused?.kind === 'task' && focused.group.ordered ? focused : null;
  }

  /** Moves the current task, with its children, up or down among its siblings; it never crosses into another group. */
  function reorder(by: -1 | 1) {
    const row = movable();
    if (!row) return;
    const siblings = siblingsOf(row.group, parentOf(row.task));
    const target = siblings.findIndex((t) => t.id === row.task.id) + by;
    if (target < 0 || target >= siblings.length) return;
    void reorderTask(row.task.id, positionAt(siblings.filter((t) => t.id !== row.task.id), target));
  }

  /** Makes the current task the last prerequisite of the sibling above it. */
  function indent() {
    const row = movable();
    if (!row) return;
    const siblings = siblingsOf(row.group, parentOf(row.task));
    const above = siblings[siblings.findIndex((t) => t.id === row.task.id) - 1];
    if (!above) return;
    const children = childrenOf(row.group, above);
    void nestTask(row.task.id, above.id, positionAt(children, children.length));
  }

  /** Moves the current task out of its parent, to just after it. */
  function outdent() {
    const row = movable();
    const parent = row && row.group.tasks.find((t) => t.id === parentOf(row.task));
    if (!row || !parent) return;
    const siblings = siblingsOf(row.group, parentOf(parent));
    void nestTask(row.task.id, parentOf(parent), positionAt(siblings, siblings.indexOf(parent) + 1));
  }

  function onKeyDown(event: KeyboardEvent) {
    if (isTyping(event)) return;
    const handled = () => event.preventDefault();
    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      if (event.key === 'ArrowUp') return handled(), reorder(-1);
      if (event.key === 'ArrowDown') return handled(), reorder(1);
      if (event.key === 'ArrowRight') return handled(), indent();
      if (event.key === 'ArrowLeft') return handled(), outdent();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    switch (event.key) {
      case 'ArrowDown':
        return handled(), focusRow(current.index + 1);
      case 'ArrowUp':
        return handled(), focusRow(current.index - 1);
      case 'Home':
        return handled(), focusRow(0);
      case 'End':
        return handled(), focusRow(rows.length - 1);
      case 'n':
        return handled(), startDraft();
      case ' ':
        if (focused?.kind !== 'task') return;
        return handled(), void completeTask(focused.task.id);
      case 'Enter':
        if (focused?.kind !== 'task') return;
        return handled(), setEditing({ mode: 'task', rowKey: focused.key, startIn: 'title' });
      case 'p':
        if (focused?.kind !== 'task') return;
        return handled(), setEditing({ mode: 'task', rowKey: focused.key, startIn: 'project' });
      case 't':
        if (focused?.kind !== 'task') return;
        return handled(), setEditing({ mode: 'task', rowKey: focused.key, startIn: 'tags' });
    }
  }

  const draftRow = editing?.mode === 'draft' && (
    <li
      key={`draft:${editing.after}:${editing.returnTo}`}
      className="task-row editing"
      data-key="draft"
      style={indentBy(editing.depth)}
    >
      <span className="check" aria-hidden />
      <TitleEditor label="New task title" initial="" onDone={(title, how) => void finishDraft(title, how === 'enter')} />
    </li>
  );

  return (
    <main data-region="outline" aria-labelledby="perspective-heading">
      <div className="outline-header">
        <div>
          <h2 id="perspective-heading">{title}</h2>
          {summary && <p className="summary">{summary}</p>}
        </div>
        {groups.some((g) => g.newTask) && (
          // The mouse equivalent of N, kept out of the Tab order so Tab still moves between regions.
          <button type="button" tabIndex={-1} aria-label="New task" title="New task (N)" aria-keyshortcuts="N" onClick={startDraft}>
            + New task
          </button>
        )}
      </div>
      <div
        ref={roving.ref}
        className="outline"
        data-roving
        data-key={EMPTY}
        tabIndex={rows.length === 0 && !editing ? 0 : -1}
        onKeyDown={onKeyDown}
        {...roving.handlers}
      >
        {rows.length === 0 && editing === null && <p className="empty">{empty}</p>}
        {groups.map((group) => {
          const draftAt = editing?.mode === 'draft' && editing.groupId === group.id ? draftIndex(group, editing.parentId, editing.after) : -1;
          const items = group.tasks.map((task) => {
            const key = taskKey(group, task.id);
            const isCurrent = key === focused?.key && !editing;
            const tagIds = taskTags.get(task.id) ?? [];
            const chips = tagsInOrder(tags, tagIds);
            return (
              <li
                key={key}
                data-key={key}
                className="task-row"
                aria-level={group.ordered ? depthOf(task) : undefined}
                style={indentBy(depthOf(task))}
                tabIndex={isCurrent ? 0 : -1}
                data-current={key === focused?.key || undefined}
                onClick={() => current.set(key)}
                onMouseDown={(event) => actOnPress(event, key, () => current.set(key))}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  className="check"
                  aria-label={`Complete ${task.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    void completeTask(task.id);
                  }}
                />
                {editing?.mode === 'task' && editing.rowKey === key ? (
                  <TaskEditor task={{ ...task, tagIds }} tags={tags} startIn={editing.startIn} onClose={() => setEditing(null)} />
                ) : (
                  <>
                    <div className="task-body">
                      <button
                        type="button"
                        tabIndex={-1}
                        className="task-title"
                        onClick={() => openEditor(key)}
                        onMouseDown={(event) => {
                          event.stopPropagation();
                          actOnPress(event, key, () => openEditor(key));
                        }}
                      >
                        {task.title}
                      </button>
                      {(chips.length > 0 || task.projectName) && (
                        <span className="task-meta">
                          {task.projectName && <span className="task-project">{task.projectName}</span>}
                          {chips.map(({ tag, path }) => (
                            <span key={tag.id} className="tag-chip" title={path.join(tagPathSeparator)}>
                              {tag.name}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                    {task.note ? <span className="note-mark" role="img" aria-label="Has a note" title={task.note} /> : null}
                  </>
                )}
              </li>
            );
          });
          if (draftAt !== -1 && draftRow) items.splice(draftAt, 0, draftRow);
          const list = (
            <ul className="tasks" aria-label={group.heading ?? title}>
              {items}
            </ul>
          );
          if (group.heading === null) return <div key={group.id}>{list}</div>;
          const key = headingKey(group);
          return (
            <section key={group.id} aria-labelledby={`heading-${group.id}`}>
              <h3
                id={`heading-${group.id}`}
                className="project-heading"
                data-key={key}
                tabIndex={key === focused?.key && !editing ? 0 : -1}
                data-current={key === focused?.key || undefined}
                onClick={() => current.set(key)}
              >
                {group.heading}
              </h3>
              {list}
              {group.tasks.length === 0 && draftAt === -1 && <p className="hint">No tasks yet. Press N or use New task to add one.</p>}
            </section>
          );
        })}
      </div>
    </main>
  );
}

const indentBy = (depth: number) => (depth > 1 ? { paddingLeft: `${0.5 + (depth - 1) * 1.5}rem` } : undefined);

function TitleEditor({
  label,
  initial,
  onDone,
}: {
  label: string;
  initial: string;
  onDone: (title: string | null, how: 'enter' | 'blur' | 'escape') => void;
}) {
  const [title, setTitle] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const finished = useRef(false);

  function finish(result: string | null, how: 'enter' | 'blur' | 'escape') {
    if (finished.current) return;
    finished.current = true;
    onDone(result, how);
  }

  return (
    <span className="editor">
      <input
        aria-label={label}
        value={title}
        autoFocus
        onChange={(e) => {
          setTitle(e.target.value);
          setProblem(null);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            const reason = titleProblem(title);
            if (reason && initial === '' && title === '') return finish(null, 'escape');
            if (reason) return setProblem(reason);
            finish(normaliseTitle(title), 'enter');
          }
          if (event.key === 'Escape') finish(null, 'escape');
        }}
        onBlur={() => finish(titleProblem(title) ? null : normaliseTitle(title), 'blur')}
      />
      {problem && <span role="alert">{problem}</span>}
    </span>
  );
}
