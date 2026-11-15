import { captureProblem, normaliseNote, normaliseTitle, OperationName, positionProblem, titleFromCapture, titleProblem } from '@salamifocus/domain';
import * as args from './arguments.ts';
import type { Mutations } from './mutations.ts';
import { organisationOperations } from './organisation.ts';
import { Rejection } from './rejection.ts';
import { tagOperations } from './tags.ts';

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
  title: string;
  position: string | null;
  createdAt: string;
  /** Tags to put on the task, each with the id of its link. */
  tags: { taskTagId: string; tagId: string }[];
}

/**
 * Adds a task, with any tags, as one operation. A task added to a project or
 * single-action list never passes through the Inbox; one added without a
 * project (from a tag, say) waits there until it has one.
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
      title: args.text(a, 'title'),
      position: a.position === undefined || a.position === null ? null : args.text(a, 'position'),
      createdAt: args.timestamp(a, 'createdAt', now),
      tags: tags.map((link) => {
        const l = args.record(link);
        return { taskTagId: args.uuid(l, 'taskTagId'), tagId: args.uuid(l, 'tagId') };
      }),
    };
  },
  async apply(mutations, { taskId, projectId, title, position, createdAt, tags }) {
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
    await mutations.create('task', taskId, { title: normaliseTitle(title), project_id: projectId, position, created_at: createdAt });
    const added = new Set<string>();
    for (const { taskTagId, tagId } of tags) {
      if (!(await mutations.exists('tag', tagId))) throw new Rejection('not_found', 'That tag no longer exists.');
      if (await mutations.exists('task_tag', taskTagId)) throw new Rejection('already_exists', 'Something with that id already exists.');
      if (added.has(tagId)) continue;
      added.add(tagId);
      await mutations.create('task_tag', taskTagId, { task_id: taskId, tag_id: tagId });
    }
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

const definitions = [captureText, renameTask, createTask, editTaskNote, completeTask, reorderTask, ...organisationOperations, ...tagOperations] as OperationDefinition<unknown>[];

export function findOperation(name: string): OperationDefinition<unknown> | undefined {
  return definitions.find((definition) => definition.name === name);
}
