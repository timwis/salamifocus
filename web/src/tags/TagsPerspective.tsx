import { useQuery } from '@powersync/react';
import { groupByTag, tagBranch, tagPathSeparator, type TagNode } from '@salamifocus/domain';
import { go, type Place } from '../navigation.ts';
import { Outline, type OutlineGroup } from '../outline/Outline.tsx';
import { TreeSidebar, type NewItemKind } from '../sidebar/TreeSidebar.tsx';
import { createTag, moveTag, renameTag } from '../writes.ts';
import { useTags, useTaskTags } from './data.tsx';

const newKinds: NewItemKind[] = [{ kind: 'tag', key: 'N', button: 'Tag', name: 'tag' }];

interface TaskRow {
  id: string;
  title: string;
  note: string | null;
  position: string | null;
  project_name: string | null;
}

/**
 * The tag hierarchy in the sidebar, and for the selected tag, the unfinished
 * tasks carrying it or any tag beneath it. A task appears under each matching
 * tag; completing it removes every appearance.
 */
export function TagsPerspective({ place }: { place: Place }) {
  const tags = useTags();
  const taskTags = useTaskTags();
  const selected = place.selection[0] ?? null;
  const branch = selected ? tagBranch(tags.tree, selected) : [];
  const branchIds = branch.map((p) => p.tag.id);
  const { data: tasks } = useQuery<TaskRow>(
    `SELECT t.id, t.title, t.note, t.position, p.name AS project_name
     FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
     WHERE t.completed_at IS NULL AND t.id IN (SELECT task_id FROM task_tags WHERE tag_id IN (${branchIds.map(() => '?').join(', ')}))
     ORDER BY t.created_at, t.id`,
    branchIds,
  );
  const groups: OutlineGroup[] = groupByTag(branch, tasks, (task) => taskTags.get(task.id) ?? []).map(
    ({ tag, path, tasks }) => ({
      id: tag.id,
      heading: path.join(tagPathSeparator),
      // A task added here gets this tag, and waits in the Inbox until it has a project.
      newTask: { projectId: null, tagId: tag.id },
      ordered: false,
      tasks: tasks.map((task) => ({ ...task, projectName: task.project_name })),
    }),
  );
  // With nothing in the branch, the selected tag still gets a heading, so tasks can be added to it.
  const [selectedTag] = branch;
  if (groups.length === 0 && selectedTag) {
    const { tag, path } = selectedTag;
    groups.push({ id: tag.id, heading: path.join(tagPathSeparator), newTask: { projectId: null, tagId: tag.id }, ordered: false, tasks: [] });
  }
  const count = tasks.length;

  return (
    <>
      <TreeSidebar<TagNode>
        label="Tags"
        tree={tags.tree}
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
      <Outline
        title="Tags"
        summary={branch.length === 0 ? 'Select a tag in the sidebar' : `${count} ${count === 1 ? 'task' : 'tasks'} remaining`}
        groups={groups}
        empty="Nothing selected."
      />
    </>
  );
}
