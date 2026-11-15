import { tagPathSeparator, type PlacedProject } from '@salamifocus/domain';
import { useState, type KeyboardEvent, type Ref } from 'react';
import type { Projects } from '../projects/data.tsx';
import { bestMatches, useTypeAhead } from './typeAhead.tsx';

/**
 * The task editor's project: the project or single-action list the task is
 * in, and a type-ahead to choose another. Backspace in the empty field takes
 * the task out of its project. Keys the field does not use (Tab, Escape,
 * Enter when there is nothing typed) go to the editor through `onKeyDown`.
 */
export function ProjectField({
  projects,
  value,
  onChange,
  onKeyDown,
  inputRef,
}: {
  projects: Projects;
  value: string | null;
  onChange: (id: string | null) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  inputRef: Ref<HTMLInputElement>;
}) {
  const [query, setQuery] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const chosen = value === null ? undefined : projects.byId.get(value);
  const suggestions = bestMatches(
    projects.placed.filter((p) => p.project.id !== value),
    query,
    (p) => p.project.name,
    (p) => p.path.join(tagPathSeparator),
  );
  const typeAhead = useTypeAhead(suggestions, (p) => p.project.id);

  function choose(project: PlacedProject) {
    onChange(project.project.id);
    setQuery('');
    typeAhead.reset();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();
    if (typeAhead.onArrowKey(event)) return;
    if (event.key === 'Enter' && query.trim() !== '') {
      event.preventDefault();
      if (typeAhead.highlighted) choose(typeAhead.highlighted);
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

  return (
    <div className="chips-field">
      {chosen && (
        <span className="project-chip" title={chosen.path.join(tagPathSeparator)}>
          {chosen.project.name}
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Remove from ${chosen.project.name}`}
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
          aria-label="Project"
          {...typeAhead.inputProps}
          placeholder={chosen ? '' : 'Add project'}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            typeAhead.reset();
            setProblem(null);
          }}
          onKeyDown={handleKeyDown}
        />
        {typeAhead.list('Matching projects', (p) => p.path.join(tagPathSeparator), choose)}
      </span>
      {problem && <span role="alert">{problem}</span>}
    </div>
  );
}
