import { useQuery } from '@powersync/react';
import { outlineTasks, projectsInSelection, pruneOutline, shownUnder, Visibility } from '@salamifocus/domain';
import { useNow } from '../clock.ts';
import { go, type Place } from '../navigation.ts';
import { Outline, type OutlineGroup } from '../outline/Outline.tsx';
import { taskStateColumns, taskUnavailability, type TaskState } from '../queries.ts';
import { useOrganisation } from './data.tsx';
import { Sidebar } from './Sidebar.tsx';

interface TaskRow extends TaskState {
  id: string;
  title: string;
  note: string | null;
  project_id: string;
  parent_id: string | null;
  position: string | null;
}

export function ProjectsPerspective({ place }: { place: Place }) {
  const tree = useOrganisation();
  const selected = projectsInSelection(tree, place.selection);
  const ids = selected.map((p) => p.id);
  const { data: tasks } = useQuery<TaskRow>(
    `SELECT t.id, t.title, t.note, t.project_id, t.parent_id, t.position, ${taskStateColumns}
     FROM tasks t WHERE t.project_id IN (${ids.map(() => '?').join(', ')}) AND t.completed_at IS NULL`,
    ids,
  );
  const { data: projectDates } = useQuery<{ id: string; defer_until: string | null; due_at: string | null }>(
    `SELECT id, defer_until, due_at FROM projects WHERE id IN (${ids.map(() => '?').join(', ')})`,
    ids,
  );
  const datesById = new Map(projectDates.map((p) => [p.id, p]));
  const visibility = place.visibility ?? Visibility.remaining;
  // Under Available, a task joins the outline when its defer date passes.
  const now = useNow(tasks.map((t) => t.deferredUntil));
  const shown = (task: TaskRow) => shownUnder(visibility, taskUnavailability(task, now));
  const groups: OutlineGroup[] = selected.map((project) => ({
    id: project.id,
    heading: project.name,
    newTask: { projectId: project.id, tagId: null },
    ordered: true,
    project: { id: project.id, deferUntil: datesById.get(project.id)?.defer_until ?? null, dueAt: datesById.get(project.id)?.due_at ?? null },
    tasks: pruneOutline(outlineTasks(tasks.filter((t) => t.project_id === project.id).map((t) => ({ ...t, parentId: t.parent_id }))), shown).map(
      ({ task, depth, parentId }) => ({ ...task, projectId: task.project_id, depth, parentId }),
    ),
  }));
  const taskCount = groups.reduce((sum, g) => sum + g.tasks.length, 0);

  return (
    <>
      <Sidebar tree={tree} selection={place.selection} onSelect={(selection) => go({ perspective: 'projects', selection })} />
      <Outline
        title="Projects"
        summary={
          selected.length === 0
            ? 'Select a project in the sidebar'
            : `${taskCount} ${taskCount === 1 ? 'task' : 'tasks'}, ${selected.length} ${selected.length === 1 ? 'project' : 'projects'} selected`
        }
        groups={groups}
        empty="Nothing selected."
        visibility={{ value: visibility, choose: (visibility) => go({ ...place, visibility }) }}
      />
    </>
  );
}
