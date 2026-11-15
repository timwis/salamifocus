import { useQuery } from '@powersync/react';
import { buildTagTree, placedTags, type PlacedTag, type TagNode } from '@salamifocus/domain';
import { useMemo } from 'react';

interface TagRow {
  id: string;
  name: string;
  parent_id: string | null;
  position: string;
}

export interface Tags {
  tree: TagNode[];
  /** Every tag in sidebar order, with its full path. */
  placed: PlacedTag[];
  byId: Map<string, PlacedTag>;
}

export function useTags(): Tags {
  const { data } = useQuery<TagRow>('SELECT id, name, parent_id, position FROM tags');
  return useMemo(() => {
    const tree = buildTagTree(data.map((t) => ({ id: t.id, name: t.name, parentId: t.parent_id, position: t.position })));
    const placed = placedTags(tree);
    return { tree, placed, byId: new Map(placed.map((p) => [p.tag.id, p])) };
  }, [data]);
}

/** The tag ids on each task that has any. */
export function useTaskTags(): Map<string, string[]> {
  const { data } = useQuery<{ task_id: string; tag_id: string }>('SELECT task_id, tag_id FROM task_tags');
  return useMemo(() => {
    const byTask = new Map<string, string[]>();
    for (const { task_id, tag_id } of data) byTask.set(task_id, [...(byTask.get(task_id) ?? []), tag_id]);
    return byTask;
  }, [data]);
}

/** A task's tags in sidebar order, skipping any not synced yet. */
export function tagsInOrder(tags: Tags, ids: readonly string[]): PlacedTag[] {
  const wanted = new Set(ids);
  return tags.placed.filter((p) => wanted.has(p.tag.id));
}
