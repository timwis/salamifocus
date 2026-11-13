import { normaliseTitle, positionBetween, titleProblem } from '@salamifocus/domain';
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { isTyping, useCurrentRow, useRovingFocus } from '../focus.ts';
import { createTask, renameTask } from '../writes.ts';

export interface OutlineTask {
  id: string;
  title: string;
  position: string | null;
}

/** A run of tasks, under a heading when it is a project, in outline order. */
export interface OutlineGroup {
  id: string;
  heading: string | null;
  /** Whether new tasks can be added here, for example a project. */
  projectId: string | null;
  tasks: OutlineTask[];
}

type Row = { key: string; group: OutlineGroup } & ({ kind: 'heading' } | { kind: 'task'; task: OutlineTask; index: number });

type Editing = { mode: 'title'; taskId: string } | { mode: 'draft'; groupId: string; after: string | null; before: string | null; returnTo: string | null };

const EMPTY = 'empty';
const headingKey = (group: OutlineGroup) => `group:${group.id}`;

/** Where a draft row sits among a group's tasks: before the first task placed after it. */
const draftIndex = (group: OutlineGroup, after: string | null) =>
  after === null ? 0 : (() => {
    const index = group.tasks.findIndex((t) => t.position !== null && t.position > after);
    return index === -1 ? group.tasks.length : index;
  })();

/**
 * The main task outline: compact rows, grouped under project headings where
 * there are projects. One stop in the Tab order; arrow keys move between rows.
 */
export function Outline({ label, groups, empty }: { label: string; groups: OutlineGroup[]; empty: ReactNode }) {
  const rows: Row[] = groups.flatMap((group) => [
    ...(group.heading !== null ? [{ key: headingKey(group), group, kind: 'heading' as const }] : []),
    ...group.tasks.map((task, index) => ({ key: task.id, group, kind: 'task' as const, task, index })),
  ]);
  const current = useCurrentRow(rows.map((r) => r.key));
  const [editing, setEditing] = useState<Editing | null>(null);
  const focused = rows[current.index] ?? null;
  const roving = useRovingFocus<HTMLDivElement>(editing?.mode === 'draft' ? 'draft' : (current.key ?? EMPTY));

  function focusRow(index: number) {
    const row = rows[Math.max(0, Math.min(index, rows.length - 1))];
    if (!row) return;
    roving.claim();
    current.set(row.key);
  }

  function startDraft() {
    if (!focused?.group.projectId) return;
    const { group } = focused;
    roving.claim();
    if (focused.kind === 'heading') {
      setEditing({ mode: 'draft', groupId: group.id, after: null, before: group.tasks[0]?.position ?? null, returnTo: focused.key });
    } else {
      const next = group.tasks[focused.index + 1];
      setEditing({ mode: 'draft', groupId: group.id, after: focused.task.position, before: next?.position ?? null, returnTo: focused.key });
    }
  }

  async function finishDraft(title: string | null, keepGoing: boolean) {
    if (editing?.mode !== 'draft') return;
    const group = groups.find((g) => g.id === editing.groupId);
    if (title === null || !group?.projectId) {
      setEditing(null);
      current.set(editing.returnTo);
      return;
    }
    const id = crypto.randomUUID();
    const position = positionBetween(editing.after, editing.before);
    // Enter saves and starts the next task straight after this one.
    setEditing(keepGoing ? { ...editing, after: position, returnTo: id } : null);
    current.await(id);
    await createTask(id, group.projectId, title, position);
  }

  async function finishTitle(task: OutlineTask, title: string | null) {
    setEditing(null);
    if (title !== null && title !== task.title) await renameTask(task.id, title);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (isTyping(event) || event.altKey || event.ctrlKey || event.metaKey) return;
    const handled = () => event.preventDefault();
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
      case 'Enter':
        if (focused?.kind !== 'task') return;
        return handled(), setEditing({ mode: 'title', taskId: focused.task.id });
    }
  }

  const draftRow = editing?.mode === 'draft' && (
    <li key={`draft:${editing.after}`} className="task-row editing" data-key="draft">
      <span className="check" aria-hidden />
      <TitleEditor label="New task title" initial="" onDone={(title, how) => void finishDraft(title, how === 'enter')} />
    </li>
  );

  return (
    <div
      ref={roving.ref}
      className="outline"
      data-key={EMPTY}
      tabIndex={rows.length === 0 && !editing ? 0 : -1}
      onKeyDown={onKeyDown}
      {...roving.handlers}
    >
      {rows.length === 0 && editing === null && <p className="empty">{empty}</p>}
      {groups.map((group) => {
        const draftAt = editing?.mode === 'draft' && editing.groupId === group.id ? draftIndex(group, editing.after) : -1;
        const items = group.tasks.map((task) => {
          const isCurrent = task.id === focused?.key && !editing;
          return (
            <li
              key={task.id}
              data-key={task.id}
              className="task-row"
              tabIndex={isCurrent ? 0 : -1}
              onFocus={(event) => event.target === event.currentTarget && current.set(task.id)}
              onClick={() => current.set(task.id)}
            >
              <span className="check" aria-hidden />
              {editing?.mode === 'title' && editing.taskId === task.id ? (
                <TitleEditor label="Title" initial={task.title} onDone={(title) => void finishTitle(task, title)} />
              ) : (
                <button
                  type="button"
                  tabIndex={-1}
                  className="task-title"
                  onClick={() => {
                    roving.claim();
                    current.set(task.id);
                    setEditing({ mode: 'title', taskId: task.id });
                  }}
                >
                  {task.title}
                </button>
              )}
            </li>
          );
        });
        if (draftAt !== -1 && draftRow) items.splice(draftAt, 0, draftRow);
        const list = (
          <ul className="tasks" aria-label={group.heading ?? label}>
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
              onFocus={(event) => event.target === event.currentTarget && current.set(key)}
              onClick={() => current.set(key)}
            >
              {group.heading}
            </h3>
            {list}
          </section>
        );
      })}
    </div>
  );
}

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
