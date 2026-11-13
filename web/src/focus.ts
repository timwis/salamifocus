import { useLayoutEffect, useRef, useState, type FocusEvent } from 'react';

/**
 * Keeps keyboard focus on the current row of a region (a roving tab stop:
 * the region is one stop in the Tab order and arrow keys move within it).
 * While the region holds focus, focus follows `focusedKey` across re-renders,
 * including when synced data moves or replaces the row's element. It never
 * takes focus from a text field, or back from another region.
 */
export function useRovingFocus<T extends HTMLElement>(focusedKey: string | null) {
  const container = useRef<T>(null);
  const owns = useRef(false);

  useLayoutEffect(() => {
    if (!owns.current || focusedKey === null || !container.current) return;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
    const selector = `[data-key="${CSS.escape(focusedKey)}"]`;
    const target = container.current.matches(selector) ? container.current : container.current.querySelector<HTMLElement>(selector);
    if (target && active !== target) target.focus();
  });

  return {
    ref: container,
    /** Call before changing `focusedKey` from code that should move focus into the region. */
    claim() {
      owns.current = true;
    },
    handlers: {
      onFocus() {
        owns.current = true;
      },
      onBlur(event: FocusEvent) {
        const next = event.relatedTarget as Node | null;
        // A null target means the element was removed or moved, not that the user left.
        if (next && !container.current?.contains(next)) owns.current = false;
      },
    },
  };
}

/**
 * Which row of a region is current. When that row disappears (completed,
 * moved away, or removed by sync) the row now at its place becomes current,
 * so focus is never lost. A row just created locally can be awaited until the
 * write shows up.
 */
export function useCurrentRow(keys: readonly string[], initial: string | null = null) {
  const [chosen, setChosen] = useState<string | null>(initial);
  const lastIndex = useRef(0);
  const awaiting = useRef<string | null>(null);

  let index = chosen === null ? -1 : keys.indexOf(chosen);
  if (index !== -1 && awaiting.current === chosen) awaiting.current = null;
  const waiting = index === -1 && chosen !== null && awaiting.current === chosen;
  if (index === -1 && !waiting && keys.length > 0) index = Math.min(lastIndex.current, keys.length - 1);
  if (index !== -1) lastIndex.current = index;

  return {
    index,
    /** The key focus should be on: the current row, or the awaited one. */
    key: waiting ? chosen : (keys[index] ?? null),
    set: setChosen,
    /** Makes a row that does not exist yet current, keeping focus for it until it appears. */
    await(key: string) {
      awaiting.current = key;
      setChosen(key);
    },
  };
}

/** True when a key press should be left to a text field rather than treated as a command. */
export function isTyping(event: { target: EventTarget | null }): boolean {
  const target = event.target;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
}
