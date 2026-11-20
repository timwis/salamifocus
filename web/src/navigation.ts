import { isVisibility, Visibility } from '@salamifocus/domain';
import { useSyncExternalStore } from 'react';

// Where the user is: the perspective, what is selected in its sidebar and,
// where it offers a choice, how much it shows, as a path such as
// /projects/<id>,<id> or /tags/<id>?show=available. Kept in the URL so a
// reload comes back to the same place. The app server answers any page path
// with the app, so these paths load directly too.

export const perspectives = [
  { id: 'inbox', name: 'Inbox', visibility: null, sidebar: false },
  { id: 'projects', name: 'Projects', visibility: Visibility.remaining, sidebar: true },
  { id: 'tags', name: 'Tags', visibility: Visibility.remaining, sidebar: true },
  { id: 'flagged', name: 'Flagged', visibility: Visibility.available, sidebar: false },
] as const;

export type Perspective = (typeof perspectives)[number]['id'];

export interface Place {
  perspective: Perspective;
  selection: string[];
  /** How much the outline shows, where the perspective offers a choice. Left out, it stays as it was. */
  visibility?: Visibility;
}

/** Whether a perspective has a sidebar, which is where focus goes on opening it. */
export const hasSidebar = (perspective: Perspective): boolean => perspectives.find((p) => p.id === perspective)?.sidebar ?? false;

/** The visibility a perspective starts with, or null if it offers no choice. */
const defaultVisibility = (perspective: Perspective): Visibility | null => perspectives.find((p) => p.id === perspective)?.visibility ?? null;

const listeners = new Set<() => void>();
let cached: { url: string; place: Place } | null = null;
// Returning to a perspective brings back what was selected there, and what it showed.
const lastPlace = new Map<Perspective, Place>();

function read(): Place {
  const url = location.pathname + location.search;
  if (cached?.url === url) return cached.place;
  const [, name = '', selection = ''] = location.pathname.split('/');
  const perspective = perspectives.some((p) => p.id === name) ? (name as Perspective) : 'inbox';
  const show = new URLSearchParams(location.search).get('show');
  const fallback = defaultVisibility(perspective);
  const visibility = fallback === null ? undefined : isVisibility(show) ? show : fallback;
  const place: Place = { perspective, selection: selection ? selection.split(',').flatMap(decodeOrDrop) : [], visibility };
  cached = { url, place };
  lastPlace.set(place.perspective, place);
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
  const show = place.visibility && place.visibility !== defaultVisibility(place.perspective) ? `?show=${place.visibility}` : '';
  return `/${place.perspective}${selection ? `/${selection}` : ''}${show}`;
}

export function perspectivePath(perspective: Perspective): string {
  return pathFor(lastPlace.get(perspective) ?? { perspective, selection: [] });
}

export function goToPerspective(perspective: Perspective): void {
  go(lastPlace.get(perspective) ?? { perspective, selection: [] });
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

/** Goes to a place. Changing perspective adds a history entry; changing the selection or visibility replaces it. */
export function go(place: Place): void {
  const current = read();
  const samePerspective = place.perspective === current.perspective;
  const path = pathFor(samePerspective && place.visibility === undefined ? { ...place, visibility: current.visibility } : place);
  if (path === location.pathname + location.search) return;
  if (samePerspective) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  read();
  for (const listener of listeners) listener();
}
