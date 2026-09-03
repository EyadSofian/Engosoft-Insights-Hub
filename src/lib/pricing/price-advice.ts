// The band a seller may quote, the number to open at, and whether that number
// is allowed. The pricing rule itself — not a rendering of it.
//
// All of this used to live in the browser: `bandFor` in the advisor tab's
// sibling file, `suggest` and the verdict table inside the tab component. That
// meant the figure a salesperson is told and the figure the audit later judges
// them by were produced by two copies of the same arithmetic, in two files, with
// nothing keeping them equal. `course-pricing.ts` already stated the invariant
// this restores, in its own header: nothing in the browser decides a price, a
// floor or a verdict.
//
// Deliberately free of every server import — no database, no `node:` builtin, no
// React — so one module answers `/api/prices/advice` and draws the advisor tab.

export type Market = "sa" | "eg";
export type PaymentChoice = "instalment" | "cash";
export type CustomerState = "standard" | "discount" | "approved_floor";
export type Verdict = "safe" | "needs_approval" | "not_allowed" | "above_list";
export type PriceMode = "course" | "package";

/**
 * Why the suggested number is what it is, as codes rather than sentences.
 *
 * The advisor tab and a consuming app each write their own prose in their own
 * languages; what must not differ between them is *which* reasons apply.
 */
export type ReasonCode =
  | "list_price"
  | "fixed_price"
  | "stepped_down_for_discount"
  | "approved_exception_floor"
  | "opens_at_list";

/* --- the shapes this module reads ------------------------------------------ */
// Structural subsets, satisfied by both `CatalogEntry` definitions that already
// exist (the server's in `compliance.server.ts`, the browser's in `pricing-ui`).
// Declaring the subset here rather than importing either one is what keeps this
// module loadable from `scripts/` under `--experimental-strip-types`.

export interface PricedRule {
  id: string;
  scope: string;
  bundleName: string;
  paymentMethod: string;
  currency: string;
  exact: number | null;
  minimum: number | null;
  maximum: number | null;
  validFrom: string;
  validTo: string;
  active: boolean;
  requiresReview: boolean;
  note: string;
}

export interface PricedEntry {
  code: string;
  courseName: string;
  deliveryType: string;
  subcategory: string;
  level: string;
  onHold: boolean;
  prices: PricedRule[];
}

export interface PriceBand {
  floor: number | null;
  ceiling: number | null;
  currency: string;
  /** A single published number rather than a range. */
  fixed: boolean;
  requiresReview: boolean;
}

/* --- payment routes -------------------------------------------------------- */

export const CASH_METHODS = ["cash", "cashier"];
export const INSTALMENT_METHODS = ["tabby", "tamara"];
/** The workbook's Egyptian column is published without a method split. */
export const EGYPT_METHODS = ["any", "cash", "cashier"];

export const currencyFor = (market: Market): string => (market === "eg" ? "EGP" : "SAR");

/** The published methods a market-and-payment choice resolves to. */
export const methodsFor = (market: Market, payment: PaymentChoice): string[] =>
  market === "eg" ? EGYPT_METHODS : payment === "cash" ? CASH_METHODS : INSTALMENT_METHODS;

/* --- reading the book ------------------------------------------------------ */

export const today = (): string => new Date().toISOString().slice(0, 10);

const liveOn = (price: PricedRule, day: string) =>
  (!price.validFrom || price.validFrom <= day) && (!price.validTo || price.validTo >= day);

export const activeOffers = <T extends PricedRule>(entry: { prices: T[] }, day = today()): T[] =>
  entry.prices.filter((price) => price.active && price.scope === "offer" && liveOn(price, day));

/**
 * The band a seller may quote for one payment route.
 *
 * Several rules can apply to the same route — one per instrument, sometimes one
 * per country. The floor is the lowest floor any of them publishes and the
 * ceiling the highest ceiling, which is exactly the range a sale is judged
 * against; narrowing it here would invent breaches the audit does not see.
 */
export function bandFor(
  entry: { prices: PricedRule[] },
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

export const cashBand = (entry: { prices: PricedRule[] }, mode?: PriceMode) =>
  bandFor(entry, CASH_METHODS, "SAR", mode);
export const instalmentBand = (entry: { prices: PricedRule[] }, mode?: PriceMode) =>
  bandFor(entry, INSTALMENT_METHODS, "SAR", mode);
export const egyptBand = (entry: { prices: PricedRule[] }, mode?: PriceMode) =>
  bandFor(entry, EGYPT_METHODS, "EGP", mode);

/** The band for a market-and-payment choice, which is what a seller picks. */
export const bandForRoute = (
  entry: { prices: PricedRule[] },
  market: Market,
  payment: PaymentChoice,
  mode: PriceMode = "course",
): PriceBand | undefined => bandFor(entry, methodsFor(market, payment), currencyFor(market), mode);

/** A course somebody can negotiate on at all: its band has room in it. */
export const isNegotiable = (entry: { prices: PricedRule[] }): boolean => {
  const cash = cashBand(entry);
  const instalment = instalmentBand(entry);
  return Boolean((cash && !cash.fixed) || (instalment && !instalment.fixed));
};

/** Stable identity for a catalog entry across renders and lookups. */
export const entryKey = (entry: {
  code: string;
  deliveryType: string;
  subcategory: string;
  level: string;
}): string => `${entry.code}:${entry.deliveryType}:${entry.subcategory}:${entry.level}`;

/* --- the advice ------------------------------------------------------------ */

const round25 = (value: number) => Math.round(value / 25) * 25;

/**
 * Where inside the published band this sale should start.
 *
 * Open at the ceiling, step down once by a third of the band when the customer
 * pushes back, and stop at the floor. The numbers themselves are the price
 * book's; nothing here invents a price.
 */
export function suggest(band: PriceBand, state: CustomerState): number {
  const floor = band.floor ?? band.ceiling ?? 0;
  const ceiling = band.ceiling ?? band.floor ?? 0;
  if (state === "standard") return ceiling;
  if (state === "approved_floor") return floor;
  const step = Math.max(25, round25((ceiling - floor) / 3));
  return Math.max(floor, round25(ceiling - step));
}

/**
 * Whether a number may be quoted.
 *
 * Order matters: a price under the floor is refused before anything else can
 * soften it, and `approved_floor` still needs a manager because the exception
 * is what is being approved, not the arithmetic.
 */
export function verdictFor(
  price: number | null,
  band: PriceBand | undefined,
  state: CustomerState,
): Verdict | null {
  if (price === null || !band) return null;
  if (band.floor !== null && price < band.floor) return "not_allowed";
  if (band.ceiling !== null && price > band.ceiling) return "above_list";
  if (band.requiresReview) return "needs_approval";
  if (state === "approved_floor") return "needs_approval";
  return "safe";
}

function reasonsFor(band: PriceBand, state: CustomerState): ReasonCode[] {
  const reasons: ReasonCode[] = ["list_price"];
  if (band.fixed) reasons.push("fixed_price");
  else if (state === "discount") reasons.push("stepped_down_for_discount");
  else if (state === "approved_floor") reasons.push("approved_exception_floor");
  else reasons.push("opens_at_list");
  return reasons;
}

/**
 * The number a customer named, as a seller actually types it.
 *
 * "1,200 ر.س" and "1200" are both that number. Anything that leaves no digits
 * behind is not one, and says so: `Number("")` is `0`, so reading it leniently
 * would judge a quote of zero and report "under the floor" for what was really a
 * typo — an answer to a question nobody asked.
 */
export function parseAsked(raw: string): { ok: true; value: number | null } | { ok: false } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  const digits = trimmed.replace(/[^\d.]/g, "");
  if (!digits) return { ok: false };
  const value = Number(digits);
  return Number.isFinite(value) ? { ok: true, value } : { ok: false };
}

export interface AdviceRequest {
  market: Market;
  payment: PaymentChoice;
  state: CustomerState;
  /** A number the customer named, judged instead of the suggestion. */
  asked?: number | null;
  mode?: PriceMode;
  /** Overridable so a caller can price a sale dated other than today. */
  day?: string;
}

export interface AdviceOffer {
  id: string;
  currency: string;
  paymentMethod: string;
  exact: number | null;
  minimum: number | null;
  maximum: number | null;
  validFrom: string;
  validTo: string;
  /** Written on the offer for whoever is selling it, and shown to them. */
  note: string;
}

export interface Advice {
  key: string;
  code: string;
  courseName: string;
  deliveryType: string;
  subcategory: string;
  level: string;
  onHold: boolean;
  market: Market;
  payment: PaymentChoice;
  customerState: CustomerState;
  /** Which published scope this band came from: the course, or its bundle. */
  mode: PriceMode;
  currency: string;
  band: PriceBand | null;
  /** What to open at, from the book and the customer's state. */
  suggested: number | null;
  /** What the customer named, if anything. */
  asked: number | null;
  /** The number the verdict actually judges: `asked` when given, else `suggested`. */
  priceInQuestion: number | null;
  verdict: Verdict | null;
  reasons: ReasonCode[];
  /**
   * The route not chosen, so the effect of the payment method is visible rather
   * than asserted. Egypt publishes one price for every method, so it has none.
   */
  alternate: { payment: PaymentChoice; band: PriceBand } | null;
  offers: AdviceOffer[];
}

/**
 * Everything a seller needs about one course on one route, in one object.
 *
 * The only place the suggestion, the band and the verdict are computed. An API
 * response and a rendered tab are two readings of this, never two derivations.
 */
export function buildAdvice(entry: PricedEntry, request: AdviceRequest): Advice {
  const { market, payment, state } = request;
  const mode = request.mode ?? "course";
  const day = request.day ?? today();
  const currency = currencyFor(market);
  const band = bandForRoute(entry, market, payment, mode);

  const asked =
    request.asked !== undefined && request.asked !== null && Number.isFinite(request.asked)
      ? request.asked
      : null;
  const suggested = band ? suggest(band, state) : null;
  const priceInQuestion = asked ?? suggested;

  const alternateBand =
    market === "sa"
      ? bandForRoute(entry, market, payment === "cash" ? "instalment" : "cash", mode)
      : undefined;

  const methods = methodsFor(market, payment);
  const offers = activeOffers(entry, day)
    .filter(
      (price) =>
        price.currency === currency &&
        (market === "eg" || price.paymentMethod === "any" || methods.includes(price.paymentMethod)),
    )
    // Allowlisted rather than spread: a price rule also carries the workbook
    // sheet and row it was parsed from, which is a fact about maintaining the
    // book rather than about selling the course.
    .map((price) => ({
      id: price.id,
      currency: price.currency,
      paymentMethod: price.paymentMethod,
      exact: price.exact,
      minimum: price.minimum,
      maximum: price.maximum,
      validFrom: price.validFrom,
      validTo: price.validTo,
      note: price.note,
    }));

  return {
    key: entryKey(entry),
    code: entry.code,
    courseName: entry.courseName,
    deliveryType: entry.deliveryType,
    subcategory: entry.subcategory,
    level: entry.level,
    onHold: entry.onHold,
    market,
    payment,
    customerState: state,
    mode,
    currency,
    band: band ?? null,
    suggested,
    asked,
    priceInQuestion,
    verdict: verdictFor(priceInQuestion, band, state),
    reasons: band && band.floor !== null && band.ceiling !== null ? reasonsFor(band, state) : [],
    alternate: alternateBand
      ? { payment: payment === "cash" ? "instalment" : "cash", band: alternateBand }
      : null,
    offers,
  };
}
