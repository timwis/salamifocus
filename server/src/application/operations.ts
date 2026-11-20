import { captureProblem, normaliseNote, normaliseTitle, OperationName, positionProblem, titleFromCapture, titleProblem } from '@salamifocus/domain';
import * as args from './arguments.ts';
import type { Mutations } from './mutations.ts';
import { organisationOperations } from './organisation.ts';
import { Rejection } from './rejection.ts';
import { checkParent, moveWithChildren, nestTask } from './prerequisites.ts';
import { addTaskTag, tagOperations } from './tags.ts';

export interface OperationDefinition<A> {
  name: OperationName;
  parse(input: unknown, now: string): A;
  apply(mutations: Mutations, input: A): Promise<void>;
}

export interface CaptureTextArgs {
  taskId: string;
  captureId: string;
  text: string;
  capturedAt: string;
}

export const captureText: OperationDefinition<CaptureTextArgs> = {
  name: OperationName.captureText,
  parse(input, now) {
    const a = args.record(input);
    return {
      taskId: args.uuid(a, 'taskId'),
      captureId: args.uuid(a, 'captureId'),
      text: args.text(a, 'text'),
      capturedAt: args.timestamp(a, 'capturedAt', now),
    };
  },
  async apply(mutations, { taskId, captureId, text, capturedAt }) {
    const problem = captureProblem(text);
    if (problem) throw new Rejection('empty_capture', problem);
    if ((await mutations.exists('task', taskId)) || (await mutations.exists('capture', captureId))) {
      throw new Rejection('already_exists', 'Something with that id already exists.');
    }
    await mutations.create('task', taskId, { title: titleFromCapture(text), created_at: capturedAt });
    await mutations.create('capture', captureId, { task_id: taskId, text, captured_at: capturedAt });
  },
};

export interface RenameTaskArgs {
  taskId: string;
  title: string;
}

export const renameTask: OperationDefinition<RenameTaskArgs> = {
  name: OperationName.renameTask,
  parse(input) {
    const a = args.record(input);
    return { taskId: args.uuid(a, 'taskId'), title: args.text(a, 'title') };
  },
  async apply(mutations, { taskId, title }) {
    const problem = titleProblem(title);
    if (problem) throw new Rejection('invalid_title', problem);
    await mutations.update('task', taskId, { title: normaliseTitle(title) });
  },
};

export interface CreateTaskArgs {
  taskId: string;
  projectId: string | null;
  /** The task it is a prerequisite of, in the same project, or null. */
  parentId: string | null;
  title: string;
  position: string | null;
  createdAt: string;
  /** Tags to put on the task, each with the id of its link. */
  tags: { taskTagId: string; tagId: string }[];
}

/**
 * Adds a task, with any tags, as one operation. Like any task, it waits in
 * the Inbox until it has both a project and a tag.
 */
export const createTask: OperationDefinition<CreateTaskArgs> = {
  name: OperationName.createTask,
  parse(input, now) {
    const a = args.record(input);
    const tags = a.tags === undefined ? [] : a.tags;
    if (!Array.isArray(tags)) throw new Rejection('invalid_arguments', 'tags must be a list.');
    return {
      taskId: args.uuid(a, 'taskId'),
      projectId: args.nullableUuid(a, 'projectId') ?? null,
      parentId: args.nullableUuid(a, 'parentId') ?? null,
      title: args.text(a, 'title'),
      position: a.position === undefined || a.position === null ? null : args.text(a, 'position'),
      createdAt: args.timestamp(a, 'createdAt', now),
      tags: tags.map((link) => {
        const l = args.record(link);
        return { taskTagId: args.uuid(l, 'taskTagId'), tagId: args.uuid(l, 'tagId') };
      }),
    };
  },
  async apply(mutations, { taskId, projectId, parentId, title, position, createdAt, tags }) {
    const badTitle = titleProblem(title);
    if (badTitle) throw new Rejection('invalid_title', badTitle);
    if (projectId !== null) {
      const badPosition = position === null ? 'A task in a project needs a position.' : positionProblem(position);
      if (badPosition) throw new Rejection('invalid_position', badPosition);
    } else if (position !== null) {
      throw new Rejection('invalid_position', 'Only tasks in a project have a position.');
    }
    if (await mutations.exists('task', taskId)) throw new Rejection('already_exists', 'Something with that id already exists.');
    if (projectId !== null && !(await mutations.exists('project', projectId))) throw new Rejection('not_found', 'That project no longer exists.');
    if (parentId !== null) await checkParent(mutations, projectId, parentId);
    await mutations.create('task', taskId, {
      title: normaliseTitle(title),
      project_id: projectId,
      ...(parentId !== null ? { parent_id: parentId } : {}),
      position,
      created_at: createdAt,
    });
    for (const link of tags) await addTaskTag(mutations, taskId, link);
  },
};

export interface EditTaskNoteArgs {
  taskId: string;
  note: string;
}

export const editTaskNote: OperationDefinition<EditTaskNoteArgs> = {
  name: OperationName.editTaskNote,
  parse(input) {
    const a = args.record(input);
    return { taskId: args.uuid(a, 'taskId'), note: args.text(a, 'note') };
  },
  async apply(mutations, { taskId, note }) {
    await mutations.update('task', taskId, { note: normaliseNote(note) });
  },
};

export interface CompleteTaskArgs {
  taskId: string;
  completedAt: string;
}

export const completeTask: OperationDefinition<CompleteTaskArgs> = {
  name: OperationName.completeTask,
  parse(input, now) {
    const a = args.record(input);
    return { taskId: args.uuid(a, 'taskId'), completedAt: args.timestamp(a, 'completedAt', now) };
  },
  async apply(mutations, { taskId, completedAt }) {
    const task = await mutations.read('task', taskId);
    if (!task) throw new Rejection('not_found', 'That task no longer exists.');
    // Completed on two devices: the first completion stands.
    if (task.completed_at !== null) return;
    await mutations.update('task', taskId, { completed_at: completedAt });
  },
};

export interface ReopenTaskArgs {
  taskId: string;
}

/**
 * Marks a completed task unfinished again, and with it any completed task it is beneath, since a task cannot be
 * done while one of its prerequisites is not. Each completion stays in its task's history.
 */
export const reopenTask: OperationDefinition<ReopenTaskArgs> = {
  name: OperationName.reopenTask,
  parse(input) {
    const a = args.record(input);
    return { taskId: args.uuid(a, 'taskId') };
  },
  async apply(mutations, { taskId }) {
    const task = await mutations.read('task', taskId);
    if (!task) throw new Rejection('not_found', 'That task no longer exists.');
    // Reopened on two devices: the first reopening stands.
    if (task.completed_at === null) return;
    await mutations.update('task', taskId, { completed_at: null });
    const seen = new Set([taskId]);
    for (let parentId = task.parent_id as string | null; parentId !== null && !seen.has(parentId); ) {
      seen.add(parentId);
      const parent = await mutations.read('task', parentId);
      if (!parent) break;
      if (parent.completed_at !== null) await mutations.update('task', parentId, { completed_at: null });
      parentId = parent.parent_id as string | null;
    }
  },
};

export interface DeferTaskArgs {
  taskId: string;
  /** When the task comes back to attention, or null to stop deferring it. */
  deferUntil: string | null;
}

/** Sets when a task (and every task beneath it) becomes available again. Separate from any due date. */
export const deferTask: OperationDefinition<DeferTaskArgs> = {
  name: OperationName.deferTask,
  parse(input) {
    const a = args.record(input);
    return { taskId: args.uuid(a, 'taskId'), deferUntil: args.nullableTime(a, 'deferUntil') };
  },
  async apply(mutations, { taskId, deferUntil }) {
    await mutations.update('task', taskId, { defer_until: deferUntil });
  },
};

export interface SetTaskDueArgs {
  taskId: string;
  /** The task's deadline, or null for none. */
  dueAt: string | null;
}

/** Sets or clears a task's due date. It never changes whether the task can be worked on. */
export const setTaskDue: OperationDefinition<SetTaskDueArgs> = {
  name: OperationName.setTaskDue,
  parse(input) {
    const a = args.record(input);
    return { taskId: args.uuid(a, 'taskId'), dueAt: args.nullableTime(a, 'dueAt') };
  },
  async apply(mutations, { taskId, dueAt }) {
    await mutations.update('task', taskId, { due_at: dueAt });
  },
};

export interface FlagTaskArgs {
  taskId: string;
}

/** Marks a task as one the user intends to do now. The flag stays while the task is deferred or blocked. */
export const flagTask: OperationDefinition<FlagTaskArgs> = {
  name: OperationName.flagTask,
  parse(input) {
    return { taskId: args.uuid(args.record(input), 'taskId') };
  },
  async apply(mutations, { taskId }) {
    await mutations.update('task', taskId, { flagged: true });
  },
};

export const unflagTask: OperationDefinition<FlagTaskArgs> = {
  name: OperationName.unflagTask,
  parse(input) {
    return { taskId: args.uuid(args.record(input), 'taskId') };
  },
  async apply(mutations, { taskId }) {
    await mutations.update('task', taskId, { flagged: false });
  },
};

export interface ReorderTaskArgs {
  taskId: string;
  position: string;
}

/** Moves a task among its siblings. The order is presentation only and implies no sequence. */
export const reorderTask: OperationDefinition<ReorderTaskArgs> = {
  name: OperationName.reorderTask,
  parse(input) {
    const a = args.record(input);
    return { taskId: args.uuid(a, 'taskId'), position: args.text(a, 'position') };
  },
  async apply(mutations, { taskId, position }) {
    const problem = positionProblem(position);
    if (problem) throw new Rejection('invalid_position', problem);
    await mutations.update('task', taskId, { position });
  },
};

export interface MoveTaskArgs {
  taskId: string;
  /** The project or single-action list to move into, or null to take the task out of any. */
  projectId: string | null;
  /** Its place among the project's tasks, or undefined to keep the one it has. */
  position: string | null | undefined;
}

/** Puts a task in a project or single-action list, or takes it out of one, at the top level; its children go with it. */
export const moveTask: OperationDefinition<MoveTaskArgs> = {
  name: OperationName.moveTask,
  parse(input) {
    const a = args.record(input);
    const projectId = args.nullableUuid(a, 'projectId');
    if (projectId === undefined) throw new Rejection('invalid_arguments', 'A move needs a project, or null for none.');
    return {
      taskId: args.uuid(a, 'taskId'),
      projectId,
      position: a.position === undefined ? undefined : a.position === null ? null : args.text(a, 'position'),
    };
  },
  async apply(mutations, { taskId, projectId, position }) {
    await mutations.lock('task-hierarchy');
    const task = await mutations.read('task', taskId);
    if (!task) throw new Rejection('not_found', 'That task no longer exists.');
    if (projectId === null) {
      if (position) throw new Rejection('invalid_position', 'Only tasks in a project have a position.');
      await moveWithChildren(mutations, task, null, null);
      return;
    }
    const next = position === undefined ? (task.position as string | null) : position;
    const badPosition = next === null ? 'A task in a project needs a position.' : positionProblem(next);
    if (badPosition) throw new Rejection('invalid_position', badPosition);
    if (!(await mutations.exists('project', projectId))) throw new Rejection('not_found', 'That project no longer exists.');
    await moveWithChildren(mutations, task, projectId, next);
  },
};

const definitions = [captureText, renameTask, createTask, editTaskNote, completeTask, reopenTask, deferTask, setTaskDue, flagTask, unflagTask, reorderTask, moveTask, nestTask, ...organisationOperations, ...tagOperations] as OperationDefinition<unknown>[];

export function findOperation(name: string): OperationDefinition<unknown> | undefined {
  return definitions.find((definition) => definition.name === name);
}
