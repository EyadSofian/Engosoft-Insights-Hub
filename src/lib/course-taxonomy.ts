import { paidCampaignPurpose } from "./campaign-purpose.ts";

// Pure, isomorphic course taxonomy: how a raw column value or a marketing name
// becomes one of the course codes the business actually reports on.
//
// It replaces a list of twelve substring regexes that searched anywhere in any
// string. That list attributed spend by accident. Two properties of the real
// data broke it:
//
// **1. `Auto` is a course code, not the English word "auto".**
// The rule `/\bauto(?:mobile)?\b/` matched `auto profile`, `auto-generated ad`,
// `Auto CAD`, `Auto Desk`, `ad-auto-2026` and `old auto dialer`. Every TikTok ad
// carrying one of those names pulled its whole campaign into the Automotive
// course — which is how `pmp-23-12-25-sayed t`, `interior-31-5-26 sayed t` and
// `web-sign-14/7/26` came to be listed as Automotive campaigns, spending
// Automotive money against zero Automotive leads. No real campaign is named with
// a bare `auto`: all 174 named ones spell it `Automotive`. So the token is gone.
//
// **2. The course is the LEADING token of a campaign name, not any token.**
// `BIm - CBO - Arch - 17/7/26` is a BIM campaign whose creative angle is
// architecture. Normal course names therefore still use their leading token.
// Website is the deliberate exception: Engosoft defines any campaign explicitly
// tagged `web` or `con` as part of the Website reporting bucket, wherever that
// tag appears. Everything else after the leading token remains geography,
// owner, team, funnel stage or creative variant. Names with no course at all
// (`Leads -hiring - sales`, `FB-Engagement-…`) correctly fall through to the CRM
// modal-course fallback.
//
// Column values and marketing names are resolved by *different* mechanisms and
// must not be mixed. A column value is looked up exactly against the workbook's
// `Courses` tab; a campaign name is tokenised. The old `canonicalCourse` joined
// an authoritative course column with free product text into one string and
// returned whichever rule sat earliest in the array. Context still must not
// overwrite an authoritative course column. `Maint` is the one explicit
// business alias: Engosoft sells Maintenance inside CMRP, so both labels
// intentionally canonicalise to the same CMRP bucket.

/** Trim, lower-case and collapse whitespace and dash variants for comparison. */
export function normalizeCourseKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ");
}

/**
 * Every course code the business reports on, taken from the workbook's `Courses`
 * tab. Engosoft treats the ads-side `Web` label and the revenue-side `Website`
 * label as one Website bucket, so the canonical reporting code is `Web`.
 */
export const COURSE_CODES = [
  "Arch",
  "Auto",
  "BIM",
  "CFM",
  "CMRP",
  "Certificate",
  "Deliveries",
  "Elec",
  "English",
  "Infra",
  "Interior",
  "Marketing",
  "Mech",
  "Other",
  "PMP",
  "Private",
  "Safety",
  "Steel",
  "Struc",
  "Tech",
  "Web",
] as const;

/**
 * `Product Category` / `Course Categories` → course, mirroring the workbook's
 * `Courses` tab (42 non-blank pairs as of 2026-08).
 *
 * This is a transcription, not an inference. When the tab gains a row, add it
 * here — or wire the tab into `TAB` and build this map from it, which is the
 * durable fix. Until then a category that is missing here keeps its own raw
 * value rather than being guessed into a neighbouring course.
 */
const CATEGORY_TO_COURSE: Record<string, string> = {
  "all / deliveries": "Deliveries",
  automotive: "Auto",
  cmrp: "CMRP",
  english: "English",
  fmp: "CFM",
  "facility management": "CFM",
  "interior design": "Interior",
  management: "PMP",
  marketing: "Marketing",
  other: "Other",
  "technical / architecture": "Arch",
  "technical / bim architecture": "BIM",
  "technical / bim mep / coordinator": "BIM",
  "technical / bim mep / modeler": "BIM",
  "technical / bim structure": "BIM",
  "technical / electrical": "Elec",
  "technical / infrastructure": "Infra",
  "technical / mechanical": "Mech",
  "technical / safety": "Safety",
  "technical / steel": "Steel",
  "technical / structure": "Struc",
  technology: "Tech",
  cfm: "CFM",
  civil: "civil",
  pmp: "PMP",
  "revenue / miscellaneous / certificate": "Certificate",
  "revenue / miscellaneous / private": "Private",
  "revenue / miscellaneous / website": "Web",
  "revenue / engineering / architecture": "Arch",
  "revenue / engineering / bim": "BIM",
  "revenue / engineering / electrical": "Elec",
  "revenue / engineering / facility management": "CFM",
  "revenue / engineering / mechanical": "Mech",
  "revenue / engineering / automotive": "Auto",
  "revenue / engineering / civil / infrastructure": "Infra",
  "revenue / engineering / civil / structure": "Struc",
  "revenue / engineering / maintenance": "CMRP",
  "revenue / engineering / safety": "Safety",
  "revenue / non-engineering / english": "English",
  "revenue / non-engineering / interior": "Interior",
  "revenue / non-engineering / management": "PMP",
  "revenue / non-engineering / marketing": "Marketing",
};

const VALUE_ALIASES = new Map<string, string>();
for (const [category, course] of Object.entries(CATEGORY_TO_COURSE))
  VALUE_ALIASES.set(category, course);
// A row that already carries the canonical code resolves to itself.
for (const code of COURSE_CODES) VALUE_ALIASES.set(normalizeCourseKey(code), code);
// Odoo/accounting writes `Website`, while paid campaigns write `Web`. They are
// the same business bucket and must reconcile to one row on the Courses page.
VALUE_ALIASES.set("website", "Web");
// The workbook still emits this historical label, but the business reports the
// product under CMRP. Keep the alias at ingestion so spend, CRM and revenue use
// one key everywhere rather than being stitched together only in the UI.
VALUE_ALIASES.set("maint", "CMRP");
VALUE_ALIASES.set("maintenance", "CMRP");

/**
 * Bucket for paid lines that genuinely belong to no course — discounts,
 * delivery, gift cards. It exists so the course breakdown reconciles to the
 * headline revenue total without inventing a course per product string.
 */
export const UNATTRIBUTED_COURSE = "Unattributed";

/**
 * Whether a value names a course this taxonomy recognises.
 *
 * Used to gate the ads-side course column, which is a spreadsheet formula and
 * therefore ships spreadsheet errors: the live `Meta Ads Daily` tab currently
 * carries `#REF!` on some rows. A CRM or invoice row keeps an unrecognised
 * course so a genuinely new course stays visible, but an ad row has a campaign
 * name to fall back on, and `#REF!` should never become a course with a budget.
 */
export const isKnownCourse = (value: unknown): boolean =>
  VALUE_ALIASES.has(normalizeCourseKey(value));

/** `Main Category` per course, also from the `Courses` tab. */
const COURSE_MAIN_CATEGORY: Record<string, string> = {
  Arch: "Engineering",
  Auto: "Engineering",
  BIM: "Engineering",
  CFM: "Professional Certificate",
  CMRP: "Professional Certificate",
  Certificate: "Non-Engineering",
  Deliveries: "Non-Engineering",
  Elec: "Engineering",
  English: "Non-Engineering",
  Infra: "Engineering",
  Interior: "Interior & Decor",
  Marketing: "Non-Engineering",
  Mech: "Engineering",
  Other: "Non-Engineering",
  PMP: "Professional Certificate",
  Private: "Non-Engineering",
  Safety: "Professional Certificate",
  Steel: "Engineering",
  Struc: "Engineering",
  Tech: "Non-Engineering",
  Web: "Non-Engineering",
  civil: "Engineering",
};

export const mainCategoryForCourse = (course: string): string => {
  const canonical = VALUE_ALIASES.get(normalizeCourseKey(course)) ?? course;
  return COURSE_MAIN_CATEGORY[canonical] ?? "";
};

/**
 * Leading tokens used by the marketing naming convention, verified against every
 * campaign name in the live workbook.
 *
 * `auto` is deliberately absent — see the note at the top of this file.
 * `nterior` is a live typo on `nterior-1/1/26-sayed-sn`, which carries real
 * Interior leads; naming it here is cheaper than losing them.
 */
const NAME_TOKENS: Record<string, string> = {
  cfm: "CFM",
  fmp: "CFM",
  bim: "BIM",
  pmp: "PMP",
  cmrp: "CMRP",
  interior: "Interior",
  nterior: "Interior",
  automotive: "Auto",
  automobile: "Auto",
  سيارات: "Auto",
  mech: "Mech",
  mechanical: "Mech",
  elec: "Elec",
  electrical: "Elec",
  struc: "Struc",
  structural: "Struc",
  structure: "Struc",
  arch: "Arch",
  architecture: "Arch",
  architectural: "Arch",
  infra: "Infra",
  infrastructure: "Infra",
  steel: "Steel",
  web: "Web",
  tech: "Tech",
  technology: "Tech",
  safety: "Safety",
  maint: "CMRP",
  maintenance: "CMRP",
  marketing: "Marketing",
  english: "English",
};

/**
 * Campaign-type words that legitimately precede the course token:
 * `Lead Automotive riyadh …`, `LEAD Interior Offline …`, `off- interior-27-3-26`,
 * `Copy of web-sign-4/6-sn`.
 *
 * They are skipped, not treated as a licence to scan the rest of the name. The
 * scan stops at the first word that is neither noise nor a course, so
 * `Leads -hiring - sales -11/5` resolves to nothing rather than to a course
 * mentioned later in the string.
 */
const LEADING_NOISE = new Set([
  "lead",
  "leads",
  "copy",
  "of",
  "off",
  "on",
  "new",
  "traffic",
  "engagement",
  // Product names get the same treatment, and carry their own wrappers:
  // `Free Product - CFM Preparation Course` is a CFM line.
  "free",
  "product",
]);

const tokenize = (name: string): string[] =>
  normalizeCourseKey(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** A leading number is a product code or a date, never a course. */
const isNumeric = (token: string): boolean => /^\d+$/.test(token);

/**
 * An Odoo product line written into a course column, rather than a course.
 *
 * `Full Invoiced Orders.Course` carries the product name on discount rows, so
 * "keep an unrecognised course value as itself" — which exists so a genuinely
 * new course stays visible — produced two courses called
 * `[851] 100% on The Freelance Masterclass` and `[841] 20% on specific
 * products`, each holding a couple of sales orders and no money.
 *
 * Narrow on purpose: a leading `[code]` or promo wrapper only. Every real
 * course value in the workbook is a plain word or an `Odoo / category / path`.
 */
const isProductLine = (value: string): boolean =>
  /^\s*(?:\[[^\]]*\]|\d+(?:\.\d+)?\s*%\s*on\b|free\s+product\b)/i.test(value);

/**
 * The course a campaign / ad-set / ad name declares, or `""` when it declares
 * none. Never guesses from a token buried in the middle of the name.
 *
 * Product names are read the same way, once their `[841]`-style code is skipped:
 * `[855] PMP Preparation Course - 8th Edition` is a PMP line, while
 * `[841] 20% on specific products` is a discount that belongs to no course and
 * must stay unresolved rather than become one.
 */
export function courseFromMarketingName(name: unknown): string {
  const raw = String(name ?? "");
  // The Website page uses the explicit Engosoft naming rule `web` / `con`
  // anywhere in a campaign name. Apply the same rule here so `Traffic-all-web`
  // cannot disappear from the Courses Website total, and keep webinar separate.
  if (paidCampaignPurpose(raw) === "website") return "Web";
  for (const token of tokenize(raw)) {
    if (isNumeric(token) || LEADING_NOISE.has(token)) continue;
    return NAME_TOKENS[token] ?? "";
  }
  return "";
}

/**
 * The course for a row that carries a course column.
 *
 * `courseValue` is the authoritative column (`Course`, `Course Name`,
 * `Course Categories`); `context` is supporting text such as the product name
 * and product category. They are resolved **in order and independently** — an
 * authoritative value is never concatenated with free product text. Explicit
 * business aliases are resolved before context: `Maint` becomes `CMRP` because
 * they are the same sold course, while unrelated product words cannot move it.
 *
 * An unrecognised course value keeps its own name, so a new course appears as
 * itself instead of hiding inside a neighbouring one. Unrecognised *context*
 * does not: falling back to a product string invented courses called
 * "[841] 20% on specific products".
 */
export function canonicalCourseValue(courseValue: unknown, ...context: unknown[]): string {
  const primary = String(courseValue ?? "").trim();
  const candidates = [primary, ...context.map((value) => String(value ?? "").trim())].filter(
    Boolean,
  );

  for (const candidate of candidates) {
    const exact = VALUE_ALIASES.get(normalizeCourseKey(candidate));
    if (exact) return exact;
  }
  for (const candidate of candidates) {
    const named = courseFromMarketingName(candidate);
    if (named) return named;
  }
  return isProductLine(primary) ? "" : primary;
}
