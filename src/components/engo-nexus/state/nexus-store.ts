/**
 * ENGO Nexus UI state — panel open/closed, and the proactive popup's memory.
 *
 * A tiny external store rather than context: the launcher, the popup and the
 * panel all need this, they live at three different depths of the tree, and
 * the root already carries enough providers. `useSyncExternalStore` is the same
 * pattern `src/lib/filter-store.ts` uses, so this reads like the rest of the app.
 *
 * The conversation itself is NOT here — Botpress owns it, persisted under
 * `nexusStorageKey()`. Duplicating it would create two sources of truth for the
 * same messages.
 */

import { useSyncExternalStore } from "react";
import { NEXUS_POPUP_KEY, PROACTIVE_SNOOZE_MS } from "../lib/nexus-config";

export interface NexusUiState {
  open: boolean;
  expanded: boolean;
  /** Set when the panel is opened from a quick action, sent once on connect. */
  pendingPrompt: string | null;
}

type Listener = () => void;

let state: NexusUiState = { open: false, expanded: false, pendingPrompt: null };
const listeners = new Set<Listener>();

const emit = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: Listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => state;

export const nexusStore = {
  subscribe,
  get: getSnapshot,
  open(prompt?: string) {
    state = { ...state, open: true, pendingPrompt: prompt ?? null };
    emit();
  },
  close() {
    state = { ...state, open: false, expanded: false, pendingPrompt: null };
    emit();
  },
  toggleExpanded() {
    state = { ...state, expanded: !state.expanded };
    emit();
  },
  consumePendingPrompt(): string | null {
    const prompt = state.pendingPrompt;
    if (prompt !== null) {
      state = { ...state, pendingPrompt: null };
      emit();
    }
    return prompt;
  },
  /** Test-only reset; never called from application code. */
  reset() {
    state = { open: false, expanded: false, pendingPrompt: null };
    emit();
  },
};

export function useNexusUi(): NexusUiState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// --- Proactive popup memory --------------------------------------------------

interface PopupMemory {
  dismissedAt?: number;
  openedAt?: number;
}

function readMemory(): PopupMemory {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(NEXUS_POPUP_KEY);
    return raw ? (JSON.parse(raw) as PopupMemory) : {};
  } catch {
    // A corrupt or blocked store must never stop the dashboard rendering.
    return {};
  }
}

function writeMemory(memory: PopupMemory): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NEXUS_POPUP_KEY, JSON.stringify(memory));
  } catch {
    /* private mode, quota, blocked storage — all survivable */
  }
}

/**
 * Whether the proactive popup may appear.
 *
 * Two conditions, both about not being annoying: it never reappears within the
 * snooze window after a dismissal, and it never appears to someone who has
 * already opened the panel — they know it exists.
 */
export function canShowProactive(now: number = Date.now()): boolean {
  const memory = readMemory();
  if (memory.openedAt) return false;
  if (memory.dismissedAt && now - memory.dismissedAt < PROACTIVE_SNOOZE_MS) return false;
  return true;
}

export function rememberProactiveDismissed(now: number = Date.now()): void {
  writeMemory({ ...readMemory(), dismissedAt: now });
}

export function rememberPanelOpened(now: number = Date.now()): void {
  writeMemory({ ...readMemory(), openedAt: now });
}

/** Test-only: clears the popup memory. */
export function clearProactiveMemory(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(NEXUS_POPUP_KEY);
  } catch {
    /* ignore */
  }
}
