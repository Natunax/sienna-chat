// Native views (the side panel's browser) draw over everything in the window,
// so they hide while a dialog is open. Dialogs report here.

import { useSyncExternalStore } from "react";

let open = 0;
const listeners = new Set<() => void>();

/** Call when a modal opens; the returned function, when it closes. */
export function coverWindow(): () => void {
  open += 1;
  listeners.forEach((listener) => listener());
  let done = false;
  return () => {
    if (done) return;
    done = true;
    open -= 1;
    listeners.forEach((listener) => listener());
  };
}

export function useWindowCovered(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => open > 0,
  );
}
