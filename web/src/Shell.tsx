import { useEffect, type KeyboardEvent } from 'react';
import { isTyping, useRovingFocus } from './focus.ts';
import { Inbox } from './Inbox.tsx';
import { goToPerspective, perspectivePath, perspectives, usePlace, type Perspective } from './navigation.ts';
import { ProjectsPerspective } from './projects/ProjectsPerspective.tsx';
import { signOut } from './session.ts';
import { SyncState } from './SyncState.tsx';

type Region = 'perspectives' | 'sidebar' | 'outline';

/** Focuses the region's current row (its one Tab stop). */
function focusCurrentRow(region: HTMLElement | null) {
  const target = region?.matches('[tabindex="0"]') ? region : region?.querySelector<HTMLElement>('[tabindex="0"]');
  target?.focus();
}

/**
 * Focuses the current row of a region straight away, so keys pressed next go
 * there. If the region is still rendering (just after switching perspective),
 * tries again after the next frame, unless the user has moved focus since.
 */
function focusRegion(region: Region) {
  const container = () => document.querySelector<HTMLElement>(`[data-region="${region}"]`);
  focusCurrentRow(container());
  const settled = document.activeElement;
  requestAnimationFrame(() => {
    if (document.activeElement === settled && !container()?.contains(settled)) focusCurrentRow(container());
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
    // Clicking empty space in a region keeps keyboard focus in that region
    // rather than dropping it on the page, where no keys would work.
    function onMouseDown(event: MouseEvent) {
      const target = event.target as Element;
      const region = target.closest<HTMLElement>('[data-region]');
      const focusable = target.closest('input, textarea, select, button, a, [tabindex]');
      if (!region || (focusable && !focusable.hasAttribute('data-roving'))) return;
      event.preventDefault();
      focusCurrentRow(region);
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onMouseDown);
    };
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
        <PerspectiveNav current={place.perspective} onBrowse={goToPerspective} onOpen={switchTo} />
        {place.perspective === 'projects' ? <ProjectsPerspective place={place} /> : <Inbox />}
      </div>
    </div>
  );
}

/**
 * Arrow keys browse perspectives while staying in the navigation. Clicking
 * one, or pressing Enter, opens it and moves focus into it.
 */
function PerspectiveNav({
  current,
  onBrowse,
  onOpen,
}: {
  current: Perspective;
  onBrowse: (perspective: Perspective) => void;
  onOpen: (perspective: Perspective) => void;
}) {
  const roving = useRovingFocus<HTMLUListElement>(current);

  function onKeyDown(event: KeyboardEvent) {
    const index = perspectives.findIndex((p) => p.id === current);
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    const next = perspectives[index + step];
    if (step === 0 || !next) return;
    event.preventDefault();
    roving.claim();
    onBrowse(next.id);
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
                onOpen(perspective.id);
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
