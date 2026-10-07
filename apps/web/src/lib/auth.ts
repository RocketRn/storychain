import { useSyncExternalStore } from "react";

/**
 * Telegram hands the Mini App its initData once, at launch, and never refreshes it. When the server stops
 * accepting it (it is only valid for a limited time) every request fails with 401 and no retry can help:
 * the user has to reopen the app. Screens show one clear message instead of a different error each.
 */
let expired = false;
const listeners = new Set<() => void>();

export function markSessionExpired(): void {
  if (expired) return;
  expired = true;
  for (const l of listeners) l();
}

/** test helper */
export function resetSessionExpired(): void {
  expired = false;
  for (const l of listeners) l();
}

export const isSessionExpired = (): boolean => expired;

const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};

export function useSessionExpired(): boolean {
  return useSyncExternalStore(subscribe, isSessionExpired, () => false);
}
