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
    children.set(key, [...(children.get(key) ?? []), tag]);
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
