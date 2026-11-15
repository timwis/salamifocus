import { useQuery } from '@powersync/react';
import { outlineTasks, projectsInSelection } from '@salamifocus/domain';
import { go, type Place } from '../navigation.ts';
import { Outline, unfinishedChildrenColumn, type OutlineGroup } from '../outline/Outline.tsx';
import { useOrganisation } from './data.tsx';
import { Sidebar } from './Sidebar.tsx';

interface TaskRow {
  id: string;
  title: string;
  note: string | null;
  project_id: string;
  parent_id: string | null;
  position: string | null;
  unfinishedChildren: number;
}

export function ProjectsPerspective({ place }: { place: Place }) {
  const tree = useOrganisation();
  const selected = projectsInSelection(tree, place.selection);
  const ids = selected.map((p) => p.id);
  const { data: tasks } = useQuery<TaskRow>(
    `SELECT t.id, t.title, t.note, t.project_id, t.parent_id, t.position, ${unfinishedChildrenColumn}
     FROM tasks t WHERE t.project_id IN (${ids.map(() => '?').join(', ')}) AND t.completed_at IS NULL`,
    ids,
  );
  const groups: OutlineGroup[] = selected.map((project) => ({
    id: project.id,
    heading: project.name,
    newTask: { projectId: project.id, tagId: null },
    ordered: true,
    tasks: outlineTasks(tasks.filter((t) => t.project_id === project.id).map((t) => ({ ...t, parentId: t.parent_id }))).map(
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
      />
    </>
  );
}
