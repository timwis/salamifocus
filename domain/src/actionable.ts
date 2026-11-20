import { branchIn, groupByTag, placedTags, type PlacedTag, type TagNode } from './tags.ts';

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

export interface ActionableSidebar {
  /** The tags carried by the tasks, with the ancestors needed to reach them, in sidebar order. */
  tags: TagNode[];
  /** Whether the sidebar ends with an entry for the tasks with no tag. */
  untagged: boolean;
}

export interface ActionableView<T> {
  groups: ActionableGroup<T>[];
  sidebar: ActionableSidebar;
}

/**
 * What an Actionable perspective shows for these tasks (already limited to
 * available ones in scope, oldest first).
 *
 * Groups: one per tag, in sidebar order, each holding the tasks carrying that
 * tag; a task with several tags appears under each (as in Tags). With nothing
 * selected, every tag's group shows, then a last, untagged group, so nothing
 * available is hidden. Selecting a tag shows the groups of its branch;
 * selecting `untaggedId` shows only the untagged group.
 *
 * Sidebar: only the tags that have tasks, and their ancestors. The selected
 * tag (or the untagged entry) stays even once its tasks have gone, so the
 * selection is still shown.
 */
export function actionableView<T>(
  tree: readonly TagNode[],
  selected: string | null,
  tasks: readonly T[],
  tagsOf: (task: T) => readonly string[],
): ActionableView<T> {
  const placed = placedTags(tree);
  const known = new Set(placed.map((p) => p.tag.id));
  // A task whose tags aren't in the tree (not synced yet, say) counts as untagged.
  const untagged = tasks.filter((task) => !tagsOf(task).some((id) => known.has(id)));
  const untaggedGroup = untagged.length > 0 ? [{ tag: null, tasks: untagged }] : [];
  const tagGroups = (branch: readonly PlacedTag[]) => groupByTag(branch, tasks, tagsOf).map(({ tasks, ...tag }) => ({ tag, tasks }));
  const groups: ActionableGroup<T>[] =
    selected === untaggedId ? untaggedGroup : selected === null ? [...tagGroups(placed), ...untaggedGroup] : tagGroups(branchIn(placed, selected));

  const kept = new Set(tasks.flatMap((task) => tagsOf(task)));
  if (selected !== null) kept.add(selected);
  const prune = (nodes: readonly TagNode[]): TagNode[] =>
    nodes.flatMap((node) => {
      const children = prune(node.children);
      return kept.has(node.id) || children.length > 0 ? [{ ...node, children }] : [];
    });
  return { groups, sidebar: { tags: prune(tree), untagged: selected === untaggedId || untagged.length > 0 } };
}
