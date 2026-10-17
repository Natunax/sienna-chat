// The setting "approve automatically": on top of every permission mode,
// Sienna answers each approval as if the user clicked Allow. Destructive
// commands still ask (`sidecar/index.mjs`). Kept on this Mac, off by default.

import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";

const KEY = "sienna.autoApprove";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let on = read();

export function autoApproveOn(): boolean {
  return on;
}

export function setAutoApprove(next: boolean) {
  on = next;
  try {
    if (next) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // Still applies until the app restarts.
  }
  // Running answers learn it at once; waiting approvals it covers go through.
  void invoke("auto_approve", { on: next }).catch(() => {});
  listeners.forEach((listener) => listener());
}

export function useAutoApprove(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => on,
  );
}
