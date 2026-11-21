import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { CaptureBox } from './Capture.tsx';
import { isTyping, useRovingFocus } from './focus.ts';
import { Inbox } from './Inbox.tsx';
import { ActionablePerspective } from './actionable/ActionablePerspective.tsx';
import { AgendasPerspective } from './agendas/AgendasPerspective.tsx';
import { FlaggedPerspective } from './flagged/FlaggedPerspective.tsx';
import { ForecastPerspective } from './forecast/ForecastPerspective.tsx';
import { goToPerspective, hasSidebar, perspectivePath, perspectives, usePlace, type Perspective } from './navigation.ts';
import { OrganisationProvider } from './projects/data.tsx';
import { ProjectsPerspective } from './projects/ProjectsPerspective.tsx';
import { signOut } from './session.ts';
import { SettingsDialog } from './settings/Settings.tsx';
import { TagsProvider } from './tags/data.tsx';
import { TagsPerspective } from './tags/TagsPerspective.tsx';
import { SyncState } from './SyncState.tsx';

type Region = 'perspectives' | 'sidebar' | 'outline';

/** Focuses the region's current row (its one Tab stop). */
function focusCurrentRow(region: HTMLElement | null) {
  const target = region?.matches('[tabindex="0"]') ? region : region?.querySelector<HTMLElement>('[tabindex="0"]');
  target?.focus();
}

/**
 * Focuses the current row of a region straight away, so keys pressed next go
 * there. Tries again after the next frame in case that row was replaced as
 * the region's data loaded, unless the user has moved focus since.
 */
function focusRegion(region: Region) {
  const container = () => document.querySelector<HTMLElement>(`[data-region="${region}"]`);
  focusCurrentRow(container());
  const settled = document.activeElement;
  requestAnimationFrame(() => {
    const active = document.activeElement;
    const lost = !active || active === document.body || !active.isConnected;
    if ((active === settled || lost) && !container()?.contains(active)) focusCurrentRow(container());
  });
}

/** Opens a perspective and puts focus in it (its sidebar if it has one), as the number keys do. */
function switchTo(perspective: Perspective) {
  // Render the new perspective now, so the focus below lands on its rows
  // rather than on the old perspective's, which are about to disappear.
  flushSync(() => goToPerspective(perspective));
  focusRegion(hasSidebar(perspective) ? 'sidebar' : 'outline');
}

/**
 * The desktop layout: perspective navigation, the perspective's sidebar (if
 * it has one) and its main outline. Tab and Shift+Tab move between them.
 */
export function Shell() {
  const place = usePlace();
  const [capturing, setCapturing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Where focus was before capturing, to return to afterwards; null while not capturing.
  const returnTo = useRef<Element | null>(null);

  function startCapture() {
    // Already open (the button keeps focus in the box): keep the original place to return to.
    if (returnTo.current) return;
    returnTo.current = document.activeElement ?? document.body;
    setCapturing(true);
  }

  /** Closes the capture box, putting focus back where it was unless the user has already moved it elsewhere. */
  function endCapture(focusMoved: boolean) {
    flushSync(() => setCapturing(false));
    const previous = returnTo.current;
    returnTo.current = null;
    if (focusMoved) return;
    if (previous instanceof HTMLElement && previous.isConnected && previous !== document.body) previous.focus();
    else focusRegion(hasSidebar(place.perspective) ? 'sidebar' : 'outline');
  }

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (isTyping(event) || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'c') {
        event.preventDefault();
        startCapture();
        return;
      }
      if (event.key === ',') {
        event.preventDefault();
        setSettingsOpen(true);
        return;
      }
      const perspective = perspectives.find((p) => p.key === event.key);
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
  }, []);

  return (
    <div className="shell">
      <header>
        <h1>salamifocus</h1>
        <SyncState />
        <button
          type="button"
          className="capture-button"
          tabIndex={-1}
          title="Capture to Inbox (C)"
          aria-keyshortcuts="C"
          // Keeps focus where it is, so it can go back there after capturing.
          onMouseDown={(event) => event.preventDefault()}
          onClick={startCapture}
        >
          + Capture
        </button>
        <button
          type="button"
          tabIndex={-1}
          title="Settings (,)"
          aria-keyshortcuts=","
          // Keeps focus where it is, so closing the dialog returns there.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setSettingsOpen(true)}
        >
          Settings
        </button>
        <button type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      <OrganisationProvider>
        <TagsProvider>
          <div className="regions" data-perspective={place.perspective}>
            <PerspectiveNav current={place.perspective} onBrowse={goToPerspective} onOpen={switchTo} />
            {place.perspective === 'projects' ? (
              <ProjectsPerspective place={place} />
            ) : place.perspective === 'tags' ? (
              <TagsPerspective place={place} />
            ) : place.perspective === 'flagged' ? (
              <FlaggedPerspective place={place} />
            ) : place.perspective === 'forecast' ? (
              <ForecastPerspective />
            ) : place.perspective === 'personal' || place.perspective === 'work' ? (
              <ActionablePerspective key={place.perspective} scope={place.perspective} place={place} />
            ) : place.perspective === 'agendas' ? (
              <AgendasPerspective place={place} />
            ) : (
              <Inbox />
            )}
          </div>
          {capturing && <CaptureBox onClose={endCapture} />}
          {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
        </TagsProvider>
      </OrganisationProvider>
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
        {perspectives.map((perspective) => (
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
              aria-keyshortcuts={perspective.key}
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
