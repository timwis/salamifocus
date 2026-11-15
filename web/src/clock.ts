import { useEffect, useReducer } from 'react';

// Browsers cap timeouts at about 24.8 days; a later time is waited for in steps.
const longestWait = 2 ** 31 - 1;

/**
 * The current time, for a component whose output depends on it. It renders again when the clock passes any
 * of `times` (such as defer dates), and whenever the window comes back into view, so a deferred task becomes
 * available on screen without any change to its data.
 */
export function useNow(times: readonly (string | null | undefined)[]): Date {
  const [ticks, tick] = useReducer((n: number) => n + 1, 0);
  const now = new Date();
  const next = times.reduce<number | null>((soonest, time) => {
    const at = time ? Date.parse(time) : Number.NaN;
    return at > now.getTime() && (soonest === null || at < soonest) ? at : soonest;
  }, null);

  useEffect(() => {
    if (next === null) return;
    const timer = setTimeout(tick, Math.min(next - Date.now(), longestWait));
    return () => clearTimeout(timer);
  }, [next, ticks]);

  useEffect(() => {
    const refresh = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  return now;
}
