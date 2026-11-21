// The user's settings: one row, synced to every client, with a fixed id so
// every client and the server refer to the same row from the start.

export const settingsId = '00000000-0000-4000-8000-000000000001';

/**
 * The parts of the user's life that each have an Actionable perspective,
 * scoped to a folder the user designates. The folder is held by id, so
 * renaming or moving it keeps the perspective pointing at it.
 */
export const FolderScope = {
  personal: 'personal',
  work: 'work',
} as const;

export type FolderScope = (typeof FolderScope)[keyof typeof FolderScope];

export const folderScopes: readonly FolderScope[] = [FolderScope.personal, FolderScope.work];

export function isFolderScope(value: unknown): value is FolderScope {
  return folderScopes.includes(value as FolderScope);
}

/** The settings column holding the folder designated for a scope. */
export const scopeFolderColumn = {
  [FolderScope.personal]: 'personal_folder_id',
  [FolderScope.work]: 'work_folder_id',
} as const satisfies Record<FolderScope, string>;

/**
 * The settings column holding the People tag. Each tag beneath it stands for
 * a person, and Agendas groups their tasks by them. Held by id, like the
 * folders.
 */
export const peopleTagColumn = 'people_tag_id';
