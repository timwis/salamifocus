import { groupByTag, placedTags, type TagGroup, type TagNode } from './tags.ts';

// Agendas shows, before meeting someone, everything involving them: the tasks
// carrying a tag beneath the People tag (see `peopleTagColumn`), grouped by
// person. People may be nested in groups ("Family : Mum").

/** The tags beneath the People tag, as a tree whose paths start below People. Empty when it is not in the tree. */
export function peopleIn(tree: readonly TagNode[], peopleTagId: string | null): TagNode[] {
  if (peopleTagId === null) return [];
  return placedTags(tree).find((p) => p.tag.id === peopleTagId)?.tag.children ?? [];
}

/**
 * What Agendas shows for these tasks (already limited to those the visibility
 * shows, oldest first): one group per person in sidebar order, headed by the
 * path below People, each holding the tasks carrying that person's tag. A task
 * with two people appears under each; other tags on it don't change where it
 * goes.
 */
export function agendasView<T>(people: readonly TagNode[], tasks: readonly T[], tagsOf: (task: T) => readonly string[]): TagGroup<T>[] {
  return groupByTag(placedTags(people), tasks, tagsOf);
}
