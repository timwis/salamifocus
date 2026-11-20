import { groupByTag, type PlacedTag } from './tags.ts';

// The Actionable perspectives show the available tasks in a designated folder
// (see `FolderScope`) as individual actions, grouped by tag. Within a group,
// tasks are oldest first, so long-lingering ones stay at the top.

/** The group, and sidebar entry, for available tasks with no tag. */
export const untaggedId = 'untagged';

export interface ActionableGroup<T> {
  /** The group's tag with its full path, or null for the untagged group. */
  tag: PlacedTag | null;
  tasks: T[];
}

/**
 * Groups tasks (already limited to available ones in scope, oldest first) by
 * tag, in sidebar order, each group holding the tasks carrying that tag; a
 * task with several tags appears under each (as in Tags). Tasks with no tag
 * follow in a last, untagged group, so nothing available is hidden.
 */
export function actionableGroups<T>(placed: readonly PlacedTag[], tasks: readonly T[], tagsOf: (task: T) => readonly string[]): ActionableGroup<T>[] {
  const known = new Set(placed.map((p) => p.tag.id));
  const groups: ActionableGroup<T>[] = groupByTag(placed, tasks, tagsOf).map(({ tasks, ...tag }) => ({ tag, tasks }));
  const untagged = tasks.filter((task) => !tagsOf(task).some((id) => known.has(id)));
  if (untagged.length > 0) groups.push({ tag: null, tasks: untagged });
  return groups;
}
