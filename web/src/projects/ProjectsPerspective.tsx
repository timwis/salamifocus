import { useQuery } from '@powersync/react';
import { outlineTasks, ProjectStatus, projectsInSelection, pruneOutline, shownUnder, visibilityCondition, Visibility } from '@salamifocus/domain';
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
  const visibility = place.visibility ?? Visibility.remaining;
  const { data: tasks } = useQuery<TaskRow>(
    `SELECT t.id, t.title, t.note, t.project_id, t.parent_id, t.position, ${taskStateColumns}
     FROM tasks t WHERE t.project_id IN (${ids.map(() => '?').join(', ')}) AND ${visibilityCondition(visibility)}`,
    ids,
  );
  const { data: projectDates } = useQuery<{ id: string; defer_until: string | null; due_at: string | null }>(
    `SELECT id, defer_until, due_at FROM projects WHERE id IN (${ids.map(() => '?').join(', ')})`,
    ids,
  );
  const datesById = new Map(projectDates.map((p) => [p.id, p]));
  // Under Available, a task joins the outline when its defer date passes.
  const now = useNow([...tasks.map((t) => t.deferredUntil), ...projectDates.map((p) => p.defer_until)]);
  const shown = (task: TaskRow) => shownUnder(visibility, taskUnavailability(task, now));
  const available = visibility === Visibility.available;
  const groups: OutlineGroup[] = selected.map((project) => {
    const deferUntil = datesById.get(project.id)?.defer_until ?? null;
    const paused = project.status === ProjectStatus.paused;
    // Under Available, a task added to a paused or deferred project would never be shown.
    const canAdd = !available || (!paused && !(deferUntil && Date.parse(deferUntil) > now.getTime()));
    return {
      id: project.id,
      heading: project.name,
      ...(canAdd ? { newTask: { projectId: project.id, tagId: null } } : {}),
      // Available shows only part of the project, so its order and nesting are not the project's own to change.
      ordered: !available,
      project: {
        id: project.id,
        deferUntil,
        dueAt: datesById.get(project.id)?.due_at ?? null,
        paused,
      },
      tasks: pruneOutline(outlineTasks(tasks.filter((t) => t.project_id === project.id).map((t) => ({ ...t, parentId: t.parent_id }))), shown).map(
        ({ task, depth, parentId }) => ({ ...task, projectId: task.project_id, depth, parentId }),
      ),
    };
  });
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
