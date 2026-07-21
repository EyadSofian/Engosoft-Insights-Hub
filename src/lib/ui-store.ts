import { useEffect } from "react";
import { useSyncExternalStore } from "react";

/**
 * Tiny global "is any modal/sheet open" signal. Full-screen sheets (filters,
 * date picker, mobile "More") register while open so chrome that floats above
 * the page — chiefly the AI FAB — can get out of the way instead of covering
 * the sheet. A counter, not a boolean, so overlapping sheets don't clear it
 * early.
 */
let modalCount = 0;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

export const uiStore = {
  push() {
    modalCount += 1;
    emit();
  },
  pop() {
    modalCount = Math.max(0, modalCount - 1);
    emit();
  },
  isOpen: () => modalCount > 0,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function useAnyModalOpen(): boolean {
  return useSyncExternalStore(uiStore.subscribe, uiStore.isOpen, () => false);
}

/** Register a modal as open for the lifetime of `open` being true. */
export function useModalGuard(open: boolean) {
  useEffect(() => {
    if (!open) return;
    uiStore.push();
    return () => uiStore.pop();
  }, [open]);
}
