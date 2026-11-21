import { useQuery } from '@powersync/react';
import { agendasView, peopleIn, placedTags, shownUnder, tagPathSeparator, visibilityCondition, Visibility } from '@salamifocus/domain';
import { useState } from 'react';
import { useNow } from '../clock.ts';
import { go, type Place } from '../navigation.ts';
import { Outline, type OutlineGroup } from '../outline/Outline.tsx';
import { taskStateColumns, taskUnavailability, type TaskState } from '../queries.ts';
import { useSettings } from '../settings/Settings.tsx';
import { useTags, useTaskTags } from '../tags/data.tsx';

interface TaskRow extends TaskState {
  id: string;
  title: string;
  note: string | null;
  position: string | null;
  project_id: string | null;
  project_name: string | null;
}

const empty: Record<Visibility, string> = {
  [Visibility.available]: 'Nothing on an agenda is available. Press V to show remaining tasks.',
  [Visibility.remaining]: 'Nothing on an agenda is left to do. Press V to show completed tasks too.',
  [Visibility.everything]: 'Nothing is on an agenda. Tag a task with a person to add it to theirs.',
};

/**
 * Everything involving each person: the tasks the visibility shows that carry
 * a tag beneath the People tag (chosen in Settings), grouped by person, oldest
 * first. A task with two people appears under each, and its other tags stay
 * on the row.
 */
export function AgendasPerspective({ place }: { place: Place }) {
  const visibility = place.visibility ?? Visibility.remaining;
  const settings = useSettings();
  const peopleTagId = settings?.peopleTagId ?? null;
  const tags = useTags();
  const taskTags = useTaskTags();
  const people = peopleIn(tags.tree, peopleTagId);
  const personIds = placedTags(people).map((p) => p.tag.id);
  const { data: tasks } = useQuery<TaskRow>(
    `SELECT t.id, t.title, t.note, t.position, t.project_id, p.name AS project_name, ${taskStateColumns}
     FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
     WHERE ${visibilityCondition(visibility)} AND t.id IN (SELECT task_id FROM task_tags WHERE tag_id IN (${personIds.map(() => '?').join(', ')}))
     ORDER BY t.created_at, t.id`,
    personIds,
  );
  // Under Available, a task joins when its defer date passes.
  const now = useNow(tasks.map((t) => t.deferredUntil));
  // A task being edited stays until editing stops, even when an edit (a defer date, say) means the visibility hides it.
  const [editedTaskId, setEditedTaskId] = useState<string | null>(null);
  const shown = tasks.filter((task) => task.id === editedTaskId || shownUnder(visibility, taskUnavailability(task, now)));
  const groups: OutlineGroup[] = agendasView(people, shown, (task) => taskTags.get(task.id) ?? []).map(({ tag, path, tasks }) => ({
    id: tag.id,
    heading: path.join(tagPathSeparator),
    ordered: false,
    tasks: tasks.map((task) => ({ ...task, projectId: task.project_id, projectName: task.project_name })),
  }));
  const count = new Set(groups.flatMap((g) => g.tasks.map((t) => t.id))).size;
  const peopleTag = peopleTagId ? tags.byId.get(peopleTagId) : undefined;

  return (
    <Outline
      title="Agendas"
      summary={peopleTag ? `${count} ${count === 1 ? 'task' : 'tasks'}${visibility === Visibility.everything ? '' : ` ${visibility}`}` : undefined}
      groups={groups}
      empty={
        peopleTagId === null
          ? settings === null
            ? 'Loading…'
            : 'No People tag chosen. Press , to choose one in Settings.'
          : !peopleTag
            ? 'Loading…'
            : people.length === 0
              ? `${peopleTag.tag.name} has no tags beneath it. Add one for each person in Tags.`
              : empty[visibility]
      }
      visibility={{ value: visibility, choose: (visibility) => go({ ...place, visibility }) }}
      onEditing={setEditedTaskId}
    />
  );
}
