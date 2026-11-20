import { useQuery } from '@powersync/react';
import { actionableGroups, projectsInSelection, shownUnder, tagPathSeparator, untaggedId, Visibility, type FolderScope } from '@salamifocus/domain';
import { useState } from 'react';
import { useNow } from '../clock.ts';
import { Outline, type OutlineGroup } from '../outline/Outline.tsx';
import { useFolders, useOrganisation } from '../projects/data.tsx';
import { taskStateColumns, taskUnavailability, type TaskState } from '../queries.ts';
import { scopeNames, useDesignatedFolders } from '../settings/Settings.tsx';
import { useTags, useTaskTags } from '../tags/data.tsx';

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
 * tag. Groups update as tasks are completed, deferred or become available.
 */
export function ActionablePerspective({ scope }: { scope: FolderScope }) {
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
     WHERE t.completed_at IS NULL AND t.project_id IN (${projectIds.map(() => '?').join(', ')})
     ORDER BY t.created_at, t.id`,
    projectIds,
  );
  // A task joins when its defer date passes.
  const now = useNow(tasks.map((t) => t.deferredUntil));
  // A task being edited stays until editing stops, even when an edit (a defer date, say) means it is no longer available.
  const [editedTaskId, setEditedTaskId] = useState<string | null>(null);
  const shown = tasks.filter((task) => task.id === editedTaskId || shownUnder(Visibility.available, taskUnavailability(task, now)));
  const groups: OutlineGroup[] = actionableGroups(tags.placed, shown, (task) => taskTags.get(task.id) ?? []).map(({ tag, tasks }) => ({
    id: tag?.tag.id ?? untaggedId,
    heading: tag ? tag.path.join(tagPathSeparator) : 'Untagged',
    ordered: false,
    tasks: tasks.map((task) => ({ ...task, projectId: task.project_id, projectName: task.project_name })),
  }));
  const name = scopeNames[scope];
  const count = new Set(shown.map((t) => t.id)).size;

  return (
    <Outline
      title={name}
      summary={folder ? `${count} available ${count === 1 ? 'task' : 'tasks'} in ${folder.path.join(tagPathSeparator)}` : undefined}
      groups={groups}
      empty={
        designated === null
          ? 'Loading…'
          : folderId === null
            ? `No ${name} folder chosen. Press , to choose one in Settings.`
            : 'Nothing available.'
      }
      onEditing={setEditedTaskId}
    />
  );
}
