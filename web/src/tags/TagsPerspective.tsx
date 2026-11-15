import { useQuery } from '@powersync/react';
import { groupByTag, shownUnder, tagBranch, tagPathSeparator, Visibility, type TagNode } from '@salamifocus/domain';
import { useNow } from '../clock.ts';
import { go, type Place } from '../navigation.ts';
import { Outline, type OutlineGroup } from '../outline/Outline.tsx';
import { taskStateColumns, taskUnavailability, unfinishedUnless, type TaskState } from '../queries.ts';
import { TreeSidebar, type NewItemKind } from '../sidebar/TreeSidebar.tsx';
import { createTag, moveTag, renameTag } from '../writes.ts';
import { useTags, useTaskTags } from './data.tsx';

const newKinds: NewItemKind[] = [{ kind: 'tag', key: 'N', button: 'Tag', name: 'tag' }];

interface TaskRow extends TaskState {
  id: string;
  title: string;
  note: string | null;
  position: string | null;
  project_id: string | null;
  project_name: string | null;
}

/**
 * The tag hierarchy in the sidebar, and for the selected tag, the tasks the
 * visibility shows that carry it or any tag beneath it. A task appears under
 * each matching tag, and completing it changes every appearance.
 */
export function TagsPerspective({ place }: { place: Place }) {
  const tags = useTags();
  const taskTags = useTaskTags();
  const selected = place.selection[0] ?? null;
  const branch = selected ? tagBranch(tags.tree, selected) : [];
  const branchIds = branch.map((p) => p.tag.id);
  const visibility = place.visibility ?? Visibility.remaining;
  const { data: tasks } = useQuery<TaskRow>(
    `SELECT t.id, t.title, t.note, t.position, t.project_id, p.name AS project_name, ${taskStateColumns}
     FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
     WHERE ${unfinishedUnless(visibility)} AND t.id IN (SELECT task_id FROM task_tags WHERE tag_id IN (${branchIds.map(() => '?').join(', ')}))
     ORDER BY t.created_at, t.id`,
    branchIds,
  );
  // Under Available, a task joins the outline when its defer date passes.
  const now = useNow(tasks.map((t) => t.deferredUntil));
  const shown = tasks.filter((task) => shownUnder(visibility, taskUnavailability(task, now)));
  const groups: OutlineGroup[] = groupByTag(branch, shown, (task) => taskTags.get(task.id) ?? []).map(
    ({ tag, path, tasks }) => ({
      id: tag.id,
      heading: path.join(tagPathSeparator),
      // A task added here gets this tag, and waits in the Inbox until it has a project.
      newTask: { projectId: null, tagId: tag.id },
      ordered: false,
      tasks: tasks.map((task) => ({ ...task, projectId: task.project_id, projectName: task.project_name })),
    }),
  );
  // With nothing in the branch, the selected tag still gets a heading, so tasks can be added to it.
  const [selectedTag] = branch;
  if (groups.length === 0 && selectedTag) {
    const { tag, path } = selectedTag;
    groups.push({ id: tag.id, heading: path.join(tagPathSeparator), newTask: { projectId: null, tagId: tag.id }, ordered: false, tasks: [] });
  }
  const count = shown.length;

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
        summary={branch.length === 0 ? 'Select a tag in the sidebar' : `${count} ${count === 1 ? 'task' : 'tasks'}${visibility === Visibility.everything ? '' : ` ${visibility}`}`}
        groups={groups}
        empty="Nothing selected."
        visibility={{ value: visibility, choose: (visibility) => go({ ...place, visibility }) }}
      />
    </>
  );
}
