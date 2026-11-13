import { captureProblem, normaliseTitle, OperationName, titleFromCapture, titleProblem } from '@salamifocus/domain';
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

const definitions = [captureText, renameTask, ...organisationOperations] as OperationDefinition<unknown>[];

export function findOperation(name: string): OperationDefinition<unknown> | undefined {
  return definitions.find((definition) => definition.name === name);
}
