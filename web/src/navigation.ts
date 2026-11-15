import { useSyncExternalStore } from 'react';

// Where the user is: the perspective, and what is selected in its sidebar, as
// a path such as /projects/<id>,<id> or /tags/<id>. Kept in the URL so a
// reload comes back to the same place. The app server answers any page path
// with the app, so these paths load directly too.

export const perspectives = [
  { id: 'inbox', name: 'Inbox' },
  { id: 'projects', name: 'Projects' },
  { id: 'tags', name: 'Tags' },
] as const;

export type Perspective = (typeof perspectives)[number]['id'];

export interface Place {
  perspective: Perspective;
  selection: string[];
}

const listeners = new Set<() => void>();
let cached: { path: string; place: Place } | null = null;
// Returning to a perspective brings back what was selected there.
const lastSelection = new Map<Perspective, string[]>();

function read(): Place {
  if (cached?.path === location.pathname) return cached.place;
  const [, perspective = '', selection = ''] = location.pathname.split('/');
  const place: Place = {
    perspective: perspectives.some((p) => p.id === perspective) ? (perspective as Perspective) : 'inbox',
    selection: selection ? selection.split(',').flatMap(decodeOrDrop) : [],
  };
  cached = { path: location.pathname, place };
  lastSelection.set(place.perspective, place.selection);
  return place;
}

/** A truncated or hand-edited address must not stop the app rendering, so undecodable parts are ignored. */
function decodeOrDrop(part: string): string[] {
  try {
    return [decodeURIComponent(part)];
  } catch {
    return [];
  }
}

export function pathFor(place: Place): string {
  const selection = place.selection.map(encodeURIComponent).join(',');
  return `/${place.perspective}${selection ? `/${selection}` : ''}`;
}

export function perspectivePath(perspective: Perspective): string {
  return pathFor({ perspective, selection: lastSelection.get(perspective) ?? [] });
}

export function goToPerspective(perspective: Perspective): void {
  go({ perspective, selection: lastSelection.get(perspective) ?? [] });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

export function usePlace(): Place {
  return useSyncExternalStore(subscribe, read);
}

/** Goes to a place. Changing perspective adds a history entry; changing the selection replaces it. */
export function go(place: Place): void {
  const current = read();
  const path = pathFor(place);
  if (path === location.pathname) return;
  if (place.perspective === current.perspective) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  read();
  for (const listener of listeners) listener();
}
