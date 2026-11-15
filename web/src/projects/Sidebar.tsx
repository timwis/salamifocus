import { ProjectKind, type OrganisationNode } from '@salamifocus/domain';
import { TreeSidebar, type NewItemKind } from '../sidebar/TreeSidebar.tsx';
import { createFolder, createProject, moveFolder, moveProject, renameFolder, renameProject } from '../writes.ts';

const newKinds: NewItemKind[] = [
  { kind: ProjectKind.project, key: 'N', button: 'Project', name: 'project' },
  { kind: ProjectKind.singleActions, key: 'S', button: 'List', name: 'single-action list' },
  { kind: 'folder', key: 'F', button: 'Folder', name: 'folder' },
];

const isFolder = (node: OrganisationNode) => node.type === 'folder';

/** Folders, projects and single-action lists. Selecting a folder selects every project inside it. */
export function Sidebar({ tree, selection, onSelect }: { tree: OrganisationNode[]; selection: string[]; onSelect: (ids: string[]) => void }) {
  return (
    <TreeSidebar<OrganisationNode>
      label="Folders and projects"
      tree={tree}
      selection={selection}
      multiple
      onSelect={onSelect}
      kindOf={(node) => (node.type === 'folder' ? 'folder' : node.kind)}
      canContain={isFolder}
      createsInside={isFolder}
      newKinds={newKinds}
      hint="Press N for a new project, F for a folder, S for a single-action list."
      collapsedStorageKey="salamifocus.sidebar.collapsed"
      create={(kind, id, name, parentId, position) =>
        kind === 'folder' ? createFolder(id, name, parentId, position) : createProject(id, name, kind as ProjectKind, parentId, position)
      }
      rename={(node, name) => (node.type === 'folder' ? renameFolder(node.id, name) : renameProject(node.id, name))}
      move={(node, parentId, position) => (node.type === 'folder' ? moveFolder(node.id, parentId, position) : moveProject(node.id, parentId, position))}
    />
  );
}
