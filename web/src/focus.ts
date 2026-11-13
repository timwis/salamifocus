import { useLayoutEffect, useRef, type FocusEvent } from 'react';

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

/** True when a key press should be left to a text field rather than treated as a command. */
export function isTyping(event: { target: EventTarget | null }): boolean {
  const target = event.target;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
}
