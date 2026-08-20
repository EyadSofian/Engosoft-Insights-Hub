import { useSyncExternalStore } from "react";
import type { PerfRow } from "@/lib/types";

/**
 * Dismissal memory for the at-risk campaign alert.
 *
 * The alert costs money when it is missed, so it comes back on every page load
 * and on every visit to the overview — closing it is deliberately temporary.
 * Silencing it for longer is possible, but only as an explicit choice, and
 * never blindly: both longer options remember *which* campaigns were on screen,
 * so a campaign that turns risky later still breaks through.
 *
 *   close (X / Esc / backdrop) → nothing stored, back on the next load
 *   action taken               → hide that campaign for seven days
 *   snooze                     → quiet until local midnight
 *   mute                       → those exact campaigns never alert again
 *
 * Stored in localStorage (not sessionStorage) so "don't show again" survives a
 * refresh, a new tab, and a browser restart.
 */
const STORAGE_KEY = "engosoft-campaign-risk-alert";

export interface RiskAlertPrefs {
  /** Campaign row keys the user silenced for good. */
  mutedKeys: string[];
  /** Epoch ms the snooze runs until; 0 when not snoozed. */
  snoozeUntil: number;
  /** Campaigns visible when the snooze started — anything new ignores it. */
  snoozedKeys: string[];
  /** Campaign-specific action memory. Expired entries stop suppressing alerts. */
  reviewedUntil: Record<string, number>;
  /** Bumped by restore() so an already-closed popup can reopen. Not persisted. */
  restoredAt: number;
}

const EMPTY: RiskAlertPrefs = {
  mutedKeys: [],
  snoozeUntil: 0,
  snoozedKeys: [],
  reviewedUntil: {},
  restoredAt: 0,
};

let cache: RiskAlertPrefs | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

const toKeys = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const toReviewMap = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] > Date.now(),
    ),
  );
};

function readStorage(): RiskAlertPrefs {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      mutedKeys: toKeys(parsed.mutedKeys),
      snoozeUntil: typeof parsed.snoozeUntil === "number" ? parsed.snoozeUntil : 0,
      snoozedKeys: toKeys(parsed.snoozedKeys),
      reviewedUntil: toReviewMap(parsed.reviewedUntil),
      restoredAt: 0,
    };
  } catch {
    return EMPTY;
  }
}

function commit(next: RiskAlertPrefs) {
  const reviewedUntil = Object.fromEntries(
    Object.entries(next.reviewedUntil).filter(([, until]) => until > Date.now()),
  );
  cache = { ...next, reviewedUntil };
  if (typeof window !== "undefined") {
    try {
      if (!next.mutedKeys.length && !next.snoozeUntil && !Object.keys(reviewedUntil).length) {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            mutedKeys: cache.mutedKeys,
            snoozeUntil: cache.snoozeUntil,
            snoozedKeys: cache.snoozedKeys,
            reviewedUntil,
          }),
        );
      }
    } catch {
      // Private mode / blocked storage: the choice still holds for this page view.
    }
  }
  emit();
}

/** Midnight tonight in the viewer's own timezone — "remind me tomorrow". */
export function nextLocalMidnight(from: Date = new Date()): number {
  const midnight = new Date(from);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime();
}

export const riskAlertPrefs = {
  get(): RiskAlertPrefs {
    cache ??= readStorage();
    return cache;
  },
  getServerSnapshot: (): RiskAlertPrefs => EMPTY,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Quiet until local midnight for the campaigns currently on screen. */
  snooze(keys: string[]) {
    const current = riskAlertPrefs.get();
    commit({ ...current, snoozeUntil: nextLocalMidnight(), snoozedKeys: [...keys] });
  },
  /** Never alert for these campaigns again. */
  mute(keys: string[]) {
    const current = riskAlertPrefs.get();
    commit({
      ...current,
      mutedKeys: [...new Set([...current.mutedKeys, ...keys])],
      snoozeUntil: 0,
      snoozedKeys: [],
    });
  },
  /** Record that action was taken; re-check the campaign after seven days. */
  review(keys: string[], now = Date.now()) {
    const current = riskAlertPrefs.get();
    const until = now + 7 * 24 * 60 * 60 * 1000;
    commit({
      ...current,
      reviewedUntil: {
        ...current.reviewedUntil,
        ...Object.fromEntries(keys.map((key) => [key, until])),
      },
      snoozeUntil: 0,
      snoozedKeys: [],
    });
  },
  /** Undo every mute and snooze, and reopen the alert. */
  restore() {
    commit({ ...EMPTY, restoredAt: Date.now() });
  },
};

if (typeof window !== "undefined") {
  // Keep tabs in sync: muting in one window shouldn't leave another nagging.
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    cache = readStorage();
    emit();
  });
}

/** At-risk campaigns the user has not muted. */
export function pendingRiskRows(
  rows: PerfRow[],
  prefs: RiskAlertPrefs,
  now = Date.now(),
): PerfRow[] {
  const muted = new Set(prefs.mutedKeys);
  return rows.filter((row) => !muted.has(row.key) && (prefs.reviewedUntil[row.key] ?? 0) <= now);
}

/** Muted campaigns that are still burning money right now. */
export function mutedRiskCount(rows: PerfRow[], prefs: RiskAlertPrefs): number {
  if (!prefs.mutedKeys.length) return 0;
  const muted = new Set(prefs.mutedKeys);
  return rows.reduce((total, row) => total + (muted.has(row.key) ? 1 : 0), 0);
}

/** Campaigns hidden because they were muted or an action was recently recorded. */
export function suppressedRiskCount(
  rows: PerfRow[],
  prefs: RiskAlertPrefs,
  now = Date.now(),
): number {
  const pending = new Set(pendingRiskRows(rows, prefs, now).map((row) => row.key));
  return rows.reduce((total, row) => total + (pending.has(row.key) ? 0 : 1), 0);
}

export function shouldShowRiskAlert(
  pending: PerfRow[],
  prefs: RiskAlertPrefs,
  now: number = Date.now(),
): boolean {
  if (!pending.length) return false;
  if (now >= prefs.snoozeUntil) return true;
  // Snoozed — but a campaign that wasn't part of that decision still alerts.
  const snoozed = new Set(prefs.snoozedKeys);
  return pending.some((row) => !snoozed.has(row.key));
}

export function useRiskAlertPrefs(): RiskAlertPrefs {
  return useSyncExternalStore(
    riskAlertPrefs.subscribe,
    riskAlertPrefs.get,
    riskAlertPrefs.getServerSnapshot,
  );
}
