import { useSyncExternalStore } from 'react';

// Where the user is: the perspective, and for Projects the selected folders
// and projects. Kept in the URL so a reload, including offline, comes back to
// the same place.

export const perspectives = [
  { id: 'inbox', name: 'Inbox' },
  { id: 'projects', name: 'Projects' },
] as const;

export type Perspective = (typeof perspectives)[number]['id'];

export interface Place {
  perspective: Perspective;
  selection: string[];
}

const listeners = new Set<() => void>();
let cached: { hash: string; place: Place } | null = null;

function read(): Place {
  if (cached?.hash === location.hash) return cached.place;
  const [, perspective = '', selection = ''] = location.hash.split('/');
  const place: Place = {
    perspective: perspectives.some((p) => p.id === perspective) ? (perspective as Perspective) : 'inbox',
    selection: selection ? selection.split(',').map(decodeURIComponent) : [],
  };
  cached = { hash: location.hash, place };
  lastSelection.set(place.perspective, place.selection);
  return place;
}

// Returning to a perspective brings back what was selected there.
const lastSelection = new Map<Perspective, string[]>();

export function hrefFor(place: Place): string {
  const selection = place.selection.map(encodeURIComponent).join(',');
  return `#/${place.perspective}${selection ? `/${selection}` : ''}`;
}

export function perspectiveHref(perspective: Perspective): string {
  return hrefFor({ perspective, selection: lastSelection.get(perspective) ?? [] });
}

export function goToPerspective(perspective: Perspective): void {
  go({ perspective, selection: lastSelection.get(perspective) ?? [] });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('hashchange', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('hashchange', listener);
  };
}

export function usePlace(): Place {
  return useSyncExternalStore(subscribe, read);
}

/** Goes to a place. Changing perspective adds a history entry; changing the selection replaces it. */
export function go(place: Place): void {
  const current = read();
  const hash = hrefFor(place);
  if (hash === location.hash) return;
  if (place.perspective === current.perspective) history.replaceState(null, '', hash);
  else history.pushState(null, '', hash);
  read();
  for (const listener of listeners) listener();
}
