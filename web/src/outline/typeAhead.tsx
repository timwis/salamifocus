import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';

const maxSuggestions = 8;

/**
 * Items whose name or path contains the query, best matches first: names that
 * start with it (ignoring a leading @ or #), then names, then paths.
 */
export function bestMatches<T>(items: readonly T[], query: string, nameOf: (item: T) => string, pathOf: (item: T) => string): T[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  const rank = (item: T) => {
    const name = nameOf(item).toLowerCase();
    if (name.startsWith(q) || name.replace(/^[@#]/, '').startsWith(q)) return 0;
    if (name.includes(q)) return 1;
    if (pathOf(item).toLowerCase().includes(q)) return 2;
    return -1;
  };
  return items
    .map((item) => ({ item, rank: rank(item) }))
    .filter(({ rank }) => rank !== -1)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, maxSuggestions)
    .map(({ item }) => item);
}

/**
 * A text field's list of suggestions: ↑ and ↓ choose among them, and the
 * field announces the highlighted one. Choosing with the mouse leaves focus
 * in the field, so an editor around it stays open.
 */
export function useTypeAhead<T>(suggestions: readonly T[], keyOf: (item: T) => string) {
  const [active, setActive] = useState(0);
  const listId = useId();
  const highlighted = suggestions[Math.min(active, suggestions.length - 1)];
  const optionId = (item: T) => `${listId}-${keyOf(item)}`;

  return {
    highlighted,
    /** Highlights the first suggestion again, as when the query changes. */
    reset: () => setActive(0),
    /** Moves the highlight for ↑ and ↓, wrapping round. Returns whether it handled the key. */
    onArrowKey(event: KeyboardEvent): boolean {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return false;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      if (suggestions.length > 0) setActive((Math.min(active, suggestions.length - 1) + step + suggestions.length) % suggestions.length);
      return true;
    },
    inputProps: {
      role: 'combobox',
      'aria-autocomplete': 'list',
      'aria-expanded': suggestions.length > 0,
      'aria-controls': listId,
      'aria-activedescendant': highlighted ? optionId(highlighted) : undefined,
    } as const,
    list(label: string, render: (item: T) => ReactNode, onChoose: (item: T) => void): ReactNode {
      if (suggestions.length === 0) return null;
      return (
        <ul id={listId} role="listbox" aria-label={label} className="suggestions" onMouseDown={(e) => e.preventDefault()}>
          {suggestions.map((item) => (
            <li key={keyOf(item)} id={optionId(item)} role="option" aria-selected={item === highlighted} onClick={() => onChoose(item)}>
              {render(item)}
            </li>
          ))}
        </ul>
      );
    },
  };
}
