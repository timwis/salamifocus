import type { TagNode } from '@salamifocus/domain';
import { go, type Place } from '../navigation.ts';
import { Outline } from '../outline/Outline.tsx';
import { TreeSidebar, type NewItemKind } from '../sidebar/TreeSidebar.tsx';
import { createTag, moveTag, renameTag } from '../writes.ts';
import { useTags } from './data.ts';

const newKinds: NewItemKind[] = [{ kind: 'tag', key: 'N', button: 'Tag', name: 'tag' }];

export function TagsPerspective({ place }: { place: Place }) {
  const { tree } = useTags();

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
