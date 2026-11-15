import { OperationName, wouldNestInItself } from '@salamifocus/domain';
import * as args from './arguments.ts';
import type { Mutations, Row } from './mutations.ts';
import type { OperationDefinition } from './operations.ts';
import { checkPosition } from './organisation.ts';
import { Rejection } from './rejection.ts';

/** Checks that a task in `projectId` can go beneath `parentId`: the parent exists, is unfinished and is in the same project. */
export async function checkParent(mutations: Mutations, projectId: string | null, parentId: string): Promise<void> {
  const parent = await mutations.read('task', parentId);
  if (!parent) throw new Rejection('not_found', 'That task no longer exists.');
  // Another device may have completed it while this one was offline.
  if (parent.completed_at !== null) throw new Rejection('parent_completed', 'That task has already been completed.');
  if (projectId === null || parent.project_id !== projectId) {
    throw new Rejection('different_project', 'A task can only go beneath another task in the same project.');
  }
}

/**
 * Moves a task out of its parent and into another project (or none), taking its own children, to any depth,
 * with it: a task's prerequisites go wherever it goes, keeping their places beneath it. The caller holds the
 * 'task-hierarchy' lock, taken before reading the task.
 */
export async function moveWithChildren(mutations: Mutations, task: Row, projectId: string | null, position: string | null) {
  const from = task.project_id as string | null;
  const children = new Map<string, string[]>();
  if (from !== projectId) {
    for (const t of await mutations.list('task', { column: 'project_id', value: from })) {
      const parent = t.parent_id as string | null;
      if (parent !== null) children.set(parent, [...(children.get(parent) ?? []), t.id as string]);
    }
  }
  await mutations.update('task', task.id as string, { project_id: projectId, parent_id: null, position });
  const moved = new Set([task.id as string]);
  const queue = [...(children.get(task.id as string) ?? [])];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    if (moved.has(id)) continue;
    moved.add(id);
    await mutations.update('task', id, { project_id: projectId });
    queue.push(...(children.get(id) ?? []));
  }
}

export interface NestTaskArgs {
  taskId: string;
  /** The task to go beneath, null for the top of the project, or undefined to keep the same parent. */
  parentId: string | null | undefined;
  /**
   * Where it goes among its siblings, or undefined to keep its position. A synced client leaves it out
   * whenever it is unchanged, even with a new parent, so other callers should always send it with one.
   */
  position: string | undefined;
}

/**
 * Moves a task beneath another task in its project, making it one of that
 * task's prerequisites, or back out. Its own children move with it.
 */
export const nestTask: OperationDefinition<NestTaskArgs> = {
  name: OperationName.nestTask,
  parse(input) {
    const a = args.record(input);
    return { taskId: args.uuid(a, 'taskId'), parentId: args.nullableUuid(a, 'parentId'), position: args.optionalText(a, 'position') };
  },
  async apply(mutations, { taskId, parentId, position }) {
    if (parentId === undefined && position === undefined) {
      throw new Rejection('invalid_arguments', 'A move needs a new parent or a new position.');
    }
    const patch: Record<string, string | null> = {};
    if (position !== undefined) patch.position = checkPosition(position);
    if (parentId !== undefined) {
      // As with folders: two devices nesting tasks beneath each other at once must not form a cycle.
      await mutations.lock('task-hierarchy');
      const task = await mutations.read('task', taskId);
      if (!task) throw new Rejection('not_found', 'That task no longer exists.');
      if (parentId !== null) {
        const projectId = task.project_id as string | null;
        await checkParent(mutations, projectId, parentId);
        const tasks = await mutations.list('task', { column: 'project_id', value: projectId });
        const parents = new Map(tasks.map((t) => [t.id as string, t.parent_id as string | null]));
        if (wouldNestInItself(taskId, parentId, (id) => parents.get(id))) {
          throw new Rejection('would_nest_in_itself', 'A task cannot go beneath itself or one of its own prerequisites.');
        }
      }
      patch.parent_id = parentId;
    }
    await mutations.update('task', taskId, patch);
  },
};
