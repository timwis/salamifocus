import { captureProblem, normaliseTitle, OperationName, positionProblem, titleFromCapture, titleProblem } from '@salamifocus/domain';
import * as args from './arguments.ts';
import type { Mutations } from './mutations.ts';
import { organisationOperations } from './organisation.ts';
import { Rejection } from './rejection.ts';

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
  projectId: string;
  title: string;
  position: string;
  createdAt: string;
}

/** Adds a task directly to a project or single-action list, so it never passes through the Inbox. */
export const createTask: OperationDefinition<CreateTaskArgs> = {
  name: OperationName.createTask,
  parse(input, now) {
    const a = args.record(input);
    return {
      taskId: args.uuid(a, 'taskId'),
      projectId: args.uuid(a, 'projectId'),
      title: args.text(a, 'title'),
      position: args.text(a, 'position'),
      createdAt: args.timestamp(a, 'createdAt', now),
    };
  },
  async apply(mutations, { taskId, projectId, title, position, createdAt }) {
    const badTitle = titleProblem(title);
    if (badTitle) throw new Rejection('invalid_title', badTitle);
    const badPosition = positionProblem(position);
    if (badPosition) throw new Rejection('invalid_position', badPosition);
    if (await mutations.exists('task', taskId)) throw new Rejection('already_exists', 'Something with that id already exists.');
    if (!(await mutations.exists('project', projectId))) throw new Rejection('not_found', 'That project no longer exists.');
    await mutations.create('task', taskId, { title: normaliseTitle(title), project_id: projectId, position, created_at: createdAt });
  },
};

const definitions = [captureText, renameTask, createTask, ...organisationOperations] as OperationDefinition<unknown>[];

export function findOperation(name: string): OperationDefinition<unknown> | undefined {
  return definitions.find((definition) => definition.name === name);
}
