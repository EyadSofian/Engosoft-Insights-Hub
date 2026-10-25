/**
 * The global header gets out of the way on the way down and comes back on the
 * way up, like a mobile browser's toolbar.
 *
 * Nothing here touches React state. A scroll listener that set state would
 * re-render the whole shell on every frame of a long table; instead one rAF-
 * throttled handler flips a single attribute on <html>, and CSS moves the
 * header (and the strips that park under it) on a composited transform.
 */

/** Pixels of travel in one direction before the header changes its mind. */
export const HEADER_SCROLL_THRESHOLD = 12;

export interface HeaderScrollState {
  hidden: boolean;
  /**
   * Where the current run started: the lowest point reached while shown, the
   * highest while hidden. Measuring travel from here rather than from the last
   * frame is what stops a trembling thumb from toggling the header.
   */
  anchorY: number;
}

export function nextHeaderState(
  previous: HeaderScrollState,
  scrollY: number,
  {
    topZone,
    pinned,
    threshold = HEADER_SCROLL_THRESHOLD,
  }: {
    /** Near the top the header is always shown — the reserve it leaves is still on screen. */
    topZone: number;
    /** A drawer, modal or header dropdown is open, or the keyboard is in the header. */
    pinned: boolean;
    threshold?: number;
  },
): HeaderScrollState {
  // iOS rubber-banding reports negative offsets at the top.
  const y = Math.max(0, scrollY);
  if (pinned || y <= topZone) return { hidden: false, anchorY: y };
  if (previous.hidden) {
    const anchorY = Math.max(previous.anchorY, y);
    return anchorY - y >= threshold ? { hidden: false, anchorY: y } : { hidden: true, anchorY };
  }
  const anchorY = Math.min(previous.anchorY, y);
  return y - anchorY >= threshold ? { hidden: true, anchorY: y } : { hidden: false, anchorY };
}

const ROOT_ATTRIBUTE = "data-chrome-header";

function keyboardFocusInside(element: HTMLElement): boolean {
  try {
    return element.querySelector(":focus-visible") !== null;
  } catch {
    // Engines without :focus-visible fall back to never pinning on focus.
    return false;
  }
}

/**
 * Binds the behaviour to the header element. Returns the cleanup.
 *
 * The header stays shown while anything that belongs to it is open — the
 * navigation drawer and header dropdowns expose `aria-expanded="true"` on their
 * trigger — while any modal is registered, and while a keyboard user is inside
 * it, so a Tab press into a hidden header brings it back instead of focusing
 * something off screen.
 */
export function attachHeaderAutoHide(
  header: HTMLElement,
  {
    isModalOpen,
    subscribeModal,
  }: {
    isModalOpen: () => boolean;
    subscribeModal: (listener: () => void) => () => void;
  },
): () => void {
  const root = document.documentElement;
  let state: HeaderScrollState = { hidden: false, anchorY: window.scrollY };
  let frame = 0;

  const render = (hidden: boolean) =>
    root.setAttribute(ROOT_ATTRIBUTE, hidden ? "hidden" : "shown");

  const pinned = () =>
    isModalOpen() ||
    header.querySelector('[aria-expanded="true"]') !== null ||
    keyboardFocusInside(header);

  const update = () => {
    frame = 0;
    const next = nextHeaderState(state, window.scrollY, {
      topZone: header.offsetHeight,
      pinned: pinned(),
    });
    if (next.hidden !== state.hidden) render(next.hidden);
    state = next;
  };

  const onScroll = () => {
    if (!frame) frame = window.requestAnimationFrame(update);
  };

  const reveal = () => {
    state = { hidden: false, anchorY: Math.max(0, window.scrollY) };
    render(false);
  };

  const onFocusIn = () => {
    if (state.hidden && keyboardFocusInside(header)) reveal();
  };

  // Menu triggers flip aria-expanded without a scroll: react to that too.
  const observer = new MutationObserver(() => {
    if (state.hidden && pinned()) reveal();
  });

  render(false);
  window.addEventListener("scroll", onScroll, { passive: true });
  header.addEventListener("focusin", onFocusIn);
  observer.observe(header, { attributes: true, subtree: true, attributeFilter: ["aria-expanded"] });
  const unsubscribe = subscribeModal(() => {
    if (state.hidden && isModalOpen()) reveal();
  });

  return () => {
    window.removeEventListener("scroll", onScroll);
    header.removeEventListener("focusin", onFocusIn);
    observer.disconnect();
    unsubscribe();
    if (frame) window.cancelAnimationFrame(frame);
    root.removeAttribute(ROOT_ATTRIBUTE);
  };
}
