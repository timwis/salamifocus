import { useQuery } from '@powersync/react';
import { flaggedCondition, shownUnder, visibilityCondition, Visibility } from '@salamifocus/domain';
import { useState } from 'react';
import { useNow } from '../clock.ts';
import { go, type Place } from '../navigation.ts';
import { Outline } from '../outline/Outline.tsx';
import { taskStateColumns, taskUnavailability, type TaskState } from '../queries.ts';

interface TaskRow extends TaskState {
  id: string;
  title: string;
  note: string | null;
  position: string | null;
  project_id: string | null;
  project_name: string | null;
}

/** The tasks the user has flagged that the visibility shows, oldest first, each with its project, tags and dates. */
export function FlaggedPerspective({ place }: { place: Place }) {
  const visibility = place.visibility ?? Visibility.available;
  const { data: tasks } = useQuery<TaskRow>(
    `SELECT t.id, t.title, t.note, t.position, t.project_id, p.name AS project_name, ${taskStateColumns}
     FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
     WHERE ${flaggedCondition} AND ${visibilityCondition(visibility)}
     ORDER BY t.created_at, t.id`,
  );
  // Under Available, a deferred flagged task comes back when its defer date passes.
  const now = useNow(tasks.map((t) => t.deferredUntil));
  // A task being edited stays until editing stops, even when an edit (a defer date, say) means the visibility hides it.
  const [editedTaskId, setEditedTaskId] = useState<string | null>(null);
  const shown = tasks
    .filter((task) => task.id === editedTaskId || shownUnder(visibility, taskUnavailability(task, now)))
    .map((task) => ({ ...task, projectId: task.project_id, projectName: task.project_name }));
  const count = shown.length;

  return (
    <Outline
      title="Flagged"
      summary={`${count} ${count === 1 ? 'task' : 'tasks'}${visibility === Visibility.everything ? '' : ` ${visibility}`}`}
      groups={[{ id: 'flagged', heading: null, ordered: false, tasks: shown }]}
      empty={visibility === Visibility.available ? 'No flagged task is available. Press V to show remaining tasks.' : visibility === Visibility.remaining ? 'No flagged task is left to do. Press V to show completed ones too.' : 'Nothing is flagged.'}
      visibility={{ value: visibility, choose: (visibility) => go({ ...place, visibility }) }}
      onEditing={setEditedTaskId}
    />
  );
}
