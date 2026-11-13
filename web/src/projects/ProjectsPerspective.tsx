import { useQuery } from '@powersync/react';
import { buildTree, isProjectKind, projectsInSelection, ProjectKind } from '@salamifocus/domain';
import { useMemo } from 'react';
import { go, type Place } from '../navigation.ts';
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

export function ProjectsPerspective({ place }: { place: Place }) {
  const tree = useOrganisation();
  const selected = projectsInSelection(tree, place.selection);

  return (
    <>
      <Sidebar tree={tree} selection={place.selection} onSelect={(selection) => go({ perspective: 'projects', selection })} />
      <main data-region="outline" aria-labelledby="perspective-heading">
        <h2 id="perspective-heading">Projects</h2>
        <p className="summary">
          {selected.length === 0 ? 'Select a project in the sidebar' : `${selected.length} ${selected.length === 1 ? 'project' : 'projects'} selected`}
        </p>
        {selected.map((project) => (
          <section key={project.id} aria-label={project.name}>
            <h3 className="project-heading">{project.name}</h3>
          </section>
        ))}
      </main>
    </>
  );
}
