import { comparePositions } from './positions.ts';

// Folders hold projects, single-action lists and other folders, nested to any
// depth. Everything refers to its container by id, never by name.

export const ProjectKind = {
  project: 'project',
  singleActions: 'single_actions',
} as const;

export type ProjectKind = (typeof ProjectKind)[keyof typeof ProjectKind];

export function isProjectKind(value: unknown): value is ProjectKind {
  return value === ProjectKind.project || value === ProjectKind.singleActions;
}

/** Whether a project or single-action list is being worked on. A paused one can still be inspected and edited. */
export const ProjectStatus = {
  active: 'active',
  paused: 'paused',
} as const;

export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus];

/** A stored status as one the client knows, treating anything else (such as a project not yet synced back) as active. */
export function projectStatusOf(value: unknown): ProjectStatus {
  return value === ProjectStatus.paused ? ProjectStatus.paused : ProjectStatus.active;
}

export interface FolderRecord {
  id: string;
  name: string;
  parentId: string | null;
  position: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  folderId: string | null;
  position: string;
  kind: ProjectKind;
  status: ProjectStatus;
}

export interface FolderNode {
  type: 'folder';
  id: string;
  name: string;
  position: string;
  children: OrganisationNode[];
}

export interface ProjectNode {
  type: 'project';
  id: string;
  name: string;
  position: string;
  kind: ProjectKind;
  status: ProjectStatus;
}

export type OrganisationNode = FolderNode | ProjectNode;

/** Returns a user-facing reason a folder or project name is unacceptable, or null if it is fine. */
export function nameProblem(name: string): string | null {
  if (name.trim() === '') return 'A name cannot be blank.';
  return null;
}

export function normaliseName(name: string): string {
  return name.trim();
}

/**
 * Nests folders and projects into the sidebar hierarchy, each level in
 * sibling order with folders and projects interleaved. Anything whose folder
 * is missing (or that is caught in a cycle) is shown at the top level rather
 * than hidden.
 */
export function buildTree(folders: readonly FolderRecord[], projects: readonly ProjectRecord[]): OrganisationNode[] {
  const folderIds = new Set(folders.map((f) => f.id));
  const children = new Map<string | null, (FolderRecord | ProjectRecord)[]>();
  const add = (parent: string | null, item: FolderRecord | ProjectRecord) => {
    const key = parent !== null && folderIds.has(parent) ? parent : null;
    const siblings = children.get(key);
    if (siblings) siblings.push(item);
    else children.set(key, [item]);
  };
  for (const folder of folders) add(folder.parentId, folder);
  for (const project of projects) add(project.folderId, project);

  const visited = new Set<string>();
  const nodesUnder = (parent: string | null): OrganisationNode[] =>
    (children.get(parent) ?? [])
      .filter((item) => !visited.has(item.id))
      .sort(comparePositions)
      .map((item) => {
        visited.add(item.id);
        if ('kind' in item) return { type: 'project', id: item.id, name: item.name, position: item.position, kind: item.kind, status: item.status };
        return { type: 'folder', id: item.id, name: item.name, position: item.position, children: nodesUnder(item.id) };
      });

  const roots = nodesUnder(null);
  const stranded = folders.filter((f) => !visited.has(f.id));
  for (const folder of stranded) {
    if (visited.has(folder.id)) continue;
    visited.add(folder.id);
    roots.push({ type: 'folder', id: folder.id, name: folder.name, position: folder.position, children: nodesUnder(folder.id) });
  }
  return roots;
}

/**
 * The projects a sidebar selection covers, in sidebar order and without
 * repeats. Selecting a folder covers every project nested inside it.
 */
export function projectsInSelection(tree: readonly OrganisationNode[], selected: Iterable<string>): ProjectNode[] {
  const ids = new Set(selected);
  const found: ProjectNode[] = [];
  const walk = (nodes: readonly OrganisationNode[], inSelectedFolder: boolean) => {
    for (const node of nodes) {
      const covered = inSelectedFolder || ids.has(node.id);
      if (node.type === 'project') {
        if (covered) found.push(node);
      } else {
        walk(node.children, covered);
      }
    }
  };
  walk(tree, false);
  return found;
}

/**
 * Whether putting `id` beneath `parentId` would make it contain itself, in any of the
 * hierarchies (folders, tags, tasks). A loop already in `parentOf` counts as one too.
 */
export function wouldNestInItself(
  id: string,
  parentId: string | null,
  parentOf: (id: string) => string | null | undefined,
): boolean {
  const seen = new Set<string>();
  for (let current: string | null | undefined = parentId; current !== null && current !== undefined; current = parentOf(current)) {
    if (current === id) return true;
    if (seen.has(current)) return true;
    seen.add(current);
  }
  return false;
}

export interface PlacedProject {
  project: ProjectNode;
  /** Names of the folders it is in, from the top level down, then its own. */
  path: string[];
}

/** Every project and single-action list in sidebar order, with its full path. */
export function placedProjects(tree: readonly OrganisationNode[]): PlacedProject[] {
  const walk = (nodes: readonly OrganisationNode[], above: string[]): PlacedProject[] =>
    nodes.flatMap((node) =>
      node.type === 'project' ? [{ project: node, path: [...above, node.name] }] : walk(node.children, [...above, node.name]),
    );
  return walk(tree, []);
}

export interface PlacedFolder {
  folder: FolderNode;
  /** Names from the top-level folder down to this one. */
  path: string[];
}

/** Every folder in sidebar order (each before the folders inside it), with its full path. */
export function placedFolders(tree: readonly OrganisationNode[]): PlacedFolder[] {
  const walk = (nodes: readonly OrganisationNode[], above: string[]): PlacedFolder[] =>
    nodes.flatMap((node) => {
      if (node.type !== 'folder') return [];
      const path = [...above, node.name];
      return [{ folder: node, path }, ...walk(node.children, path)];
    });
  return walk(tree, []);
}
