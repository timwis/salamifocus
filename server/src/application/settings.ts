import { isFolderScope, OperationName, peopleTagColumn, scopeFolderColumn, settingsId, type FolderScope } from '@salamifocus/domain';
import * as args from './arguments.ts';
import type { Mutations } from './mutations.ts';
import type { OperationDefinition } from './operations.ts';
import { Rejection } from './rejection.ts';

export interface DesignateFolderArgs {
  scope: FolderScope;
  /** The folder the scope's Actionable perspective shows, or null for none. */
  folderId: string | null;
}

/** Chooses the folder (with everything inside it) that Actionable — Personal or Actionable — Work shows. */
export const designateFolder: OperationDefinition<DesignateFolderArgs> = {
  name: OperationName.designateFolder,
  parse(input) {
    const a = args.record(input);
    if (!isFolderScope(a.scope)) throw new Rejection('invalid_arguments', 'scope must be "personal" or "work".');
    const folderId = args.nullableUuid(a, 'folderId');
    if (folderId === undefined) throw new Rejection('invalid_arguments', 'A designation needs a folder, or null for none.');
    return { scope: a.scope, folderId };
  },
  async apply(mutations: Mutations, { scope, folderId }) {
    if (folderId !== null && !(await mutations.exists('folder', folderId))) throw new Rejection('not_found', 'That folder no longer exists.');
    await mutations.update('setting', settingsId, { [scopeFolderColumn[scope]]: folderId });
  },
};

export interface DesignatePeopleTagArgs {
  /** The tag whose descendants are the people Agendas groups by, or null for none. */
  tagId: string | null;
}

/** Chooses the People tag: each tag beneath it is a person with an agenda. */
export const designatePeopleTag: OperationDefinition<DesignatePeopleTagArgs> = {
  name: OperationName.designatePeopleTag,
  parse(input) {
    const tagId = args.nullableUuid(args.record(input), 'tagId');
    if (tagId === undefined) throw new Rejection('invalid_arguments', 'A designation needs a tag, or null for none.');
    return { tagId };
  },
  async apply(mutations: Mutations, { tagId }) {
    if (tagId !== null && !(await mutations.exists('tag', tagId))) throw new Rejection('not_found', 'That tag no longer exists.');
    await mutations.update('setting', settingsId, { [peopleTagColumn]: tagId });
  },
};
