import { useCallback, useEffect, useSyncExternalStore } from "react";
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
  /** The reader has pinned the chrome open; nothing auto-hides. */
  pinned: boolean;
  /** The rail is temporarily out because of the edge trigger or focus. */
  peeking: boolean;
}

const PIN_KEY = "engo_chrome_pinned";

/** Below this the page is "at the top" and the chrome is always whole. */
const TOP_ZONE = 64;
/** Nothing hides before the reader has actually committed to scrolling. */
const HIDE_AFTER = 180;
/**
 * Accumulated travel in one direction before the chrome reacts. Trackpad
 * scrolling reverses sign constantly; without this the header flickers on
 * every rubber-band and every one-pixel correction.
 */
const HYSTERESIS = 28;

let state: ChromeState = { header: "full", navHidden: false, pinned: false, peeking: false };
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

function set(next: Partial<ChromeState>) {
  const merged = { ...state, ...next };
  if (
    merged.header === state.header &&
    merged.navHidden === state.navHidden &&
    merged.pinned === state.pinned &&
    merged.peeking === state.peeking
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

function popperOpen(): boolean {
  if (typeof document === "undefined") return false;
  return (
    document.querySelector("[data-radix-popper-content-wrapper]") !== null ||
    document.body.hasAttribute("data-scroll-locked")
  );
}

const frozen = () => state.pinned || focusInChrome || uiStore.isOpen() || popperOpen();

/* --- the scroll loop ---------------------------------------------------- */

let lastY = 0;
let travel = 0;
let ticking = false;
let started = false;

let ticks = 0;
function evaluate() {
  ticks += 1;
  ticking = false;
  const y = window.scrollY;
  const delta = y - lastY;
  lastY = y;

  if (y <= TOP_ZONE) {
    travel = 0;
    set({ header: "full", navHidden: false });
    return;
  }

  if (frozen()) return;

  // Reset the accumulator whenever the direction flips, so travel always
  // measures one continuous gesture rather than a net displacement.
  if ((delta > 0 && travel < 0) || (delta < 0 && travel > 0)) travel = 0;
  travel += delta;

  if (travel > HYSTERESIS && y > HIDE_AFTER) {
    travel = 0;
    set({ header: "hidden", navHidden: true, peeking: false });
  } else if (travel < -HYSTERESIS) {
    travel = 0;
    // Coming back up reveals the compact bar first: the reader asked for
    // orientation, not for the whole control surface back.
    set({ header: "compact", navHidden: false });
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
  lastY = window.scrollY;
  travel = 0;
}

function onFocusIn(event: FocusEvent) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const inside = target.closest("[data-app-chrome]") !== null;
  if (inside === focusInChrome) return;
  focusInChrome = inside;
  // Reaching the chrome with the keyboard must show it, not merely stop it
  // from hiding further.
  if (inside)
    set({ header: state.header === "hidden" ? "compact" : state.header, navHidden: false });
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  lastY = window.scrollY;
  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("visibilitychange", onVisibility);
  // A route change resets the reader's context; the chrome comes back with it.
  window.addEventListener("engosoft:chrome-reveal", reveal);
}

function stop() {
  if (!started) return;
  started = false;
  window.removeEventListener("scroll", onScroll);
  document.removeEventListener("focusin", onFocusIn);
  document.removeEventListener("visibilitychange", onVisibility);
  window.removeEventListener("engosoft:chrome-reveal", reveal);
}

function reveal() {
  travel = 0;
  set({ header: window.scrollY <= TOP_ZONE ? "full" : "compact", navHidden: false });
}

function readPinned(): boolean {
  try {
    return window.localStorage.getItem(PIN_KEY) === "1";
  } catch {
    return false;
  }
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
      // Private mode; the preference simply does not survive the session.
    }
    travel = 0;
    set(
      pinned
        ? { pinned, header: window.scrollY <= TOP_ZONE ? "full" : "compact", navHidden: false }
        : { pinned },
    );
  },
  togglePinned() {
    chromeStore.setPinned(!state.pinned);
  },
  debug: () => ({
    ticks,
    started,
    listeners: listeners.size,
    lastY,
    travel,
    frozen: frozen(),
    modal: uiStore.isOpen(),
    focusInChrome,
  }),
  debugTick: () => {
    ticking = false;
    evaluate();
  },
  /** Called once on mount to adopt the stored preference. */
  hydrate() {
    const pinned = readPinned();
    if (pinned !== state.pinned) set({ pinned });
  },
};

// The server has no scroll position; every client starts whole and the first
// real frame corrects it, so hydration never disagrees with the markup.
const serverState: ChromeState = {
  header: "full",
  navHidden: false,
  pinned: false,
  peeking: false,
};

// __QA_DEBUG__
if (typeof window !== "undefined")
  (window as unknown as Record<string, unknown>).__chrome = chromeStore;

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
