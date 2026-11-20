import { comparePositions } from './positions.ts';

// Tags nest to any depth and a task can carry several. Selecting a tag
// covers its descendants too, so a broad context includes narrower ones.

export interface TagRecord {
  id: string;
  name: string;
  parentId: string | null;
  position: string;
}

export interface TagNode {
  id: string;
  name: string;
  position: string;
  children: TagNode[];
}

/** Separates the names in a tag's full path, as in "@Computer : Shallow work". */
export const tagPathSeparator = ' : ';

/**
 * Nests tags into the sidebar hierarchy in sibling order. A tag whose parent
 * is missing (or that is caught in a cycle) is shown at the top level rather
 * than hidden.
 */
export function buildTagTree(tags: readonly TagRecord[]): TagNode[] {
  const ids = new Set(tags.map((t) => t.id));
  const children = new Map<string | null, TagRecord[]>();
  for (const tag of tags) {
    const key = tag.parentId !== null && ids.has(tag.parentId) ? tag.parentId : null;
    const siblings = children.get(key);
    if (siblings) siblings.push(tag);
    else children.set(key, [tag]);
  }
  const visited = new Set<string>();
  const node = (tag: TagRecord): TagNode => {
    visited.add(tag.id);
    return { id: tag.id, name: tag.name, position: tag.position, children: nodesUnder(tag.id) };
  };
  const nodesUnder = (parent: string | null): TagNode[] =>
    (children.get(parent) ?? [])
      .filter((tag) => !visited.has(tag.id))
      .sort(comparePositions)
      .map(node);

  const roots = nodesUnder(null);
  for (const tag of [...tags].sort(comparePositions)) if (!visited.has(tag.id)) roots.push(node(tag));
  return roots;
}

export interface PlacedTag {
  tag: TagNode;
  /** Names from the top-level tag down to this one. */
  path: string[];
}

/** Every tag in sidebar order (each before its descendants), with its full path. */
export function placedTags(tree: readonly TagNode[]): PlacedTag[] {
  const walk = (nodes: readonly TagNode[], above: string[]): PlacedTag[] =>
    nodes.flatMap((tag) => {
      const path = [...above, tag.name];
      return [{ tag, path }, ...walk(tag.children, path)];
    });
  return walk(tree, []);
}

/** A tag and every tag beneath it, in sidebar order, with full paths. Empty if the tag is not in the tree. */
export function tagBranch(tree: readonly TagNode[], tagId: string): PlacedTag[] {
  return branchIn(placedTags(tree), tagId);
}

/** `tagBranch`, from tags already placed (by `placedTags`). */
export function branchIn(placed: readonly PlacedTag[], tagId: string): PlacedTag[] {
  const start = placed.findIndex((p) => p.tag.id === tagId);
  if (start === -1) return [];
  const depth = placed[start]!.path.length;
  let end = start + 1;
  while (end < placed.length && placed[end]!.path.length > depth) end++;
  return placed.slice(start, end);
}

export interface TagGroup<T> extends PlacedTag {
  tasks: T[];
}

/**
 * What selecting a tag shows: one group per tag in its branch (from
 * `tagBranch`) that has tasks, in sidebar order. A task carrying several
 * tags in the branch appears under each of them; every appearance is the
 * same task.
 */
export function groupByTag<T>(branch: readonly PlacedTag[], tasks: readonly T[], tagsOf: (task: T) => readonly string[]): TagGroup<T>[] {
  const byTag = new Map<string, T[]>();
  for (const task of tasks) {
    for (const id of new Set(tagsOf(task))) {
      const tagged = byTag.get(id);
      if (tagged) tagged.push(task);
      else byTag.set(id, [task]);
    }
  }
  return branch.flatMap((p) => {
    const tagged = byTag.get(p.tag.id);
    return tagged ? [{ ...p, tasks: tagged }] : [];
  });
}
