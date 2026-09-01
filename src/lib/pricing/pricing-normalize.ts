// Value normalization shared by the workbook parser, the pricing engine and the
// invoice reader.
//
// Two rules drive everything in this file:
//
//  1. An absent price is `null`, never `0`. A course with no published Egyptian
//     price is not a course that may be sold for nothing.
//  2. A normalization keeps the original string. Every judgement this feature
//     makes has to be explainable back to a cell in the workbook.
import type { DeliveryType, PaymentMethod, PriceMethodScope } from "./pricing-types.ts";

/** Cell contents that mean "no price published here". */
const NULL_TOKENS = new Set([
  "",
  "-",
  "--",
  "_",
  "__",
  "___",
  "____",
  "_____",
  "n/a",
  "na",
  "notavailable",
  "not available",
  "notyetavailable",
  "none",
  "null",
  "tbd",
  "غيرمتاح",
  "غير متاح",
  "لايوجد",
  "لا يوجد",
]);

/** Arabic-Indic and Eastern Arabic-Indic digits used across the workbook. */
const DIGIT_MAP: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
};

export function westernDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => DIGIT_MAP[digit] ?? digit);
}

export function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

/** True when the cell means "nothing published", as opposed to a real zero. */
export function isNullToken(value: unknown): boolean {
  const raw = text(value).toLowerCase();
  if (NULL_TOKENS.has(raw)) return true;
  // A run of underscores of any length is the workbook's own "not sold" mark.
  return /^_+$/.test(raw);
}

/** A product the company has suspended. Never a price of zero. */
export function isHoldToken(value: unknown): boolean {
  const raw = text(value).toLowerCase();
  return raw === "hold" || raw === "on hold" || raw === "موقوف" || raw === "متوقف";
}

/**
 * Read a price cell.
 *
 * Returns `null` for every non-price cell, including free text, so a caller can
 * never mistake "Not Available" or "Hold" for zero. A genuine `0` in the
 * workbook does come back as `0`; that is a published free price, which is a
 * different fact from an empty cell.
 */
export function priceCell(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = text(value);
  if (!raw || isNullToken(raw) || isHoldToken(raw)) return null;
  const cleaned = westernDigits(raw)
    .replace(/[,\s\u00a0\u202f]/g, "")
    .replace(/(ريال|جنيه|sar|egp|aed|usd)/gi, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/* --- delivery type --------------------------------------------------------- */

const DELIVERY_ALIASES: [RegExp, DeliveryType][] = [
  [/^(record|recorded|recording|مسجل|مسجلة)/i, "recorded"],
  [/^(online|اونلاين|أونلاين|مباشر)/i, "online"],
  [/^(offline|حضوري|حضورى|قاعة)/i, "offline"],
  [/^(exam|examination|امتحان|اختبار)/i, "exam"],
  [/^(ship|shiping|shipping|شحن)/i, "shipping"],
  [/^(certificat|certificate|شهادة|شهاده)/i, "certificate"],
  [/^(renew|renewal|تجديد)/i, "renewal"],
];

/**
 * Map the workbook's spellings onto one vocabulary.
 *
 * `Record`, `Shiping` and `Certificat` are how the sheets actually spell these,
 * typos included; they are matched by prefix rather than corrected in the file,
 * so the original stays readable next to the normalized value.
 */
export function normalizeDeliveryType(value: unknown): DeliveryType {
  const raw = text(value);
  if (!raw) return "unknown";
  for (const [pattern, type] of DELIVERY_ALIASES) {
    if (pattern.test(raw)) return type;
  }
  return "unknown";
}

/* --- payment method -------------------------------------------------------- */

/**
 * Default aliases from Odoo journal / payment-method / provider names onto the
 * instruments the price book prices. Administrators extend this at runtime
 * (`price_payment_aliases`); nothing here is guessed from a currency, a country
 * or an amount, and a payment term is never treated as an instrument.
 */
export const DEFAULT_PAYMENT_ALIASES: Record<string, PaymentMethod> = {
  tabby: "tabby",
  "tabby installments": "tabby",
  "tabby pay later": "tabby",
  تابي: "tabby",
  tamara: "tamara",
  "tamara installments": "tamara",
  تمارا: "tamara",
  تمارة: "tamara",
  cash: "cash",
  كاش: "cash",
  نقدي: "cash",
  نقدا: "cash",
  "cash in": "cash",
  cashier: "cashier",
  كاشير: "cashier",
  "cashier check": "cashier",
  "cashier cheque": "cashier",
  "bank transfer": "bank_transfer",
  bank: "bank_transfer",
  transfer: "bank_transfer",
  wire: "bank_transfer",
  "wire transfer": "bank_transfer",
  "تحويل بنكي": "bank_transfer",
  تحويل: "bank_transfer",
};

/**
 * Resolve one raw payment string.
 *
 * Matching is exact-then-token: a journal called `Tabby SAR` resolves through
 * its `tabby` token, while an unfamiliar journal stays `unknown` rather than
 * being pushed into the nearest bucket. Returning `unknown` is a supported
 * outcome; the audit shows it as "needs review", not as a breach.
 */
export function normalizePaymentMethod(
  value: unknown,
  aliases: Record<string, PaymentMethod> = DEFAULT_PAYMENT_ALIASES,
): PaymentMethod {
  const raw = text(value).toLowerCase();
  if (!raw) return "unknown";
  const direct = aliases[raw];
  if (direct) return direct;

  // Longest alias first, so "bank transfer" is not shadowed by "bank".
  const entries = Object.entries(aliases).sort((a, b) => b[0].length - a[0].length);
  for (const [alias, method] of entries) {
    if (!alias) continue;
    if (raw.includes(alias)) return method;
  }
  return "unknown";
}

/** Reduce several settled instruments to one verdict. */
export function combinePaymentMethods(methods: PaymentMethod[]): PaymentMethod {
  const distinct = [...new Set(methods.filter((method) => method !== "unknown"))];
  if (!distinct.length) return "unknown";
  if (distinct.length === 1) return distinct[0];
  return "mixed";
}

/* --- product codes and course names ---------------------------------------- */

/**
 * Canonical form of a product code.
 *
 * Excel hands back `586` as the number `586`, and the same code appears in the
 * workbook as `586.0`; both must reach the same key as Odoo's `586`. Composite
 * codes such as `65 - 586` are deliberately *not* split — they identify a
 * bundle that has to be mapped by hand.
 */
export function normalizeProductCode(value: unknown): string {
  let raw = westernDigits(text(value)).toUpperCase();
  if (!raw) return "";
  raw = raw.replace(/\.0+$/, "");
  return raw
    .replace(/[\s\u00a0\u202f]+/g, " ")
    .replace(/^[[({]+|[\])}]+$/g, "")
    .trim();
}

/**
 * Recover a product code from Odoo's own rendering of a product name.
 *
 * `product.display_name` is `[default_code] name`, so "[586] CFM Exam Simulator"
 * carries the exact code even when the export has no code column — which is the
 * case for the accounting rows this dashboard actually stores.
 *
 * This is not name matching. It reads a delimited field Odoo printed itself and
 * fails closed on anything else: a name with no leading bracket, or a bracket
 * holding something that is not a code, returns nothing rather than a guess.
 */
export function productCodeFromDisplayName(value: unknown): string {
  const raw = text(value);
  const match = raw.match(/^\[([^\]]{1,32})\]/);
  if (!match) return "";
  const code = normalizeProductCode(match[1]);
  // A bracket has to hold something code-shaped, and every Engosoft product code
  // contains a digit. Without that check a product called "[Course] Advanced"
  // would invent the code COURSE, which matches nothing and only adds noise.
  if (!/\d/.test(code)) return "";
  return /^[A-Z0-9][A-Z0-9\s\-_/.+&]*$/i.test(code) ? code : "";
}

/** True when a code names more than one product, e.g. `65 - 586`. */
export function isCompositeCode(value: unknown): boolean {
  const raw = normalizeProductCode(value);
  if (!raw) return false;
  return /\d\s*[-+/&]\s*\d/.test(raw);
}

export function normalizeCourseName(value: unknown): string {
  return text(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .trim();
}

/* --- dates ----------------------------------------------------------------- */

export interface AmbiguousDate {
  raw: string;
  /** ISO date under a day/month reading, when that reading is possible. */
  dayFirst: string;
  /** ISO date under a month/day reading, when that reading is possible. */
  monthFirst: string;
  /** True when both readings are valid and different — a human must choose. */
  ambiguous: boolean;
}

const pad = (value: number): string => String(value).padStart(2, "0");

const validDate = (year: number, month: number, day: number): string => {
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return "";
  return `${year}-${pad(month)}-${pad(day)}`;
};

/**
 * Read a slash date without picking a convention.
 *
 * `9/10/2026` is 9 October to half of Engosoft and 10 September to the other
 * half. Guessing silently would move a whole offer window, so both readings are
 * returned and the import screen makes a person decide.
 */
export function readAmbiguousDate(value: unknown): AmbiguousDate | null {
  const raw = westernDigits(text(value));
  if (!raw) return null;

  const iso = raw.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const resolved = validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return resolved ? { raw, dayFirst: resolved, monthFirst: resolved, ambiguous: false } : null;
  }

  const slash = raw.match(/(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2,4})/);
  if (!slash) return null;
  const first = Number(slash[1]);
  const second = Number(slash[2]);
  const yearRaw = Number(slash[3]);
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;

  const dayFirst = validDate(year, second, first);
  const monthFirst = validDate(year, first, second);
  if (!dayFirst && !monthFirst) return null;
  return {
    raw,
    dayFirst: dayFirst || monthFirst,
    monthFirst: monthFirst || dayFirst,
    ambiguous: !!dayFirst && !!monthFirst && dayFirst !== monthFirst,
  };
}

/** `true` when `date` falls inside `[from, to]`; blank bounds are open. */
export function withinWindow(date: string, from: string, to: string): boolean {
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

/* --- money ----------------------------------------------------------------- */

export const CURRENCIES = ["SAR", "EGP", "AED", "USD", "KWD", "QAR", "BHD", "OMR"] as const;

export function normalizeCurrency(value: unknown): string {
  const raw = text(value).toUpperCase();
  if (!raw) return "";
  if (/^[A-Z]{3}$/.test(raw)) return raw;
  if (/ريال|SAUDI|SAR/i.test(raw)) return "SAR";
  if (/جنيه|EGYPT|EGP/i.test(raw)) return "EGP";
  if (/درهم|DIRHAM|AED/i.test(raw)) return "AED";
  if (/دولار|DOLLAR|USD/i.test(raw)) return "USD";
  return raw.slice(0, 12);
}

/** Rounds money for comparison so 199.999999 does not read as below 200. */
export function money(value: number): number {
  return Math.round(value * 100) / 100;
}

/* --- free-text price phrases ----------------------------------------------- */

export interface ParsedPricePhrase {
  method: PriceMethodScope;
  amount: number;
  raw: string;
}

/**
 * Pull structured prices out of the workbook's bundle and offer cells.
 *
 * These cells are written by hand: `1750 Taby / 1500 Cash`, `999 Cash Only`,
 * `1600 Tabby /  1250 Cash`. Anything this cannot read confidently returns an
 * empty list, and the row is imported as a draft that needs review rather than
 * as a published price.
 */
export function parsePricePhrases(value: unknown): ParsedPricePhrase[] {
  const raw = westernDigits(text(value));
  if (!raw || isNullToken(raw)) return [];

  const out: ParsedPricePhrase[] = [];
  // `1750 Taby`, `1500 Cash`, `999 Cash Only`, `1250 Cash Only`.
  const pattern =
    /(\d[\d,]*(?:\.\d+)?)\s*(tabby|taby|tamara|tamra|cash|kasher|cashier|كاش|كاشير|تابي|تمارا)\b/gi;
  for (const match of raw.matchAll(pattern)) {
    const amount = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(amount)) continue;
    const token = match[2].toLowerCase();
    const method: PriceMethodScope =
      /tab/.test(token) || token === "تابي"
        ? "tabby"
        : /tam/.test(token) || token === "تمارا"
          ? "tamara"
          : /kash|cashier|كاشير/.test(token)
            ? "cashier"
            : "cash";
    out.push({ method, amount, raw: match[0].trim() });
  }
  return out;
}

/** A bare number in a bundle/offer cell, with no method written next to it. */
export function bareAmount(value: unknown): number | null {
  const raw = westernDigits(text(value));
  if (!raw || isNullToken(raw)) return null;
  if (!/^\d[\d,]*(\.\d+)?$/.test(raw.replace(/\s/g, ""))) return null;
  const parsed = Number(raw.replace(/[\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}
