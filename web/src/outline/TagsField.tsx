import { tagPathSeparator, type PlacedTag } from '@salamifocus/domain';
import { useState, type KeyboardEvent, type Ref } from 'react';
import { tagsInOrder, type Tags } from '../tags/data.tsx';
import { bestMatches, useTypeAhead } from './typeAhead.tsx';

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
  const [problem, setProblem] = useState<string | null>(null);
  const chosen = tagsInOrder(tags, value);
  const taken = new Set(value);
  const suggestions = bestMatches(
    tags.placed.filter((p) => !taken.has(p.tag.id)),
    query,
    (p) => p.tag.name,
    (p) => p.path.join(tagPathSeparator),
  );
  const typeAhead = useTypeAhead(suggestions, (p) => p.tag.id);

  function add(tag: PlacedTag) {
    onChange([...value, tag.tag.id]);
    setQuery('');
    typeAhead.reset();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();
    if (typeAhead.onArrowKey(event)) return;
    if (event.key === 'Enter' && query.trim() !== '') {
      event.preventDefault();
      if (typeAhead.highlighted) add(typeAhead.highlighted);
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
    <div className="chips-field">
      {chosen.map(({ tag, path }) => (
        <span key={tag.id} className="tag-chip" title={path.join(tagPathSeparator)}>
          {tag.name}
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Remove ${tag.name}`}
            // The button disappears once clicked, so it must not take focus: losing it would leave the editor unaware.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChange(value.filter((id) => id !== tag.id))}
          >
            ×
          </button>
        </span>
      ))}
      <span className="chips-input">
        <input
          ref={inputRef}
          aria-label="Tags"
          {...typeAhead.inputProps}
          placeholder={chosen.length === 0 ? 'Add tags' : ''}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            typeAhead.reset();
            setProblem(null);
          }}
          onKeyDown={handleKeyDown}
        />
        {typeAhead.list('Matching tags', (p) => p.path.join(tagPathSeparator), add)}
      </span>
      {problem && <span role="alert">{problem}</span>}
    </div>
  );
}
