import { useQuery } from '@powersync/react';
import {
  actionableView,
  projectsInSelection,
  shownUnder,
  tagPathSeparator,
  untaggedId,
  visibilityCondition,
  Visibility,
  type FolderScope,
  type TagNode,
} from '@salamifocus/domain';
import { useState } from 'react';
import { useNow } from '../clock.ts';
import { go, type Place } from '../navigation.ts';
import { Outline, type OutlineGroup } from '../outline/Outline.tsx';
import { useFolders, useOrganisation } from '../projects/data.tsx';
import { taskStateColumns, taskUnavailability, type TaskState } from '../queries.ts';
import { scopeNames, useDesignatedFolders } from '../settings/Settings.tsx';
import { TreeSidebar } from '../sidebar/TreeSidebar.tsx';
import { useTags, useTaskTags } from '../tags/data.tsx';

/** The sidebar's last entry, for the tasks with no tag. */
interface UntaggedNode {
  id: typeof untaggedId;
  name: string;
  position: string;
}

type SidebarNode = TagNode | UntaggedNode;

const untaggedNode: UntaggedNode = { id: untaggedId, name: 'Untagged', position: '' };

interface TaskRow extends TaskState {
  id: string;
  title: string;
  note: string | null;
  position: string | null;
  project_id: string;
  project_name: string;
}

/**
 * Actionable — Personal or Actionable — Work: the tasks that can be worked on
 * now in the folder designated for that part of life (and everything inside
 * it), as individual actions grouped by tag, oldest first, then those with no
 * tag. The sidebar holds only the tags with such tasks (and their ancestors);
 * selecting one shows its branch. Groups and sidebar update as tasks are
 * completed, deferred or become available.
 */
export function ActionablePerspective({ scope, place }: { scope: FolderScope; place: Place }) {
  const selected = place.selection[0] ?? null;
  const designated = useDesignatedFolders();
  const folderId = designated?.[scope] ?? null;
  const folder = useFolders().find((f) => f.folder.id === folderId) ?? null;
  const organisation = useOrganisation();
  const projectIds = folderId ? projectsInSelection(organisation, [folderId]).map((p) => p.id) : [];
  const tags = useTags();
  const taskTags = useTaskTags();
  const { data: tasks } = useQuery<TaskRow>(
    `SELECT t.id, t.title, t.note, t.position, t.project_id, p.name AS project_name, ${taskStateColumns}
     FROM tasks t JOIN projects p ON p.id = t.project_id
     WHERE ${visibilityCondition(Visibility.available)} AND t.project_id IN (${projectIds.map(() => '?').join(', ')})
     ORDER BY t.created_at, t.id`,
    projectIds,
  );
  // A task joins when its defer date passes.
  const now = useNow(tasks.map((t) => t.deferredUntil));
  // A task being edited stays until editing stops, even when an edit (a defer date, say) means it is no longer available.
  const [editedTaskId, setEditedTaskId] = useState<string | null>(null);
  const shown = tasks.filter((task) => task.id === editedTaskId || shownUnder(Visibility.available, taskUnavailability(task, now)));
  const view = actionableView(tags.tree, selected, shown, (task) => taskTags.get(task.id) ?? []);
  const sidebar = view.sidebar;
  const groups: OutlineGroup[] = view.groups.map(({ tag, tasks }) => ({
    id: tag?.tag.id ?? untaggedId,
    heading: tag ? tag.path.join(tagPathSeparator) : 'Untagged',
    ordered: false,
    tasks: tasks.map((task) => ({ ...task, projectId: task.project_id, projectName: task.project_name })),
  }));
  const name = scopeNames[scope];
  const count = new Set(groups.flatMap((g) => g.tasks.map((t) => t.id))).size;
  const selectedName = selected === untaggedId ? untaggedNode.name : selected ? tags.byId.get(selected)?.tag.name : undefined;

  return (
    <>
      <TreeSidebar<SidebarNode>
        label="Tags with available tasks"
        tree={sidebar.untagged ? [...sidebar.tags, untaggedNode] : sidebar.tags}
        selection={place.selection.slice(0, 1)}
        multiple={false}
        onSelect={(selection) => go({ perspective: place.perspective, selection })}
        kindOf={(node) => (node.id === untaggedId ? 'untagged' : 'tag')}
        canContain={() => false}
        createsInside={() => false}
        newKinds={[]}
        hint={designated === null ? 'Loading…' : folderId === null ? `No ${name} folder chosen.` : 'No tags have available tasks.'}
        collapsedStorageKey={`salamifocus.${scope}.collapsed`}
      />
      <Outline
        title={name}
        summary={
          folder
            ? `${count} available ${count === 1 ? 'task' : 'tasks'} in ${folder.path.join(tagPathSeparator)}${selectedName ? `, under ${selectedName}` : ''}`
            : undefined
        }
        groups={groups}
        empty={
          designated === null
            ? 'Loading…'
            : folderId === null
              ? `No ${name} folder chosen. Press , to choose one in Settings.`
              : selected
                ? 'Nothing available here. Press Space in the sidebar to show every tag.'
                : 'Nothing available.'
        }
        onEditing={setEditedTaskId}
      />
    </>
  );
}
