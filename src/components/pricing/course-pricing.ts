import type { AuditRow, CatalogEntry, CatalogPrice } from "./pricing-ui";

/**
 * Reading a course's published prices into the shape the list row draws.
 *
 * Every function here is a projection of what the API already returned. None of
 * them decides a price, a floor or a verdict — those come from the pricing
 * engine on the server, and duplicating any of that judgement in the browser is
 * how a screen ends up disagreeing with the audit it is reporting on.
 */

export type PriceMode = "course" | "package";

export interface PriceBand {
  floor: number | null;
  ceiling: number | null;
  currency: string;
  /** A single published number rather than a range. */
  fixed: boolean;
  requiresReview: boolean;
}

const CASH_METHODS = ["cash", "cashier"];
const INSTALMENT_METHODS = ["tabby", "tamara"];
/** The workbook's Egyptian column is published without a method split. */
const EGYPT_METHODS = ["any", "cash", "cashier"];

export const today = (): string => new Date().toISOString().slice(0, 10);

const liveOn = (price: CatalogPrice, day: string) =>
  (!price.validFrom || price.validFrom <= day) && (!price.validTo || price.validTo >= day);

export const activeOffers = (entry: CatalogEntry, day = today()): CatalogPrice[] =>
  entry.prices.filter((price) => price.active && price.scope === "offer" && liveOn(price, day));

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
 * The band a seller may quote for one payment route.
 *
 * Several rules can apply to the same route — one per instrument, sometimes one
 * per country. The floor is the lowest floor any of them publishes and the
 * ceiling the highest ceiling, which is exactly the range a sale is judged
 * against; narrowing it here would invent breaches the audit does not see.
 */
export function bandFor(
  entry: CatalogEntry,
  methods: string[],
  currency: string,
  mode: PriceMode = "course",
): PriceBand | undefined {
  const scopes = mode === "package" ? ["bundle", "level"] : ["individual"];
  const rules = entry.prices.filter(
    (price) =>
      price.active &&
      price.currency === currency &&
      scopes.includes(price.scope) &&
      (methods.includes(price.paymentMethod) ||
        (price.paymentMethod === "any" && methods.includes("any"))),
  );
  if (!rules.length) return undefined;

  const floors = rules
    .map((price) => price.minimum ?? price.exact ?? price.maximum)
    .filter((value): value is number => value !== null);
  const ceilings = rules
    .map((price) => price.maximum ?? price.exact ?? price.minimum)
    .filter((value): value is number => value !== null);
  if (!floors.length || !ceilings.length) return undefined;

  const floor = Math.min(...floors);
  const ceiling = Math.max(...ceilings);
  return {
    floor,
    ceiling,
    currency,
    fixed: floor === ceiling,
    requiresReview: rules.some((price) => price.requiresReview),
  };
}

export const cashBand = (entry: CatalogEntry, mode?: PriceMode) =>
  bandFor(entry, CASH_METHODS, "SAR", mode);
export const instalmentBand = (entry: CatalogEntry, mode?: PriceMode) =>
  bandFor(entry, INSTALMENT_METHODS, "SAR", mode);
export const egyptBand = (entry: CatalogEntry, mode?: PriceMode) =>
  bandFor(entry, EGYPT_METHODS, "EGP", mode);

/** A course somebody can negotiate on at all: its band has room in it. */
export const isNegotiable = (entry: CatalogEntry): boolean => {
  const cash = cashBand(entry);
  const instalment = instalmentBand(entry);
  return Boolean((cash && !cash.fixed) || (instalment && !instalment.fixed));
};

/** Stable identity for a catalog entry across renders and lookups. */
export const entryKey = (entry: CatalogEntry): string =>
  `${entry.code}:${entry.deliveryType}:${entry.subcategory}:${entry.level}`;

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
