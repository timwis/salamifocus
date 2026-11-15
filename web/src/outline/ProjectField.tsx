import { nameProblem, normaliseName, tagPathSeparator, type PlacedFolder, type PlacedProject } from '@salamifocus/domain';
import { useState, type KeyboardEvent, type Ref } from 'react';
import type { Projects } from '../projects/data.tsx';
import { bestMatches, useTypeAhead } from './typeAhead.tsx';

/** A project to create when the task is saved. */
export interface NewProject {
  id: string;
  name: string;
  folderId: string | null;
  /** Where it will go, for showing. */
  folderPath: string[];
}

type ProjectOption = { kind: 'existing'; placed: PlacedProject } | { kind: 'new'; name: string };
type FolderOption = { kind: 'folder'; placed: PlacedFolder } | { kind: 'top' };

const optionKey = (option: ProjectOption) => (option.kind === 'existing' ? option.placed.project.id : 'new');
const folderKey = (option: FolderOption) => (option.kind === 'folder' ? option.placed.folder.id : 'top');
const pathText = (path: readonly string[]) => path.join(tagPathSeparator);

/**
 * The task editor's project: the project or single-action list the task is
 * in, and a type-ahead to choose another. A name that is not taken can
 * become a new project: the field then asks for its folder, and the project
 * is created when the task is saved. Backspace in the empty field takes the
 * task out of its project. Keys the field does not use (Tab, Escape, Enter
 * when there is nothing typed) go to the editor through `onKeyDown`.
 */
export function ProjectField({
  projects,
  folders,
  value,
  newProject,
  onChange,
  onKeyDown,
  inputRef,
}: {
  projects: Projects;
  folders: readonly PlacedFolder[];
  value: string | null;
  /** The project to create, when `value` is one that does not exist yet. */
  newProject: NewProject | null;
  onChange: (id: string | null, newProject?: NewProject) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  inputRef: Ref<HTMLInputElement>;
}) {
  const [query, setQuery] = useState('');
  // While set, the field is asking which folder a new project with this name goes in.
  const [naming, setNaming] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // The current project stays listed, so typing its name finds it rather than reporting it missing.
  const existing = bestMatches(
    projects.placed,
    query,
    (p) => p.project.name,
    (p) => pathText(p.path),
  );
  const name = normaliseName(query);
  const taken = projects.placed.some((p) => p.project.name.toLowerCase() === name.toLowerCase());
  const projectOptions: ProjectOption[] = [
    ...existing.map((placed) => ({ kind: 'existing' as const, placed })),
    ...(nameProblem(name) || taken ? [] : [{ kind: 'new' as const, name }]),
  ];
  const matchingFolders =
    query.trim() === '' ? folders.slice(0, 7) : bestMatches(folders, query, (f) => f.folder.name, (f) => pathText(f.path));
  // No folder is offered only before typing, so a folder name that matches nothing is reported, not taken as no folder.
  const folderOptions: FolderOption[] = [
    ...(query.trim() === '' ? [{ kind: 'top' as const }] : []),
    ...matchingFolders.map((placed) => ({ kind: 'folder' as const, placed })),
  ];
  const projectTypeAhead = useTypeAhead(naming === null ? projectOptions : [], optionKey);
  const folderTypeAhead = useTypeAhead(naming === null ? [] : folderOptions, folderKey);

  const chosen: { name: string; title: string } | undefined =
    newProject && newProject.id === value
      ? { name: newProject.name, title: `New project in ${newProject.folderPath.length > 0 ? pathText(newProject.folderPath) : 'no folder'}` }
      : (() => {
          const placed = value === null ? undefined : projects.byId.get(value);
          return placed && { name: placed.project.name, title: pathText(placed.path) };
        })();

  function clearQuery() {
    setQuery('');
    projectTypeAhead.reset();
    folderTypeAhead.reset();
  }

  function chooseProject(option: ProjectOption) {
    if (option.kind === 'existing') {
      onChange(option.placed.project.id);
      clearQuery();
    } else {
      setNaming(option.name);
      clearQuery();
    }
  }

  function chooseFolder(option: FolderOption) {
    if (naming === null) return;
    const folder = option.kind === 'folder' ? option.placed : null;
    const id = crypto.randomUUID();
    onChange(id, { id, name: naming, folderId: folder?.folder.id ?? null, folderPath: folder?.path ?? [] });
    setNaming(null);
    clearQuery();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();
    if (naming !== null) {
      if (folderTypeAhead.onArrowKey(event)) return;
      if (event.key === 'Enter' || event.key === 'Tab') {
        // Tab, like Enter, picks the folder; it then moves on to the next field rather than dropping the new project.
        if (folderTypeAhead.highlighted) {
          chooseFolder(folderTypeAhead.highlighted);
          if (event.key === 'Tab') onKeyDown(event);
          else event.preventDefault();
        } else {
          event.preventDefault();
          setProblem(`There is no folder called “${query.trim()}”.`);
        }
        return;
      }
      if (event.key === 'Escape') {
        // Back to naming the project, rather than out of the editor.
        event.preventDefault();
        setQuery(naming);
        setNaming(null);
        return;
      }
      onKeyDown(event);
      return;
    }
    if (projectTypeAhead.onArrowKey(event)) return;
    if (event.key === 'Enter' && query.trim() !== '') {
      event.preventDefault();
      if (projectTypeAhead.highlighted) chooseProject(projectTypeAhead.highlighted);
      else setProblem(`There is no project called “${query.trim()}”.`);
      return;
    }
    if (event.key === 'Backspace' && query === '' && value !== null) {
      event.preventDefault();
      onChange(null);
      return;
    }
    onKeyDown(event);
  }

  const typeAhead = naming === null ? projectTypeAhead : folderTypeAhead;
  return (
    <div className="chips-field">
      {chosen && naming === null && (
        <span className="project-chip" title={chosen.title}>
          {chosen.name}
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Remove from ${chosen.name}`}
            // As for tags: the button disappears once clicked, so it must not take focus.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChange(null)}
          >
            ×
          </button>
        </span>
      )}
      <span className="chips-input">
        <input
          ref={inputRef}
          aria-label={naming === null ? 'Project' : `Folder for ${naming}`}
          {...typeAhead.inputProps}
          placeholder={naming !== null ? `Folder for “${naming}”` : chosen ? '' : 'Add project'}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            typeAhead.reset();
            setProblem(null);
          }}
          onKeyDown={handleKeyDown}
        />
        {naming === null
          ? projectTypeAhead.list(
              'Matching projects',
              (option) => (option.kind === 'existing' ? pathText(option.placed.path) : `New project “${option.name}”`),
              chooseProject,
            )
          : folderTypeAhead.list(
              'Folders',
              (option) => (option.kind === 'folder' ? pathText(option.placed.path) : 'No folder (top level)'),
              chooseFolder,
            )}
      </span>
      {problem && <span role="alert">{problem}</span>}
    </div>
  );
}
