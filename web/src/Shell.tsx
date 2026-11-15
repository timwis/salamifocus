import { useEffect, type KeyboardEvent } from 'react';
import { isTyping, useRovingFocus } from './focus.ts';
import { Inbox } from './Inbox.tsx';
import { goToPerspective, perspectivePath, perspectives, usePlace, type Perspective } from './navigation.ts';
import { ProjectsPerspective } from './projects/ProjectsPerspective.tsx';
import { signOut } from './session.ts';
import { SyncState } from './SyncState.tsx';

/** Focuses the current row of a region, once the next render has happened. */
export function focusRegion(region: 'perspectives' | 'sidebar' | 'outline') {
  requestAnimationFrame(() => {
    const container = document.querySelector<HTMLElement>(`[data-region="${region}"]`);
    const target = container?.matches('[tabindex="0"]') ? container : container?.querySelector<HTMLElement>('[tabindex="0"]');
    target?.focus();
  });
}

/**
 * The desktop layout: perspective navigation, the perspective's sidebar (if
 * it has one) and its main outline. Tab and Shift+Tab move between them.
 */
export function Shell() {
  const place = usePlace();

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (isTyping(event) || event.altKey || event.ctrlKey || event.metaKey) return;
      const perspective = perspectives[Number(event.key) - 1];
      if (!perspective) return;
      event.preventDefault();
      switchTo(perspective.id);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  function switchTo(perspective: Perspective) {
    if (perspective !== place.perspective) goToPerspective(perspective);
    focusRegion(perspective === 'projects' ? 'sidebar' : 'outline');
  }

  return (
    <div className="shell">
      <header>
        <h1>salamifocus</h1>
        <SyncState />
        <button type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      <div className="regions" data-perspective={place.perspective}>
        <PerspectiveNav current={place.perspective} onSelect={goToPerspective} />
        {place.perspective === 'projects' ? <ProjectsPerspective place={place} /> : <Inbox />}
      </div>
    </div>
  );
}

function PerspectiveNav({ current, onSelect }: { current: Perspective; onSelect: (perspective: Perspective) => void }) {
  const roving = useRovingFocus<HTMLUListElement>(current);

  function onKeyDown(event: KeyboardEvent) {
    const index = perspectives.findIndex((p) => p.id === current);
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    const next = perspectives[index + step];
    if (step === 0 || !next) return;
    event.preventDefault();
    roving.claim();
    onSelect(next.id);
  }

  return (
    <nav aria-label="Perspectives" data-region="perspectives">
      <ul ref={roving.ref} onKeyDown={onKeyDown} {...roving.handlers}>
        {perspectives.map((perspective, index) => (
          <li key={perspective.id}>
            <a
              href={perspectivePath(perspective.id)}
              onClick={(event) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                onSelect(perspective.id);
              }}
              data-key={perspective.id}
              tabIndex={perspective.id === current ? 0 : -1}
              aria-current={perspective.id === current ? 'page' : undefined}
              aria-keyshortcuts={String(index + 1)}
            >
              <span className={`perspective-icon perspective-${perspective.id}`} aria-hidden />
              {perspective.name}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
