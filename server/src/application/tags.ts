import { OperationName, wouldNestInItself } from '@salamifocus/domain';
import * as args from './arguments.ts';
import type { Mutations } from './mutations.ts';
import type { OperationDefinition } from './operations.ts';
import { checkName, checkPosition, type RenameArgs } from './organisation.ts';
import { Rejection } from './rejection.ts';

async function checkTagExists(mutations: Mutations, tagId: string | null | undefined): Promise<void> {
  if (tagId && !(await mutations.exists('tag', tagId))) throw new Rejection('not_found', 'That tag no longer exists.');
}

export interface CreateTagArgs {
  tagId: string;
  name: string;
  parentId: string | null;
  position: string;
}

export const createTag: OperationDefinition<CreateTagArgs> = {
  name: OperationName.createTag,
  parse(input) {
    const a = args.record(input);
    return {
      tagId: args.uuid(a, 'tagId'),
      name: args.text(a, 'name'),
      parentId: args.nullableUuid(a, 'parentId') ?? null,
      position: args.text(a, 'position'),
    };
  },
  async apply(mutations, { tagId, name, parentId, position }) {
    const values = { name: checkName(name), parent_id: parentId, position: checkPosition(position) };
    if (await mutations.exists('tag', tagId)) throw new Rejection('already_exists', 'Something with that id already exists.');
    await checkTagExists(mutations, parentId);
    await mutations.create('tag', tagId, values);
  },
};

export const renameTag: OperationDefinition<RenameArgs> = {
  name: OperationName.renameTag,
  parse(input) {
    const a = args.record(input);
    return { id: args.uuid(a, 'tagId'), name: args.text(a, 'name') };
  },
  async apply(mutations, { id, name }) {
    await mutations.update('tag', id, { name: checkName(name) });
  },
};

export interface MoveTagArgs {
  tagId: string;
  /** The tag to move under, null for the top level, or undefined to keep the same parent. */
  parentId: string | null | undefined;
  position: string | undefined;
}

export const moveTag: OperationDefinition<MoveTagArgs> = {
  name: OperationName.moveTag,
  parse(input) {
    const a = args.record(input);
    return { tagId: args.uuid(a, 'tagId'), parentId: args.nullableUuid(a, 'parentId'), position: args.optionalText(a, 'position') };
  },
  async apply(mutations, { tagId, parentId, position }) {
    if (parentId === undefined && position === undefined) {
      throw new Rejection('invalid_arguments', 'A move needs a new parent or a new position.');
    }
    const patch: Record<string, string | null> = {};
    if (position !== undefined) patch.position = checkPosition(position);
    if (parentId !== undefined) {
      // As with folders: two devices nesting tags under each other at once must not form a cycle.
      await mutations.lock('tag-hierarchy');
      await checkTagExists(mutations, parentId);
      const parents = new Map((await mutations.list('tag')).map((t) => [t.id as string, t.parent_id as string | null]));
      if (wouldNestInItself(tagId, parentId, (id) => parents.get(id))) {
        throw new Rejection('would_nest_in_itself', 'A tag cannot go inside itself.');
      }
      patch.parent_id = parentId;
    }
    await mutations.update('tag', tagId, patch);
  },
};


export interface TagTaskArgs {
  taskTagId: string;
  taskId: string;
  tagId: string;
}

/** Puts a tag on a task. Adding a tag the task already has changes nothing. */
export const tagTask: OperationDefinition<TagTaskArgs> = {
  name: OperationName.tagTask,
  parse(input) {
    const a = args.record(input);
    return { taskTagId: args.uuid(a, 'taskTagId'), taskId: args.uuid(a, 'taskId'), tagId: args.uuid(a, 'tagId') };
  },
  async apply(mutations, { taskTagId, taskId, tagId }) {
    // Locking the task serialises tagging it, so the same tag cannot be added twice at once.
    if (!(await mutations.read('task', taskId))) throw new Rejection('not_found', 'That task no longer exists.');
    await addTaskTag(mutations, taskId, { taskTagId, tagId });
  },
};

/** Links a tag to a task, unless the task already has it. Shared by tagging and by creating a task with tags. */
export async function addTaskTag(mutations: Mutations, taskId: string, { taskTagId, tagId }: { taskTagId: string; tagId: string }): Promise<void> {
  await checkTagExists(mutations, tagId);
  if (await mutations.exists('task_tag', taskTagId)) throw new Rejection('already_exists', 'Something with that id already exists.');
  if ((await mutations.taskTagId(taskId, tagId)) !== null) return;
  await mutations.create('task_tag', taskTagId, { task_id: taskId, tag_id: tagId });
}

export interface UntagTaskArgs {
  taskId: string;
  tagId: string;
}

/**
 * Takes a tag off a task. It removes whichever link the server holds, which
 * may not be the one the client saw: two offline devices can add the same
 * tag, and only the first link is kept. Removing a tag the task does not
 * have changes nothing.
 */
export const untagTask: OperationDefinition<UntagTaskArgs> = {
  name: OperationName.untagTask,
  parse(input) {
    const a = args.record(input);
    return { taskId: args.uuid(a, 'taskId'), tagId: args.uuid(a, 'tagId') };
  },
  async apply(mutations, { taskId, tagId }) {
    if (!(await mutations.read('task', taskId))) return;
    const link = await mutations.taskTagId(taskId, tagId);
    if (link !== null) await mutations.delete('task_tag', link);
  },
};

export const tagOperations = [createTag, renameTag, moveTag, tagTask, untagTask];
