/**
 * How many of a thing to show, and in what shape.
 *
 * THE MODEL DOES NOT DECIDE THIS. Layout is a function of item count and
 * nothing else, so the same seventeen campaigns always render the same way and
 * a rewording of the answer can never turn three cards into a wall. Asking the
 * model to "use a carousel when there are a few" produced, over three sprints,
 * a Markdown document with twenty headings in it.
 *
 * Pure module: no React, no DOM — which is what lets the boundaries be tested
 * directly rather than through a rendered tree.
 */

export type PresentationMode = "empty" | "cards" | "carousel" | "table";

/** Cards up to 3, carousel to 8, summary + table beyond. */
export function presentationMode(count: number): PresentationMode {
  if (!Number.isFinite(count) || count <= 0) return "empty";
  if (count <= 3) return "cards";
  if (count <= 8) return "carousel";
  return "table";
}

export const campaignPresentationMode = presentationMode;
export const productPresentationMode = presentationMode;

/**
 * How many to render before the reader has to ask for more.
 *
 * In table mode only the first rows are in the DOM. "Show all" is frontend
 * state — it never calls the model, because sorting and revealing data the
 * page already holds is not a question anyone should pay a round trip for.
 */
export const TABLE_INITIAL_ROWS = 5;
export const TABLE_PAGE_SIZE = 10;
/** Cards shown above the table when the list is long. */
export const TOP_CARDS_IN_TABLE_MODE = 3;

/** What the "show all" control should say, and whether to show one at all. */
export function moreControl(
  count: number,
  visible: number,
  lang: "ar" | "en",
): { show: boolean; label: string; remaining: number } {
  const remaining = Math.max(0, count - visible);
  if (remaining <= 0) return { show: false, label: "", remaining: 0 };
  const next = Math.min(remaining, TABLE_PAGE_SIZE);
  const label =
    lang === "ar"
      ? remaining <= TABLE_PAGE_SIZE
        ? `عرض الكل (${count})`
        : `عرض ${next} أخرى`
      : remaining <= TABLE_PAGE_SIZE
        ? `Show all (${count})`
        : `Show ${next} more`;
  return { show: true, label, remaining };
}

/**
 * Sort keys the reader may apply locally.
 *
 * Re-ordering rows the page already has is not a new business judgement, so it
 * happens here. What "best" MEANS still comes from the backend: the incoming
 * order is the business ranking, and `null` restores it.
 */
export type SortKey = "revenue" | "roas" | "spend" | "won" | null;

export function sortRows<T extends Record<string, unknown>>(rows: readonly T[], key: SortKey): T[] {
  if (!key) return [...rows];
  const value = (row: T): number => {
    const raw = row[key];
    return typeof raw === "number" && Number.isFinite(raw) ? raw : -Infinity;
  };
  return [...rows].sort((a, b) => value(b) - value(a));
}

export type VerdictFilter = "all" | "best" | "worst";

/**
 * Local filters over data already loaded.
 *
 * "Best" and "worst" are slices of the backend's own ranking, not a new
 * definition — the frontend must never invent what a good campaign is.
 */
export function filterRows<T>(rows: readonly T[], filter: VerdictFilter): T[] {
  if (filter === "all" || rows.length <= 3) return [...rows];
  if (filter === "best") return rows.slice(0, 3);
  return rows.slice(-3).reverse();
}
