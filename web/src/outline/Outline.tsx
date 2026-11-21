import {
  describeDate,
  describeMoment,
  describeTime,
  isOverdue,
  normaliseTitle,
  positionAt,
  positionBetween,
  tagPathSeparator,
  titleProblem,
  Unavailable,
  Visibility,
} from '@salamifocus/domain';
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { useNow } from '../clock.ts';
import { isTyping, useCurrentRow, useRovingFocus } from '../focus.ts';
import { taskUnavailability, type TaskState } from '../queries.ts';
import { tagsInOrder, useTags, useTaskTags } from '../tags/data.tsx';
import { completeTask, createTask, nestTask, reopenTask, reorderTask, toggleTaskFlag } from '../writes.ts';
import { ProjectDatesEditor, type DatedProject } from './ProjectDatesEditor.tsx';
import { TaskEditor, type Field } from './TaskEditor.tsx';
import { VisibilitySelector } from './VisibilitySelector.tsx';

export interface OutlineTask extends Partial<TaskState> {
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
  /**
   * Whether the tasks are in an order and hierarchy of their own (a project's, in full), which new tasks slot into
   * and Alt+arrows change. Otherwise a task added to a project goes at its end.
   */
  ordered: boolean;
  /** The project the group is, whose dates can be edited from its heading. */
  project?: DatedProject & { paused: boolean };
  /**
   * A heading over this and the following groups that share it, such as a day in Forecast. In a section, the
   * group's own heading is a label rather than a row, and a group with no tasks is left out.
   */
  section?: { id: string; heading: string; empty?: string };
  /** The tasks were placed on the section's day by this date, which is shown as just its time. */
  datedBy?: 'defer' | 'due';
}

/** Where focus goes when the current task leaves its group: the group it is now shown in, if any. */
export type Relocate = (task: { taskId: string; groupId: string }, groups: readonly OutlineGroup[]) => string | null;

type Row = { key: string; group: OutlineGroup } & ({ kind: 'heading' } | { kind: 'task'; task: OutlineTask; index: number });

type Editing =
  | { mode: 'task'; rowKey: string; taskId: string; startIn: Field }
  | { mode: 'project'; rowKey: string }
  | { mode: 'draft'; groupId: string; parentId: string | null; depth: number; after: string | null; before: string | null; returnTo: string | null };

const EMPTY = 'empty';
const headingKey = (group: OutlineGroup) => `group:${group.id}`;
const taskKey = (group: OutlineGroup, taskId: string) => `${group.id}/${taskId}`;
const hasHeadingRow = (group: OutlineGroup) => group.heading !== null && !group.section;

const parentOf = (task: OutlineTask) => task.parentId ?? null;

/** Completes an unfinished task, or marks a completed one (shown under Everything) unfinished again. */
const toggleCompletion = (task: OutlineTask) => (task.completedAt ? reopenTask(task.id) : completeTask(task.id));
const toggleFlag = (task: OutlineTask) => toggleTaskFlag(task.id);
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
  visibility,
  onEditing,
  relocate,
}: {
  title: string;
  summary?: ReactNode;
  groups: OutlineGroup[];
  empty: ReactNode;
  /** How much the outline shows, where the perspective offers a choice. */
  visibility?: { value: Visibility; choose: (visibility: Visibility) => void };
  /** Told which task is being edited (null when none), so the perspective can keep it shown while an edit hides it. */
  onEditing?: (taskId: string | null) => void;
  /** Lets focus follow the current task when it moves to another group, rather than stay at its old place. */
  relocate?: Relocate;
}) {
  const rows: Row[] = groups.flatMap((group) => [
    ...(hasHeadingRow(group) ? [{ key: headingKey(group), group, kind: 'heading' as const }] : []),
    ...group.tasks.map((task, index) => ({ key: taskKey(group, task.id), group, kind: 'task' as const, task, index })),
  ]);
  const tags = useTags();
  const taskTags = useTaskTags();
  const current = useCurrentRow(
    rows.map((r) => r.key),
    null,
    relocate &&
      ((missing) => {
        const at = missing.lastIndexOf('/');
        const task = { groupId: missing.slice(0, at), taskId: missing.slice(at + 1) };
        const group = groups.find((g) => g.id === relocate(task, groups));
        return group ? taskKey(group, task.taskId) : null;
      }),
  );
  const [editing, setEditing] = useState<Editing | null>(null);
  const focused = rows[current.index] ?? null;
  // Rows change when a defer or due date passes, with nothing in the data changing.
  const now = useNow(groups.flatMap((g) => [g.project?.deferUntil, g.project?.dueAt, ...g.tasks.flatMap((t) => [t.deferredUntil, t.dueBy])]));

  // The task or project being edited can disappear, for example when another device completes it.
  const editedTaskGone = (editing?.mode === 'task' || editing?.mode === 'project') && !rows.some((r) => r.key === editing.rowKey);
  useEffect(() => {
    if (editedTaskGone) setEditing(null);
  }, [editedTaskGone]);
  const editedTaskId = editing?.mode === 'task' ? editing.taskId : null;
  useEffect(() => onEditing?.(editedTaskId), [onEditing, editedTaskId]);
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

  function editProject(key: string) {
    roving.claim();
    current.set(key);
    setEditing({ mode: 'project', rowKey: key });
  }

  function openEditor(key: string, taskId: string) {
    roving.claim();
    current.set(key);
    setEditing({ mode: 'task', rowKey: key, taskId, startIn: 'title' });
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
        return handled(), void toggleCompletion(focused.task);
      case 'f':
        if (focused?.kind !== 'task') return;
        return handled(), void toggleFlag(focused.task);
      case 'Enter':
        if (focused?.kind === 'heading' && focused.group.project) return handled(), editProject(focused.key);
        if (focused?.kind !== 'task') return;
        return handled(), setEditing({ mode: 'task', rowKey: focused.key, taskId: focused.task.id, startIn: 'title' });
      case 'p':
        if (focused?.kind !== 'task') return;
        return handled(), setEditing({ mode: 'task', rowKey: focused.key, taskId: focused.task.id, startIn: 'project' });
      case 't':
        if (focused?.kind !== 'task') return;
        return handled(), setEditing({ mode: 'task', rowKey: focused.key, taskId: focused.task.id, startIn: 'tags' });
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
        <div className="outline-actions">
          {visibility && <VisibilitySelector value={visibility.value} choose={visibility.choose} />}
          {groups.some((g) => g.newTask) && (
            // The mouse equivalent of N, kept out of the Tab order so Tab still moves between regions.
            <button type="button" tabIndex={-1} aria-label="New task" title="New task (N)" aria-keyshortcuts="N" onClick={startDraft}>
              + New task
            </button>
          )}
        </div>
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
        {rows.length === 0 && editing === null && empty != null && <p className="empty">{empty}</p>}
        {withSections(groups, groups.map((group) => {
          const draftAt = editing?.mode === 'draft' && editing.groupId === group.id ? draftIndex(group, editing.parentId, editing.after) : -1;
          const items = group.tasks.map((task) => {
            const key = taskKey(group, task.id);
            const isCurrent = key === focused?.key && !editing;
            const tagIds = taskTags.get(task.id) ?? [];
            const chips = tagsInOrder(tags, tagIds);
            const unavailable = taskUnavailability(task, now);
            const completed = task.completedAt ?? null;
            const blocked = unavailable.includes(Unavailable.blocked);
            // Under a project's own heading, that heading says it is paused.
            const paused = unavailable.includes(Unavailable.paused) && !group.project;
            const deferred = unavailable.includes(Unavailable.deferred) && task.deferredUntil ? task.deferredUntil : null;
            // A defer date that has passed is still worth seeing (the inherited one, where it placed the task on a day); a future one shows as the deferral itself.
            const pastDefer = deferred ? null : ((group.datedBy === 'defer' ? task.deferredUntil : task.deferUntil) ?? null);
            const dateOf = (kind: 'defer' | 'due', value: string) =>
              group.datedBy === kind ? describeTime(value) : describeDate(value, kind, now);
            return (
              <li
                key={key}
                data-key={key}
                className={completed ? 'task-row completed' : 'task-row'}
                aria-level={group.ordered ? depthOf(task) : undefined}
                style={indentBy(depthOf(task))}
                tabIndex={isCurrent ? 0 : -1}
                data-current={key === focused?.key || undefined}
                data-unavailable={unavailable.join(' ') || undefined}
                onClick={() => current.set(key)}
                onMouseDown={(event) => actOnPress(event, key, () => current.set(key))}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  className={completed ? 'check done' : 'check'}
                  aria-label={completed ? `Mark ${task.title} unfinished` : `Complete ${task.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    void toggleCompletion(task);
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
                        onClick={() => openEditor(key, task.id)}
                        onMouseDown={(event) => {
                          event.stopPropagation();
                          actOnPress(event, key, () => openEditor(key, task.id));
                        }}
                      >
                        {task.title}
                      </button>
                      {(chips.length > 0 || task.projectName || completed || blocked || deferred || paused || pastDefer || task.dueBy) && (
                        <span className="task-meta">
                          {completed && <span className="completion">Completed {describeMoment(completed, now)}</span>}
                          {blocked && (
                            <span className="availability" title="Waiting on an unfinished task beneath it">
                              Blocked
                            </span>
                          )}
                          {deferred && (
                            <span
                              className="availability"
                              title={deferred === task.deferUntil ? undefined : 'Deferred with a task it is beneath, or its project'}
                            >
                              Deferred until {dateOf('defer', deferred)}
                            </span>
                          )}
                          {paused && <span className="availability">Project paused</span>}
                          {pastDefer && <span className="task-date">Deferred until {dateOf('defer', pastDefer)}</span>}
                          {task.dueBy && (
                            <span
                              className={!completed && isOverdue(task.dueBy, now) ? 'task-date overdue' : 'task-date'}
                              title={task.dueBy === task.dueAt ? undefined : 'Due with a task it is beneath, or its project'}
                            >
                              Due {dateOf('due', task.dueBy)}
                            </span>
                          )}
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
                    <button
                      type="button"
                      tabIndex={-1}
                      className="flag"
                      aria-label={`Flag ${task.title}`}
                      aria-pressed={Boolean(task.flagged)}
                      aria-keyshortcuts="F"
                      title={task.flagged ? 'Flagged (F)' : 'Flag (F)'}
                      onClick={(event) => {
                        event.stopPropagation();
                        void toggleFlag(task);
                      }}
                    />
                  </>
                )}
              </li>
            );
          });
          if (draftAt !== -1 && draftRow) items.splice(draftAt, 0, draftRow);
          const list = (
            <ul className="tasks" aria-label={group.section ? [group.section.heading, group.heading].filter(Boolean).join(': ') : (group.heading ?? title)} data-group={group.id}>
              {items}
            </ul>
          );
          if (group.section) {
            if (group.tasks.length === 0) return null;
            return (
              <div key={group.id}>
                {group.heading !== null && <h4 className="group-label">{group.heading}</h4>}
                {list}
              </div>
            );
          }
          if (group.heading === null) return <div key={group.id}>{list}</div>;
          const key = headingKey(group);
          const { project } = group;
          const editingProject = editing?.mode === 'project' && editing.rowKey === key;
          const projectDeferred = project?.deferUntil && Date.parse(project.deferUntil) > now.getTime() ? project.deferUntil : null;
          const described = project && (project.deferUntil || project.dueAt || project.paused) && !editingProject;
          return (
            <section key={group.id} aria-labelledby={`heading-${group.id}`}>
              <h3
                className="project-heading"
                data-key={key}
                tabIndex={key === focused?.key && !editing ? 0 : -1}
                data-current={key === focused?.key || undefined}
                aria-labelledby={`heading-${group.id}`}
                aria-describedby={described ? `heading-dates-${group.id}` : undefined}
                onClick={() => current.set(key)}
                onDoubleClick={project ? () => editProject(key) : undefined}
                onMouseDown={(event) => actOnPress(event, key, () => current.set(key))}
              >
                <span id={`heading-${group.id}`}>{group.heading}</span>
                {described && (
                  <span id={`heading-dates-${group.id}`} className="task-meta">
                    {project.paused && <span className="availability">Paused</span>}
                    {project.deferUntil &&
                      (projectDeferred ? (
                        <span className="availability">Deferred until {describeDate(projectDeferred, 'defer', now)}</span>
                      ) : (
                        <span className="task-date">Deferred until {describeDate(project.deferUntil, 'defer', now)}</span>
                      ))}
                    {project.dueAt && (
                      <span className={isOverdue(project.dueAt, now) ? 'task-date overdue' : 'task-date'}>Due {describeDate(project.dueAt, 'due', now)}</span>
                    )}
                  </span>
                )}
              </h3>
              {editingProject && project && <ProjectDatesEditor project={project} onClose={() => setEditing(null)} />}
              {list}
              {group.tasks.length === 0 && draftAt === -1 && (
                <p className="hint">
                  {visibility?.value === Visibility.available
                    ? 'Nothing available. Press V to show remaining tasks.'
                    : 'No tasks yet. Press N or use New task to add one.'}
                </p>
              )}
            </section>
          );
        }))}
      </div>
    </main>
  );
}

/** Puts each run of groups sharing a section under that section's heading, with its hint when all are empty. */
function withSections(groups: readonly OutlineGroup[], rendered: readonly ReactNode[]): ReactNode[] {
  const out: ReactNode[] = [];
  for (let i = 0; i < groups.length; ) {
    const section = groups[i]!.section;
    if (!section) {
      out.push(rendered[i++]);
      continue;
    }
    const start = i;
    while (i < groups.length && groups[i]!.section?.id === section.id) i++;
    const id = `section-${section.id}`;
    out.push(
      <section key={id} className="outline-section" data-section={section.id} aria-labelledby={id}>
        <h3 id={id} className="section-heading">
          {section.heading}
        </h3>
        {rendered.slice(start, i)}
        {section.empty && groups.slice(start, i).every((g) => g.tasks.length === 0) && <p className="hint">{section.empty}</p>}
      </section>,
    );
  }
  return out;
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
