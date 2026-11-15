import { useQuery } from '@powersync/react';
import { buildTree, comparePositions, isProjectKind, projectsInSelection, ProjectKind } from '@salamifocus/domain';
import { useMemo } from 'react';
import { go, type Place } from '../navigation.ts';
import { Outline, type OutlineGroup } from '../outline/Outline.tsx';
import { Sidebar } from './Sidebar.tsx';

interface FolderRow {
  id: string;
  name: string;
  parent_id: string | null;
  position: string;
}

interface ProjectRow {
  id: string;
  name: string;
  kind: string;
  folder_id: string | null;
  position: string;
}

export function useOrganisation() {
  const { data: folders } = useQuery<FolderRow>('SELECT id, name, parent_id, position FROM folders');
  const { data: projects } = useQuery<ProjectRow>('SELECT id, name, kind, folder_id, position FROM projects');
  return useMemo(
    () =>
      buildTree(
        folders.map((f) => ({ id: f.id, name: f.name, parentId: f.parent_id, position: f.position })),
        projects.map((p) => ({
          id: p.id,
          name: p.name,
          kind: isProjectKind(p.kind) ? p.kind : ProjectKind.project,
          folderId: p.folder_id,
          position: p.position,
        })),
      ),
    [folders, projects],
  );
}

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
    tasks: tasks.filter((t) => t.project_id === project.id).sort(comparePositions),
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
