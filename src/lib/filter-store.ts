import { useSyncExternalStore } from "react";
import type { DatePreset, GlobalFilters } from "./types";

type Listener = () => void;

/** Dimensions that count toward the "N filters active" badge. */
const DIMENSIONS = [
  "platform",
  "account",
  "campaign",
  "adset",
  "ad",
  "source",
  "course",
  "mainCategory",
  "salesTeam",
  "salesperson",
] as const;

let state: GlobalFilters = {};
/** Year to date. Ad spend now covers the whole year, so this is the honest default. */
let preset: DatePreset = "year";
const listeners = new Set<Listener>();

const emit = () => {
  for (const l of listeners) l();
};

const prune = () => {
  for (const k of Object.keys(state) as (keyof GlobalFilters)[]) {
    if (!state[k]) delete state[k];
  }
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The from/to window a named preset resolves to. Anchored to `latest` (the
 * newest date present in the sheet) rather than the browser clock, so a stale
 * sheet can't produce an empty "last 7 days". Exported so the date picker can
 * tell which preset — if any — the current range corresponds to.
 */
export function presetWindow(
  next: DatePreset,
  latest?: string,
): { from?: string; to?: string; range?: "all" } {
  const anchor = latest ? new Date(latest + "T00:00:00Z") : new Date();
  const back = (days: number) => {
    const d = new Date(anchor);
    d.setUTCDate(d.getUTCDate() - (days - 1));
    return iso(d);
  };

  switch (next) {
    case "all":
      // Explicitly opt out of the server's default window.
      return { from: undefined, to: undefined, range: "all" };
    case "7d":
      return { from: back(7), to: iso(anchor) };
    case "30d":
      return { from: back(30), to: iso(anchor) };
    case "month": {
      const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
      return { from: iso(first), to: iso(anchor) };
    }
    case "year": {
      const first = new Date(Date.UTC(anchor.getUTCFullYear(), 0, 1));
      return { from: iso(first), to: iso(anchor) };
    }
  }
}

export const filterStore = {
  get: (): GlobalFilters => state,
  getPreset: (): DatePreset => preset,

  set(patch: Partial<GlobalFilters>) {
    state = { ...state, ...patch };
    prune();
    emit();
  },

  /** Manual date edits fall out of any named preset. */
  setDates(from?: string, to?: string) {
    state = { ...state, from, to };
    delete state.range;
    prune();
    emit();
  },

  /**
   * `latest` is the newest date present in the sheet. Presets anchor to it
   * rather than to the browser clock, so a stale sheet can't produce an empty
   * "last 7 days" window.
   */
  setPreset(next: DatePreset, latest?: string) {
    preset = next;
    const w = presetWindow(next, latest);
    state = { ...state, from: w.from, to: w.to, range: w.range };
    prune();
    emit();
  },

  /** Clears dimension filters but keeps the chosen period and metric options. */
  resetDimensions() {
    const { from, to, range, includeNonLead, cpaBasis } = state;
    state = { from, to, range, includeNonLead, cpaBasis };
    prune();
    emit();
  },

  reset() {
    state = {};
    preset = "year";
    emit();
  },

  subscribe(l: Listener) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function useFilters(): GlobalFilters {
  return useSyncExternalStore(filterStore.subscribe, filterStore.get, filterStore.get);
}

export function usePreset(): DatePreset {
  return useSyncExternalStore(filterStore.subscribe, filterStore.getPreset, filterStore.getPreset);
}

export function activeDimensionCount(f: GlobalFilters): number {
  return DIMENSIONS.filter((k) => !!f[k]).length;
}

export function buildQuery(f: GlobalFilters): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) params.set(k, String(v));
  const s = params.toString();
  return s ? `?${s}` : "";
}
