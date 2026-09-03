import type { AuditRow, CatalogEntry, CatalogPrice } from "./pricing-ui";

/**
 * Reading a course's published prices into the shape the list row draws.
 *
 * Every function *defined* here is a projection of what the API already
 * returned. None of them decides a price, a floor or a verdict — those live in
 * `@/lib/pricing/price-advice`, the one module the server calls to answer
 * `/api/prices/advice` and these pages call to draw the same numbers. The
 * re-exports below are that module, kept under this name so a component asks
 * for a band where it always did.
 *
 * `bandFor` used to be defined here, which made the browser a second author of
 * the floor the audit judges against — exactly the duplication the paragraph
 * above forbids.
 */

export {
  activeOffers,
  bandFor,
  bandForRoute,
  cashBand,
  egyptBand,
  entryKey,
  instalmentBand,
  isNegotiable,
  suggest,
  today,
  verdictFor,
  CASH_METHODS,
  EGYPT_METHODS,
  INSTALMENT_METHODS,
} from "@/lib/pricing/price-advice";

export type {
  Advice,
  CustomerState,
  Market,
  PaymentChoice,
  PriceBand,
  PriceMode,
  ReasonCode,
  Verdict,
} from "@/lib/pricing/price-advice";

export const hasPackage = (entry: CatalogEntry): boolean =>
  entry.prices.some(
    (price) =>
      price.scope === "bundle" || price.scope === "level" || Boolean(price.bundleName?.trim()),
  );

export const hasIndividual = (entry: CatalogEntry): boolean =>
  entry.prices.some((price) => price.scope === "individual");

export const bundleNameOf = (entry: CatalogEntry): string =>
  entry.prices.find(
    (price) => (price.scope === "bundle" || price.scope === "level") && price.bundleName,
  )?.bundleName ?? "";

export const incentiveRules = (entry: CatalogEntry): CatalogPrice[] =>
  entry.prices.filter((price) => price.active && price.scope === "incentive");

/**
 * How each course actually sold in the period, taken from the audit rows the
 * compliance endpoint already returns for the same window.
 *
 * Keyed by product code because that is the only identifier an audit row and a
 * price-book entry are guaranteed to share — an audit row carries no delivery
 * type, so a code with an online and a recorded variant reports their breaches
 * together. That is stated on the row rather than silently split, because
 * splitting it would mean guessing.
 */
export interface CourseBreachSummary {
  breaches: number;
  /** The lowest unit price invoiced below the floor. */
  worstSold: number;
  floorAtWorst: number | null;
  currency: string;
  leakage: number;
}

export function summarizeBreaches(rows: AuditRow[]): Map<string, CourseBreachSummary> {
  const out = new Map<string, CourseBreachSummary>();
  for (const row of rows) {
    if (row.complianceStatus !== "below_minimum") continue;
    const code = row.productCode?.trim();
    if (!code) continue;
    const current = out.get(code);
    if (!current) {
      out.set(code, {
        breaches: 1,
        worstSold: row.actualUnitPrice,
        floorAtWorst: row.allowedMinimum,
        currency: row.currency,
        leakage: row.leakageAmount,
      });
      continue;
    }
    current.breaches += 1;
    current.leakage += row.leakageAmount;
    if (row.actualUnitPrice < current.worstSold) {
      current.worstSold = row.actualUnitPrice;
      current.floorAtWorst = row.allowedMinimum;
      current.currency = row.currency;
    }
  }
  return out;
}

/**
 * The date the row can honestly show.
 *
 * The catalog carries no per-price modification timestamp, so "last updated" is
 * the day the newest rule covering this course came into force, and the price
 * book's own effective date when no rule names one. Labelled "in force since"
 * rather than "last updated" for that reason.
 */
export function inForceSince(entry: CatalogEntry, bookEffectiveFrom: string): string {
  const dates = entry.prices
    .filter((price) => price.active && price.validFrom)
    .map((price) => price.validFrom)
    .sort();
  return dates[dates.length - 1] || bookEffectiveFrom || "";
}
