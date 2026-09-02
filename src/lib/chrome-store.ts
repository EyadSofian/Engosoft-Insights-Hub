import { useCallback, useEffect, useSyncExternalStore } from "react";
import { chromeScrollDecision, CHROME_TOP_ZONE } from "./chrome-policy";
import { uiStore } from "./ui-store";

/**
 * The single controller for the application chrome — top bar and navigation
 * rail — as the page scrolls.
 *
 * One store rather than a hook per component on purpose: the header, the rail,
 * the local tab bar and the edge trigger all have to agree on the same frame,
 * and four independent scroll listeners would drift apart under fast scrolling
 * and each pay their own rAF.
 *
 * Nothing here reads layout. `scrollY` is the only measurement taken, it is
 * taken inside `requestAnimationFrame`, and no style is written before it — so
 * the loop can never force a synchronous reflow while a dense table is on
 * screen. The state it publishes is consumed as `transform` and `opacity`
 * only; the one property that affects layout, the content inset, is written
 * once per state change as a CSS custom property rather than per scroll event.
 */

export type HeaderMode = "full" | "compact" | "hidden";

export interface ChromeState {
  /** How much of the top bar is showing. */
  header: HeaderMode;
  /** True when the desktop rail has slid off the inline edge. */
  navHidden: boolean;
  /** The rail is temporarily out because of the edge trigger or focus. */
  peeking: boolean;
  /** The reader has switched auto-hide off; nothing moves on scroll. */
  pinned: boolean;
}

/**
 * Where the reader's auto-hide choice lives between visits.
 *
 * Someone who works in this dashboard all day and dislikes moving chrome should
 * have to say so exactly once, so the preference outlives the session rather
 * than the page.
 */
const PIN_KEY = "engo_chrome_pinned";

let state: ChromeState = { header: "full", navHidden: false, peeking: false, pinned: false };
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

function set(next: Partial<ChromeState>) {
  const merged = { ...state, ...next };
  if (
    merged.header === state.header &&
    merged.navHidden === state.navHidden &&
    merged.peeking === state.peeking &&
    merged.pinned === state.pinned
  ) {
    return;
  }
  state = merged;
  emit();
}

/* --- freeze conditions ----------------------------------------------------
   Three things must stop the chrome moving under the reader: an open sheet or
   dialog, an open Radix popper (the filter menu, a tooltip, the column
   chooser — all of which are anchored to a control in the bar itself), and a
   keyboard user whose focus is currently inside the chrome. Hiding in any of
   those cases either drags the anchor out from under an open menu or scrolls
   the focused control off screen.
------------------------------------------------------------------------- */

let focusInChrome = false;
let keyboardNavigation = false;

function popperOpen(): boolean {
  if (typeof document === "undefined") return false;
  return (
    document.querySelector("[data-radix-popper-content-wrapper]") !== null ||
    document.body.hasAttribute("data-scroll-locked")
  );
}

const frozen = () => state.pinned || focusInChrome || uiStore.isOpen() || popperOpen();

/* --- the scroll loop ---------------------------------------------------- */

let ticking = false;
let started = false;

function evaluate() {
  ticking = false;
  const decision = chromeScrollDecision(window.scrollY);

  if (decision === "reveal") {
    set({ header: "full", navHidden: false });
    return;
  }

  if (frozen()) return;
  if (decision === "hide") {
    set({ header: "hidden", navHidden: true, peeking: false });
  }
}

function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(evaluate);
}

/**
 * A background tab never runs `requestAnimationFrame`, so a scroll that lands
 * while the page is hidden leaves the throttle latched. Releasing it on the
 * way back means the first scroll after the reader returns is acted on rather
 * than swallowed.
 */
function onVisibility() {
  if (document.visibilityState !== "visible") return;
  ticking = false;
}

function onFocusIn(event: FocusEvent) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const inside = keyboardNavigation && target.closest("[data-app-chrome]") !== null;
  if (inside === focusInChrome) return;
  focusInChrome = inside;
  // Reaching the chrome with the keyboard must show it, not merely stop it
  // from hiding further.
  if (inside)
    set({ header: state.header === "hidden" ? "compact" : state.header, navHidden: false });
}

function onFocusOut() {
  requestAnimationFrame(() => {
    const active = document.activeElement;
    focusInChrome =
      keyboardNavigation &&
      active instanceof HTMLElement &&
      active.closest("[data-app-chrome]") !== null;
  });
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === "Tab") keyboardNavigation = true;
}

function onPointerDown() {
  // A mouse/touch click may leave a toolbar button focused while the reader
  // scrolls. Only keyboard focus should hold the chrome open.
  keyboardNavigation = false;
  focusInChrome = false;
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("pointerdown", onPointerDown, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  // A route change resets the reader's context; the chrome comes back with it.
  window.addEventListener("engosoft:chrome-reveal", reveal);
}

function stop() {
  if (!started) return;
  started = false;
  window.removeEventListener("scroll", onScroll);
  document.removeEventListener("focusin", onFocusIn);
  document.removeEventListener("focusout", onFocusOut);
  document.removeEventListener("keydown", onKeyDown);
  document.removeEventListener("pointerdown", onPointerDown);
  document.removeEventListener("visibilitychange", onVisibility);
  window.removeEventListener("engosoft:chrome-reveal", reveal);
}

function reveal() {
  set({ header: window.scrollY <= CHROME_TOP_ZONE ? "full" : "compact", navHidden: false });
}

export const chromeStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    if (listeners.size === 1) start();
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) stop();
    };
  },
  get: () => state,
  reveal,
  setPeeking(peeking: boolean) {
    if (state.pinned) return;
    set({ peeking });
  },
  setPinned(pinned: boolean) {
    try {
      window.localStorage.setItem(PIN_KEY, pinned ? "1" : "0");
    } catch {
      // Private mode: the choice simply does not survive the session.
    }
    set(
      pinned
        ? {
            pinned,
            header: window.scrollY <= CHROME_TOP_ZONE ? "full" : "compact",
            navHidden: false,
            peeking: false,
          }
        : { pinned },
    );
  },
  togglePinned() {
    chromeStore.setPinned(!state.pinned);
  },
  /** Adopts the stored choice once the client is running. */
  hydrate() {
    let stored = false;
    try {
      stored = window.localStorage.getItem(PIN_KEY) === "1";
    } catch {
      stored = false;
    }
    // Only ever turns the preference *on* during hydration: the server rendered
    // an unpinned shell, and writing `false` here would be a no-op that still
    // costs a render on every mount.
    if (stored && !state.pinned) chromeStore.setPinned(true);
  },
};

// The server has no scroll position; every client starts whole and the first
// real frame corrects it, so hydration never disagrees with the markup.
const serverState: ChromeState = {
  header: "full",
  navHidden: false,
  peeking: false,
  pinned: false,
};

export function useChrome(): ChromeState {
  return useSyncExternalStore(chromeStore.subscribe, chromeStore.get, () => serverState);
}

/**
 * Mounted once, by the shell. Adopts the stored pin preference, binds the
 * keyboard shortcut, and keeps `--chrome-nav-inset` in step with the rail so
 * the content column widens as the rail leaves.
 */
export function useAutoHideChrome() {
  const chrome = useChrome();
  const railOut = chrome.navHidden && !chrome.peeking && !chrome.pinned;

  useEffect(() => {
    chromeStore.hydrate();
  }, []);

  // ⌘/Ctrl + B, the shortcut every editor and every side-panel app already
  // uses for this. Chrome and Safari leave it unbound on a page, so taking it
  // costs the reader nothing they had.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "b") return;
      event.preventDefault();
      chromeStore.togglePinned();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--chrome-nav-inset", railOut ? "0px" : "var(--sidebar-w)");
  }, [railOut]);

  return chrome;
}

/** Bring the chrome back from anywhere — a route change, a dialog closing. */
export function useRevealChrome() {
  return useCallback(() => chromeStore.reveal(), []);
}
