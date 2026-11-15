import { useQuery } from '@powersync/react';
import { buildTagTree, placedTags, type PlacedTag, type TagNode } from '@salamifocus/domain';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

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

interface TagData {
  tags: Tags;
  /** The tag ids on each task that has any. */
  taskTags: Map<string, string[]>;
}

const TagContext = createContext<TagData | null>(null);

/** Watches tags and which tasks carry them once, for every perspective below it. */
export function TagsProvider({ children }: { children: ReactNode }) {
  const { data: tagRows } = useQuery<TagRow>('SELECT id, name, parent_id, position FROM tags');
  const { data: links } = useQuery<{ task_id: string; tag_id: string }>('SELECT task_id, tag_id FROM task_tags');
  const tags = useMemo(() => {
    const tree = buildTagTree(tagRows.map((t) => ({ id: t.id, name: t.name, parentId: t.parent_id, position: t.position })));
    const placed = placedTags(tree);
    return { tree, placed, byId: new Map(placed.map((p) => [p.tag.id, p])) };
  }, [tagRows]);
  const taskTags = useMemo(() => {
    const byTask = new Map<string, string[]>();
    for (const { task_id, tag_id } of links) {
      const ids = byTask.get(task_id);
      if (ids) ids.push(tag_id);
      else byTask.set(task_id, [tag_id]);
    }
    return byTask;
  }, [links]);
  const value = useMemo(() => ({ tags, taskTags }), [tags, taskTags]);
  return <TagContext value={value}>{children}</TagContext>;
}

function useTagData(): TagData {
  const data = useContext(TagContext);
  if (!data) throw new Error('Tags are read inside a TagsProvider.');
  return data;
}

export const useTags = (): Tags => useTagData().tags;
export const useTaskTags = (): Map<string, string[]> => useTagData().taskTags;

/** A task's tags in sidebar order, skipping any not synced yet. */
export function tagsInOrder(tags: Tags, ids: readonly string[]): PlacedTag[] {
  const wanted = new Set(ids);
  return tags.placed.filter((p) => wanted.has(p.tag.id));
}
