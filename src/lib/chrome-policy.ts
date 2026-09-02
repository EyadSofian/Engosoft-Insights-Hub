/**
 * Scroll-position policy for the desktop chrome.
 *
 * The middle state is deliberately "keep": once the reader has scrolled far
 * enough to hide the header and sidebar, reversing the wheel/trackpad must not
 * bring them back over the data. They return only inside the top zone (or by
 * the explicit navigation button/pin controls).
 */
export type ChromeScrollDecision = "reveal" | "hide" | "keep";

export const CHROME_TOP_ZONE = 64;
export const CHROME_HIDE_AFTER = 180;

export function chromeScrollDecision(scrollY: number): ChromeScrollDecision {
  if (scrollY <= CHROME_TOP_ZONE) return "reveal";
  if (scrollY > CHROME_HIDE_AFTER) return "hide";
  return "keep";
}
