import { isProjectKind, nameProblem, normaliseName, OperationName, positionProblem, ProjectStatus, wouldNestInItself, type ProjectKind } from '@salamifocus/domain';
import * as args from './arguments.ts';
import type { Mutations } from './mutations.ts';
import type { OperationDefinition } from './operations.ts';
import { Rejection } from './rejection.ts';

export function checkName(name: string): string {
  const problem = nameProblem(name);
  if (problem) throw new Rejection('invalid_name', problem);
  return normaliseName(name);
}

export function checkPosition(position: string): string {
  const problem = positionProblem(position);
  if (problem) throw new Rejection('invalid_position', problem);
  return position;
}

async function checkFolderExists(mutations: Mutations, folderId: string | null | undefined): Promise<void> {
  if (folderId && !(await mutations.exists('folder', folderId))) {
    throw new Rejection('not_found', 'That folder no longer exists.');
  }
}

async function checkNew(mutations: Mutations, entity: 'folder' | 'project', id: string): Promise<void> {
  if (await mutations.exists(entity, id)) throw new Rejection('already_exists', 'Something with that id already exists.');
}

export interface CreateFolderArgs {
  folderId: string;
  name: string;
  parentId: string | null;
  position: string;
}

export const createFolder: OperationDefinition<CreateFolderArgs> = {
  name: OperationName.createFolder,
  parse(input) {
    const a = args.record(input);
    return {
      folderId: args.uuid(a, 'folderId'),
      name: args.text(a, 'name'),
      parentId: args.nullableUuid(a, 'parentId') ?? null,
      position: args.text(a, 'position'),
    };
  },
  async apply(mutations, { folderId, name, parentId, position }) {
    const values = { name: checkName(name), parent_id: parentId, position: checkPosition(position) };
    await checkNew(mutations, 'folder', folderId);
    await checkFolderExists(mutations, parentId);
    await mutations.create('folder', folderId, values);
  },
};

export interface RenameArgs {
  id: string;
  name: string;
}

export const renameFolder: OperationDefinition<RenameArgs> = {
  name: OperationName.renameFolder,
  parse(input) {
    const a = args.record(input);
    return { id: args.uuid(a, 'folderId'), name: args.text(a, 'name') };
  },
  async apply(mutations, { id, name }) {
    await mutations.update('folder', id, { name: checkName(name) });
  },
};

export interface MoveFolderArgs {
  folderId: string;
  /** The folder to move into, null for the top level, or undefined to stay in the same folder. */
  parentId: string | null | undefined;
  position: string | undefined;
}

export const moveFolder: OperationDefinition<MoveFolderArgs> = {
  name: OperationName.moveFolder,
  parse(input) {
    const a = args.record(input);
    return {
      folderId: args.uuid(a, 'folderId'),
      parentId: args.nullableUuid(a, 'parentId'),
      position: args.optionalText(a, 'position'),
    };
  },
  async apply(mutations, { folderId, parentId, position }) {
    if (parentId === undefined && position === undefined) {
      throw new Rejection('invalid_arguments', 'A move needs a new folder or a new position.');
    }
    const patch: Record<string, string | null> = {};
    if (position !== undefined) patch.position = checkPosition(position);
    if (parentId !== undefined) {
      // Two devices moving folders into each other at once could otherwise
      // both pass the check below and form a cycle together.
      await mutations.lock('folder-hierarchy');
      await checkFolderExists(mutations, parentId);
      const parents = new Map((await mutations.list('folder')).map((f) => [f.id as string, f.parent_id as string | null]));
      if (wouldNestInItself(folderId, parentId, (id) => parents.get(id))) {
        throw new Rejection('would_nest_in_itself', 'A folder cannot go inside itself.');
      }
      patch.parent_id = parentId;
    }
    await mutations.update('folder', folderId, patch);
  },
};

export interface CreateProjectArgs {
  projectId: string;
  name: string;
  kind: ProjectKind;
  folderId: string | null;
  position: string;
}

export const createProject: OperationDefinition<CreateProjectArgs> = {
  name: OperationName.createProject,
  parse(input) {
    const a = args.record(input);
    if (!isProjectKind(a.kind)) throw new Rejection('invalid_arguments', 'kind must be "project" or "single_actions".');
    return {
      projectId: args.uuid(a, 'projectId'),
      name: args.text(a, 'name'),
      kind: a.kind,
      folderId: args.nullableUuid(a, 'folderId') ?? null,
      position: args.text(a, 'position'),
    };
  },
  async apply(mutations, { projectId, name, kind, folderId, position }) {
    const values = { name: checkName(name), kind, folder_id: folderId, position: checkPosition(position) };
    await checkNew(mutations, 'project', projectId);
    await checkFolderExists(mutations, folderId);
    await mutations.create('project', projectId, values);
  },
};

export const renameProject: OperationDefinition<RenameArgs> = {
  name: OperationName.renameProject,
  parse(input) {
    const a = args.record(input);
    return { id: args.uuid(a, 'projectId'), name: args.text(a, 'name') };
  },
  async apply(mutations, { id, name }) {
    await mutations.update('project', id, { name: checkName(name) });
  },
};

export interface MoveProjectArgs {
  projectId: string;
  /** The folder to move into, null for the top level, or undefined to stay in the same folder. */
  folderId: string | null | undefined;
  position: string | undefined;
}

export const moveProject: OperationDefinition<MoveProjectArgs> = {
  name: OperationName.moveProject,
  parse(input) {
    const a = args.record(input);
    return {
      projectId: args.uuid(a, 'projectId'),
      folderId: args.nullableUuid(a, 'folderId'),
      position: args.optionalText(a, 'position'),
    };
  },
  async apply(mutations, { projectId, folderId, position }) {
    if (folderId === undefined && position === undefined) {
      throw new Rejection('invalid_arguments', 'A move needs a new folder or a new position.');
    }
    const patch: Record<string, string | null> = {};
    if (position !== undefined) patch.position = checkPosition(position);
    if (folderId !== undefined) {
      await checkFolderExists(mutations, folderId);
      patch.folder_id = folderId;
    }
    await mutations.update('project', projectId, patch);
  },
};

export interface DeferProjectArgs {
  projectId: string;
  /** When the project's tasks come back to attention, or null to stop deferring it. */
  deferUntil: string | null;
}

/** Defers a project or single-action list, and with it every task inside. */
export const deferProject: OperationDefinition<DeferProjectArgs> = {
  name: OperationName.deferProject,
  parse(input) {
    const a = args.record(input);
    return { projectId: args.uuid(a, 'projectId'), deferUntil: args.nullableTime(a, 'deferUntil') };
  },
  async apply(mutations, { projectId, deferUntil }) {
    await mutations.update('project', projectId, { defer_until: deferUntil });
  },
};

export interface SetProjectDueArgs {
  projectId: string;
  dueAt: string | null;
}

/** Sets or clears a project's due date, which every task inside is due by. */
export const setProjectDue: OperationDefinition<SetProjectDueArgs> = {
  name: OperationName.setProjectDue,
  parse(input) {
    const a = args.record(input);
    return { projectId: args.uuid(a, 'projectId'), dueAt: args.nullableTime(a, 'dueAt') };
  },
  async apply(mutations, { projectId, dueAt }) {
    await mutations.update('project', projectId, { due_at: dueAt });
  },
};

export interface ProjectArgs {
  projectId: string;
}

/** Pauses a project or single-action list: it can still be inspected and edited, but none of its tasks are available. */
export const pauseProject: OperationDefinition<ProjectArgs> = {
  name: OperationName.pauseProject,
  parse(input) {
    return { projectId: args.uuid(args.record(input), 'projectId') };
  },
  async apply(mutations, { projectId }) {
    await mutations.update('project', projectId, { status: ProjectStatus.paused });
  },
};

/** Makes a paused project active again, so its tasks can be available once more. */
export const resumeProject: OperationDefinition<ProjectArgs> = {
  name: OperationName.resumeProject,
  parse(input) {
    return { projectId: args.uuid(args.record(input), 'projectId') };
  },
  async apply(mutations, { projectId }) {
    await mutations.update('project', projectId, { status: ProjectStatus.active });
  },
};

export const organisationOperations = [
  createFolder,
  renameFolder,
  moveFolder,
  createProject,
  renameProject,
  moveProject,
  deferProject,
  setProjectDue,
  pauseProject,
  resumeProject,
];
