import { isFolderScope, OperationName, scopeFolderColumn, settingsId, type FolderScope } from '@salamifocus/domain';
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
