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
import {
  NEXUS_OPTOUT_KEY,
  NEXUS_POPUP_KEY,
  PROACTIVE_AFTER_OPEN_MS,
  PROACTIVE_MAX_PER_SESSION,
  PROACTIVE_MAX_PER_WEEK,
  PROACTIVE_SNOOZE_MS,
  PROACTIVE_SURFACE_SNOOZE_MS,
} from "../lib/nexus-config";
import type { NexusNotificationContext } from "../lib/nexus-notification";

export interface NexusUiState {
  open: boolean;
  expanded: boolean;
  /** Set when the panel is opened from a quick action, sent once on connect. */
  pendingPrompt: string | null;
  /** Stored Qodo brief shown above the conversation while it is being analysed. */
  notice: NexusNotificationContext | null;
}

type Listener = () => void;

let state: NexusUiState = { open: false, expanded: false, pendingPrompt: null, notice: null };
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
    state = { ...state, open: true, pendingPrompt: prompt ?? null, notice: null };
    emit();
  },
  openNotification(notice: NexusNotificationContext, prompt: string) {
    state = { ...state, open: true, pendingPrompt: prompt, notice };
    emit();
  },
  close() {
    state = { ...state, open: false, expanded: false, pendingPrompt: null, notice: null };
    emit();
  },
  dismissNotice() {
    state = { ...state, notice: null };
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
    state = { open: false, expanded: false, pendingPrompt: null, notice: null };
    emit();
  },
};

export function useNexusUi(): NexusUiState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// --- Proactive popup memory --------------------------------------------------

/**
 * WHEN THE POPUP MAY APPEAR.
 *
 * The old rule was two lines: not within a week of a dismissal, and never to
 * anyone who has ever opened the panel. The second one is why proactive help
 * silently stopped working for every returning user — clicking the launcher
 * once disabled every future page-specific offer permanently.
 *
 * The rules now, in the order they are checked:
 *   - a global opt-out is absolute;
 *   - a dismissal buys a week of silence;
 *   - opening the panel buys a DAY, not a lifetime;
 *   - a surface that has already offered waits a week before offering again,
 *     tracked per surface so Courses does not consume Media Plan's one chance;
 *   - at most three across all surfaces per rolling week;
 *   - at most one per browser session, however long that session runs.
 *
 * Every threshold lives in nexus-config.ts, and `now` is injected so all of it
 * is testable without waiting a week.
 */

interface PopupMemory {
  dismissedAt?: number;
  openedAt?: number;
  /** Surface id → when it last offered. Separate from the global cap. */
  shownSurfaces?: Record<string, number>;
  /** Timestamps of recent showings, for the rolling weekly cap. */
  shownAt?: number[];
}

/**
 * Per-session, deliberately NOT persisted.
 *
 * "Stop appearing repeatedly in the same session" is about this tab right now;
 * reloading the page is a new session and the weekly caps still apply.
 */
let shownThisSession = 0;

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

/** The global switch. Absolute, and checked before anything else. */
export function isProactiveOptedOut(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(NEXUS_OPTOUT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setProactiveOptOut(off: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (off) window.localStorage.setItem(NEXUS_OPTOUT_KEY, "1");
    else window.localStorage.removeItem(NEXUS_OPTOUT_KEY);
  } catch {
    /* ignore */
  }
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Whether the proactive popup may appear on this surface, right now. */
export function canShowProactive(
  options: { surface?: string | null; now?: number } = {},
): boolean {
  const now = options.now ?? Date.now();
  const surface = options.surface ?? null;

  if (isProactiveOptedOut()) return false;
  if (shownThisSession >= PROACTIVE_MAX_PER_SESSION) return false;

  const memory = readMemory();
  if (memory.dismissedAt && now - memory.dismissedAt < PROACTIVE_SNOOZE_MS) return false;
  if (memory.openedAt && now - memory.openedAt < PROACTIVE_AFTER_OPEN_MS) return false;

  if (surface) {
    const lastOnSurface = memory.shownSurfaces?.[surface];
    if (lastOnSurface && now - lastOnSurface < PROACTIVE_SURFACE_SNOOZE_MS) return false;
  }

  const recent = (memory.shownAt ?? []).filter((stamp) => now - stamp < WEEK_MS);
  if (recent.length >= PROACTIVE_MAX_PER_WEEK) return false;

  return true;
}

/** Record that the popup actually appeared, on this surface. */
export function rememberProactiveShown(surface: string | null, now: number = Date.now()): void {
  shownThisSession += 1;
  const memory = readMemory();
  const shownAt = [...(memory.shownAt ?? []), now].filter((stamp) => now - stamp < WEEK_MS);
  writeMemory({
    ...memory,
    shownAt,
    shownSurfaces: surface ? { ...(memory.shownSurfaces ?? {}), [surface]: now } : memory.shownSurfaces,
  });
}

export function rememberProactiveDismissed(now: number = Date.now()): void {
  writeMemory({ ...readMemory(), dismissedAt: now });
}

/** Opening the panel quiets the popup for a day. It does not disable it. */
export function rememberPanelOpened(now: number = Date.now()): void {
  writeMemory({ ...readMemory(), openedAt: now });
}

/**
 * Test-only: forget that the popup appeared in THIS session.
 *
 * Separate from clearing the stored memory, because the per-session cap and the
 * per-surface week are different rules and a test needs to exercise one without
 * erasing the other.
 */
export function resetProactiveSession(): void {
  shownThisSession = 0;
}

/** Test-only: clears the popup memory and the session counter. */
export function clearProactiveMemory(): void {
  shownThisSession = 0;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(NEXUS_POPUP_KEY);
    window.localStorage.removeItem(NEXUS_OPTOUT_KEY);
  } catch {
    /* ignore */
  }
}
