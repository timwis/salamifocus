import { useQuery } from '@powersync/react';
import {
  buildTree,
  isProjectKind,
  placedFolders,
  placedProjects,
  ProjectKind,
  projectStatusOf,
  type OrganisationNode,
  type PlacedFolder,
  type PlacedProject,
} from '@salamifocus/domain';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

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
  status: string | null;
  folder_id: string | null;
  position: string;
}

interface Organisation {
  /** Folders, projects and single-action lists, nested as the Projects sidebar shows them. */
  tree: OrganisationNode[];
  projects: Projects;
  /** Every folder in sidebar order, with its full path. */
  folders: PlacedFolder[];
}

const OrganisationContext = createContext<Organisation | null>(null);

/**
 * Watches folders and projects once, for every perspective below it, so a
 * task editor's project type-ahead is ready as soon as it opens.
 */
export function OrganisationProvider({ children }: { children: ReactNode }) {
  const { data: folders } = useQuery<FolderRow>('SELECT id, name, parent_id, position FROM folders');
  const { data: projects } = useQuery<ProjectRow>('SELECT id, name, kind, status, folder_id, position FROM projects');
  const value = useMemo(() => {
    const tree = buildTree(
      folders.map((f) => ({ id: f.id, name: f.name, parentId: f.parent_id, position: f.position })),
      projects.map((p) => ({
        id: p.id,
        name: p.name,
        kind: isProjectKind(p.kind) ? p.kind : ProjectKind.project,
        status: projectStatusOf(p.status),
        folderId: p.folder_id,
        position: p.position,
      })),
    );
    const placed = placedProjects(tree);
    return { tree, projects: { placed, byId: new Map(placed.map((p) => [p.project.id, p])) }, folders: placedFolders(tree) };
  }, [folders, projects]);
  return <OrganisationContext value={value}>{children}</OrganisationContext>;
}

function useOrganisationData(): Organisation {
  const data = useContext(OrganisationContext);
  if (!data) throw new Error('Folders and projects are read inside an OrganisationProvider.');
  return data;
}

export const useOrganisation = (): OrganisationNode[] => useOrganisationData().tree;
export const useProjects = (): Projects => useOrganisationData().projects;
export const useFolders = (): PlacedFolder[] => useOrganisationData().folders;

export interface Projects {
  /** Every project and single-action list in sidebar order, with its full path. */
  placed: PlacedProject[];
  byId: Map<string, PlacedProject>;
}
