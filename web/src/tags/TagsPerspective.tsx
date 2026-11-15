import { useQuery } from '@powersync/react';
import { buildTagTree, type TagNode } from '@salamifocus/domain';
import { useMemo } from 'react';
import { go, type Place } from '../navigation.ts';
import { Outline } from '../outline/Outline.tsx';
import { TreeSidebar, type NewItemKind } from '../sidebar/TreeSidebar.tsx';
import { createTag, moveTag, renameTag } from '../writes.ts';

interface TagRow {
  id: string;
  name: string;
  parent_id: string | null;
  position: string;
}

export function useTagTree(): TagNode[] {
  const { data } = useQuery<TagRow>('SELECT id, name, parent_id, position FROM tags');
  return useMemo(() => buildTagTree(data.map((t) => ({ id: t.id, name: t.name, parentId: t.parent_id, position: t.position }))), [data]);
}

const newKinds: NewItemKind[] = [{ kind: 'tag', key: 'N', button: 'Tag', name: 'tag' }];

export function TagsPerspective({ place }: { place: Place }) {
  const tree = useTagTree();

  return (
    <>
      <TreeSidebar<TagNode>
        label="Tags"
        tree={tree}
        selection={place.selection.slice(0, 1)}
        multiple={false}
        onSelect={(selection) => go({ perspective: 'tags', selection })}
        kindOf={() => 'tag'}
        canContain={() => true}
        createsInside={() => false}
        newKinds={newKinds}
        hint="Press N for a new tag."
        collapsedStorageKey="salamifocus.tags.collapsed"
        create={(_kind, id, name, parentId, position) => createTag(id, name, parentId, position)}
        rename={(node, name) => renameTag(node.id, name)}
        move={(node, parentId, position) => moveTag(node.id, parentId, position)}
      />
      <Outline title="Tags" summary="Select a tag in the sidebar" groups={[]} empty="Nothing selected." />
    </>
  );
}
