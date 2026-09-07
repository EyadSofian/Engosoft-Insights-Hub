import { useEffect, useSyncExternalStore } from "react";

/**
 * The explicit controller for the desktop navigation rail.
 *
 * The rail used to disappear after a scroll threshold. That made the layout
 * feel like it was making a decision for the reader: a long report could
 * suddenly widen, then the navigation moved again on the way back up. The
 * dashboard now has one deliberate state instead — open or collapsed — and
 * only the reader changes it through the visible button or ⌘/Ctrl + B.
 */

export interface ChromeState {
  /** True when the desktop rail is manually collapsed. */
  navHidden: boolean;
}

const NAV_COLLAPSED_KEY = "engo_navigation_collapsed";

let state: ChromeState = { navHidden: false };
const listeners = new Set<() => void>();

function set(next: Partial<ChromeState>) {
  const merged = { ...state, ...next };
  if (merged.navHidden === state.navHidden) return;
  state = merged;
  for (const listener of listeners) listener();
}

function persist(navHidden: boolean) {
  try {
    window.localStorage.setItem(NAV_COLLAPSED_KEY, navHidden ? "1" : "0");
  } catch {
    // Private mode: the choice simply does not survive the session.
  }
}

export const chromeStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: () => state,
  setNavigationHidden(navHidden: boolean) {
    persist(navHidden);
    set({ navHidden });
  },
  toggleNavigation() {
    chromeStore.setNavigationHidden(!state.navHidden);
  },
  /** Adopts the reader's last deliberate open/collapse choice. */
  hydrate() {
    try {
      set({ navHidden: window.localStorage.getItem(NAV_COLLAPSED_KEY) === "1" });
    } catch {
      // Leave the default open when storage is unavailable.
    }
  },
};

const serverState: ChromeState = { navHidden: false };

export function useChrome(): ChromeState {
  return useSyncExternalStore(chromeStore.subscribe, chromeStore.get, () => serverState);
}

/**
 * Mounted once by the shell. It restores the manual choice, keeps the content
 * inset aligned with the rail and provides the familiar editor shortcut.
 */
export function useAutoHideChrome() {
  const chrome = useChrome();

  useEffect(() => {
    chromeStore.hydrate();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "b") return;
      event.preventDefault();
      chromeStore.toggleNavigation();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--chrome-nav-inset", chrome.navHidden ? "0px" : "var(--sidebar-w)");
  }, [chrome.navHidden]);

  return chrome;
}
