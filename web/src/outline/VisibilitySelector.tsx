import { visibilities, Visibility } from '@salamifocus/domain';
import { useEffect, useRef } from 'react';
import { isTyping } from '../focus.ts';

const labels: Record<Visibility, { name: string; description: string }> = {
  [Visibility.available]: { name: 'Available', description: 'Only tasks that can be worked on now' },
  [Visibility.remaining]: { name: 'Remaining', description: 'Every unfinished task, including blocked and deferred ones' },
};

/**
 * Chooses how much the outline shows. V moves to the next choice and Shift+V to the previous one, from
 * anywhere in the perspective; the buttons are their mouse equivalent, kept out of the Tab order.
 */
export function VisibilitySelector({ value, choose }: { value: Visibility; choose: (visibility: Visibility) => void }) {
  const latest = useRef({ value, choose });
  latest.current = { value, choose };

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isTyping(event) || event.altKey || event.ctrlKey || event.metaKey || event.key.toLowerCase() !== 'v') return;
      event.preventDefault();
      const { value, choose } = latest.current;
      const step = event.shiftKey ? -1 : 1;
      choose(visibilities[(visibilities.indexOf(value) + step + visibilities.length) % visibilities.length]!);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div role="radiogroup" aria-label="Show" aria-keyshortcuts="V Shift+V" className="visibility">
      {visibilities.map((visibility) => (
        <button
          key={visibility}
          type="button"
          role="radio"
          tabIndex={-1}
          aria-checked={visibility === value}
          title={`${labels[visibility].description} (V)`}
          // Keeps keyboard focus where it is.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => choose(visibility)}
        >
          {labels[visibility].name}
        </button>
      ))}
    </div>
  );
}
