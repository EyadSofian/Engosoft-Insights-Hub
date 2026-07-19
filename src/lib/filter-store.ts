import { useSyncExternalStore } from "react";
import type { DatePreset, GlobalFilters } from "./types";

type Listener = () => void;

let state: GlobalFilters = {};
let preset: DatePreset = "meta";
const listeners = new Set<Listener>();

const emit = () => {
  for (const l of listeners) l();
};

const prune = () => {
  for (const k of Object.keys(state) as (keyof GlobalFilters)[]) {
    if (!state[k]) delete state[k];
  }
};

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
    preset = "meta";
    prune();
    emit();
  },

  setPreset(next: DatePreset, metaWindow?: { from: string; to: string }) {
    preset = next;
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const back = (days: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() - (days - 1));
      return iso(d);
    };

    switch (next) {
      case "all":
        // Explicitly opt out of the server's default window.
        state = { ...state, from: undefined, to: undefined, range: "all" };
        break;
      case "meta":
        // Empty dates → server applies the Meta window itself.
        state = { ...state, from: metaWindow?.from, to: metaWindow?.to, range: undefined };
        break;
      case "7d":
        state = { ...state, from: back(7), to: iso(today), range: undefined };
        break;
      case "30d":
        state = { ...state, from: back(30), to: iso(today), range: undefined };
        break;
      case "90d":
        state = { ...state, from: back(90), to: iso(today), range: undefined };
        break;
      case "month": {
        const first = new Date(today.getFullYear(), today.getMonth(), 1);
        state = { ...state, from: iso(first), to: iso(today), range: undefined };
        break;
      }
    }
    prune();
    emit();
  },

  /** Clears dimension filters but keeps the chosen period. */
  resetDimensions() {
    const { from, to, range } = state;
    state = { from, to, range };
    prune();
    emit();
  },

  reset() {
    state = {};
    preset = "meta";
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
  return useSyncExternalStore(
    filterStore.subscribe,
    filterStore.get,
    filterStore.get,
  );
}

export function usePreset(): DatePreset {
  return useSyncExternalStore(
    filterStore.subscribe,
    filterStore.getPreset,
    filterStore.getPreset,
  );
}

/** Count of active dimension filters, for the mobile "Filters" badge. */
export function activeDimensionCount(f: GlobalFilters): number {
  return (["account", "campaign", "source", "mainCategory", "salesTeam"] as const).filter(
    (k) => !!f[k],
  ).length;
}

export function buildQuery(f: GlobalFilters): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) params.set(k, String(v));
  const s = params.toString();
  return s ? `?${s}` : "";
}
