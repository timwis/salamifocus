import { tagPathSeparator, type PlacedTag } from '@salamifocus/domain';
import { useId, useState, type KeyboardEvent, type Ref } from 'react';
import { tagsInOrder, type Tags } from '../tags/data.ts';

const maxSuggestions = 8;

/** Tags whose name or path contains the query, best matches first: names that start with it, then names, then paths. */
export function matchingTags(placed: readonly PlacedTag[], exclude: ReadonlySet<string>, query: string): PlacedTag[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  const rank = ({ tag, path }: PlacedTag) => {
    const name = tag.name.toLowerCase();
    if (name.startsWith(q) || name.replace(/^[@#]/, '').startsWith(q)) return 0;
    if (name.includes(q)) return 1;
    if (path.join(tagPathSeparator).toLowerCase().includes(q)) return 2;
    return -1;
  };
  return placed
    .filter((p) => !exclude.has(p.tag.id))
    .map((p) => ({ p, rank: rank(p) }))
    .filter(({ rank }) => rank !== -1)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, maxSuggestions)
    .map(({ p }) => p);
}

/**
 * The task editor's tags: the task's tags as chips, and a type-ahead to add
 * more. Backspace in the empty field removes the last tag. Keys the field
 * does not use (Tab, Escape, Enter when there is nothing typed) go to the
 * editor through `onKeyDown`.
 */
export function TagsField({
  tags,
  value,
  onChange,
  onKeyDown,
  inputRef,
}: {
  tags: Tags;
  value: readonly string[];
  onChange: (ids: string[]) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  inputRef: Ref<HTMLInputElement>;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const listId = useId();
  const chosen = tagsInOrder(tags, value);
  const suggestions = matchingTags(tags.placed, new Set(value), query);
  const highlighted = suggestions[Math.min(active, suggestions.length - 1)];

  function add(tag: PlacedTag) {
    onChange([...value, tag.tag.id]);
    setQuery('');
    setActive(0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      if (suggestions.length > 0) setActive((Math.min(active, suggestions.length - 1) + step + suggestions.length) % suggestions.length);
      return;
    }
    if (event.key === 'Enter' && query.trim() !== '') {
      event.preventDefault();
      if (highlighted) add(highlighted);
      else setProblem(`There is no tag called “${query.trim()}”.`);
      return;
    }
    if (event.key === 'Backspace' && query === '' && value.length > 0) {
      event.preventDefault();
      const last = chosen.at(-1);
      onChange(last ? value.filter((id) => id !== last.tag.id) : value.slice(0, -1));
      return;
    }
    onKeyDown(event);
  }

  return (
    <div className="tags-field">
      {chosen.map(({ tag, path }) => (
        <span key={tag.id} className="tag-chip" title={path.join(tagPathSeparator)}>
          {tag.name}
          <button type="button" tabIndex={-1} aria-label={`Remove ${tag.name}`} onClick={() => onChange(value.filter((id) => id !== tag.id))}>
            ×
          </button>
        </span>
      ))}
      <span className="tags-input">
        <input
          ref={inputRef}
          aria-label="Tags"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={suggestions.length > 0}
          aria-controls={listId}
          aria-activedescendant={highlighted ? `${listId}-${highlighted.tag.id}` : undefined}
          placeholder={chosen.length === 0 ? 'Add tags' : ''}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setProblem(null);
          }}
          onKeyDown={handleKeyDown}
        />
        {suggestions.length > 0 && (
          // Choosing with the mouse must not take focus out of the editor, which would close it.
          <ul id={listId} role="listbox" aria-label="Matching tags" className="tag-suggestions" onMouseDown={(e) => e.preventDefault()}>
            {suggestions.map((suggestion) => (
              <li
                key={suggestion.tag.id}
                id={`${listId}-${suggestion.tag.id}`}
                role="option"
                aria-selected={suggestion === highlighted}
                onClick={() => add(suggestion)}
              >
                {suggestion.path.join(tagPathSeparator)}
              </li>
            ))}
          </ul>
        )}
      </span>
      {problem && <span role="alert">{problem}</span>}
    </div>
  );
}
