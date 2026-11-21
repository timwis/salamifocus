import { actionableView } from './actionable.ts';
import { placedTags, type TagGroup, type TagNode } from './tags.ts';

// Agendas shows, before meeting someone, everything involving them: the tasks
// carrying a tag beneath the People tag (see `peopleTagColumn`), grouped by
// person. People may be nested in groups ("Family : Mum").

/** The tags beneath the People tag, as a tree whose paths start below People. Empty when it is not in the tree. */
export function peopleIn(tree: readonly TagNode[], peopleTagId: string | null): TagNode[] {
  if (peopleTagId === null) return [];
  return placedTags(tree).find((p) => p.tag.id === peopleTagId)?.tag.children ?? [];
}

export interface AgendasView<T> {
  groups: TagGroup<T>[];
  /** The people with tasks, and the groups above them needed to reach them, in sidebar order. */
  sidebar: TagNode[];
}

/**
 * What Agendas shows for these tasks (already limited to those the visibility
 * shows, oldest first).
 *
 * Groups: one per person in sidebar order, headed by the path below People,
 * each holding the tasks carrying that person's tag. A task with two people
 * appears under each; other tags on it don't change where it goes. Selecting
 * a person (or a group of people) shows only their branch.
 *
 * Sidebar: only the people with tasks, and their ancestors. The selected
 * person stays even once their tasks have gone, so the selection is still
 * shown.
 */
export function agendasView<T>(people: readonly TagNode[], selected: string | null, tasks: readonly T[], tagsOf: (task: T) => readonly string[]): AgendasView<T> {
  const { groups, sidebar } = actionableView(people, selected, tasks, tagsOf);
  return {
    // A task with none of these tags (not synced yet, say) is on no agenda.
    groups: groups.flatMap(({ tag, tasks }) => (tag ? [{ ...tag, tasks }] : [])),
    sidebar: sidebar.tags,
  };
}
