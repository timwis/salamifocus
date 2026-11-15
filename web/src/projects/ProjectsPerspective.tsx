import { useQuery } from '@powersync/react';
import { comparePositions, projectsInSelection } from '@salamifocus/domain';
import { go, type Place } from '../navigation.ts';
import { Outline, type OutlineGroup } from '../outline/Outline.tsx';
import { useOrganisation } from './data.tsx';
import { Sidebar } from './Sidebar.tsx';

interface TaskRow {
  id: string;
  title: string;
  note: string | null;
  project_id: string;
  position: string | null;
}

export function ProjectsPerspective({ place }: { place: Place }) {
  const tree = useOrganisation();
  const selected = projectsInSelection(tree, place.selection);
  const ids = selected.map((p) => p.id);
  const { data: tasks } = useQuery<TaskRow>(
    `SELECT id, title, note, project_id, position FROM tasks WHERE project_id IN (${ids.map(() => '?').join(', ')}) AND completed_at IS NULL`,
    ids,
  );
  const groups: OutlineGroup[] = selected.map((project) => ({
    id: project.id,
    heading: project.name,
    newTask: { projectId: project.id, tagId: null },
    ordered: true,
    tasks: tasks
      .filter((t) => t.project_id === project.id)
      .sort(comparePositions)
      .map((t) => ({ ...t, projectId: t.project_id })),
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
      />
    </>
  );
}
