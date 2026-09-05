import { useEffect } from "react";

/**
 * Where the user is, down to the element they are looking at.
 *
 * A pathname says which page. It does not say which tab is open, which section
 * the user is scrolling, which course they selected, or which KPI they just
 * clicked — and those are exactly what "الرقم ده" and "التاب دي" refer to.
 *
 * The application writes here; the panel reads it. Deliberately a plain module
 * store rather than React context: the pages that register are scattered across
 * routes, and threading a provider through all of them to publish four strings
 * would be more machinery than the problem deserves.
 *
 * IDS AND STATE ONLY. No datasets, no table rows, no figures — a chat message
 * carries the identity of what is on screen, and the values are fetched when a
 * question is actually asked.
 */
export interface NexusViewContext {
  surface: string | null;
  tab: string | null;
  section: string | null;
  focusedElementId: string | null;
  selectedEntity: { type: string; id?: string; name?: string } | null;
}

const EMPTY: NexusViewContext = {
  surface: null,
  tab: null,
  section: null,
  focusedElementId: null,
  selectedEntity: null,
};

let current: NexusViewContext = { ...EMPTY };
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

export const getNexusView = (): NexusViewContext => current;

export function subscribeNexusView(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Merge a partial update. Pages set only what they know. */
export function updateNexusView(patch: Partial<NexusViewContext>): void {
  const next = { ...current, ...patch };
  const changed = (Object.keys(next) as Array<keyof NexusViewContext>).some(
    (key) => JSON.stringify(next[key]) !== JSON.stringify(current[key]),
  );
  if (!changed) return;
  current = next;
  emit();
}

/**
 * Clear what a leaving page owned.
 *
 * Navigating away must not leave the previous page's tab and selection behind —
 * "حلل الصفحة دي" on Courses would otherwise resolve against Website.
 */
export function clearNexusView(): void {
  current = { ...EMPTY };
  emit();
}

/**
 * Register a page's surface and tab for as long as it is mounted.
 *
 * The tab is a dependency, so switching tabs updates the context on the same
 * render — which is what makes "اشرح التاب دي" answerable.
 */
export function useRegisterNexusView(
  surface: string,
  options: { tab?: string | null; section?: string | null } = {},
): void {
  const { tab = null, section = null } = options;
  useEffect(() => {
    updateNexusView({ surface, tab, section });
    return () => clearNexusView();
  }, [surface, tab, section]);
}

/** Declare the entity a page has selected — a course, a campaign, a team. */
export function useRegisterNexusEntity(entity: NexusViewContext["selectedEntity"]): void {
  const serialised = JSON.stringify(entity ?? null);
  useEffect(() => {
    updateNexusView({ selectedEntity: entity ?? null });
  }, [serialised]);
}
