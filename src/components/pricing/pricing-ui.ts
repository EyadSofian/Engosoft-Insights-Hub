// Shared shapes and labels for the Price Book pages.
//
// Every enum the API can return is spelled out in both languages here rather
// than in each component, so a status can never render as a raw slug in one
// place and a sentence in another.
import type { Lang } from "@/lib/i18n";

export interface AuthState {
  signedIn: boolean;
  via: "sso" | "admin-code" | null;
  name: string;
  editable: boolean;
  sso: boolean;
  adminCode: boolean;
}

export interface PriceBookSummary {
  id: string;
  name: string;
  version: number;
  status: "draft" | "published" | "archived";
  effectiveFrom: string;
  effectiveTo: string;
  sourceType: string;
  sourceName: string;
  sourceUrl: string;
  sourceChecksum: string;
  taxInclusive: boolean;
  baseCurrency: string;
  notes: string;
  createdAt: string;
  createdBy: string;
  publishedAt: string;
  publishedBy: string;
  itemCount: number;
  copiedFromId: string;
}

export interface CatalogPrice {
  id: string;
  scope: string;
  bundleName: string;
  paymentMethod: string;
  currency: string;
  country: string;
  exact: number | null;
  minimum: number | null;
  maximum: number | null;
  validFrom: string;
  validTo: string;
  active: boolean;
  requiresReview: boolean;
  note: string;
}

export interface CatalogEntry {
  code: string;
  rawCode: string;
  courseName: string;
  specialization: string;
  subcategory: string;
  deliveryType: string;
  level: string;
  odooProductId: number | null;
  onHold: boolean;
  requiresReview: boolean;
  prices: CatalogPrice[];
}

export interface PriceItem {
  id: string;
  priceBookId: string;
  sourceSheet: string;
  sourceRow: number;
  specialization: string;
  subcategory: string;
  rawProductCode: string;
  normalizedProductCode: string;
  odooProductId: number | null;
  courseName: string;
  deliveryType: string;
  rawDeliveryType: string;
  level: string;
  pricingScope: string;
  bundleName: string;
  paymentMethod: string;
  currency: string;
  exactPrice: number | null;
  minimumPrice: number | null;
  maximumPrice: number | null;
  validFrom: string;
  validTo: string;
  country: string;
  company: string;
  active: boolean;
  requiresReview: boolean;
  onHold: boolean;
  note: string;
  rawSourceData: Record<string, string>;
}

export interface AuditRow {
  invoiceLineId: string;
  invoiceNumber: string;
  priceBookVersion: number;
  paymentMethod: string;
  paymentMethodRaw: string;
  currency: string;
  quantity: number;
  actualUnitPrice: number;
  allowedMinimum: number | null;
  allowedMaximum: number | null;
  complianceStatus: string;
  severity: string;
  varianceAmount: number;
  variancePercent: number | null;
  leakageAmount: number;
  matchType: string;
  reason: string;
  saleDate: string;
  invoiceDate: string;
  paymentDate: string;
  salesperson: string;
  salesTeam: string;
  company: string;
  productCode: string;
  productName: string;
}

/* --- labels ---------------------------------------------------------------- */

type Bilingual = { ar: string; en: string };

const pick = (entry: Bilingual | undefined, lang: Lang, fallback: string): string =>
  entry ? entry[lang] : fallback;

const STATUS: Record<string, Bilingual> = {
  compliant: { ar: "ملتزم", en: "Compliant" },
  compliant_offer: { ar: "ملتزم بعرض ساري", en: "Within a live offer" },
  below_minimum: { ar: "تحت الحد الأدنى", en: "Below the floor" },
  above_list: { ar: "أعلى من السعر الرسمي", en: "Above list" },
  unmatched_product: { ar: "منتج غير مطابق", en: "Unmatched product" },
  unknown_payment_method: { ar: "طريقة دفع غير معروفة", en: "Unknown payment method" },
  mixed_payment_review: { ar: "دفع مختلط — يحتاج مراجعة", en: "Mixed payment — review" },
  expired_offer: { ar: "عرض منتهي", en: "Expired offer" },
  excluded: { ar: "مستثنى", en: "Excluded" },
};

const SEVERITY: Record<string, Bilingual> = {
  critical: { ar: "حرج", en: "Critical" },
  warning: { ar: "تنبيه", en: "Warning" },
  needs_review: { ar: "يحتاج مراجعة", en: "Needs review" },
  informational: { ar: "للعلم", en: "For information" },
  none: { ar: "—", en: "—" },
};

const METHOD: Record<string, Bilingual> = {
  tabby: { ar: "تابي", en: "Tabby" },
  tamara: { ar: "تمارا", en: "Tamara" },
  cash: { ar: "كاش", en: "Cash" },
  cashier: { ar: "كاشير", en: "Cashier" },
  bank_transfer: { ar: "تحويل بنكي", en: "Bank transfer" },
  mixed: { ar: "مختلط", en: "Mixed" },
  unknown: { ar: "غير معروفة", en: "Unknown" },
  any: { ar: "كل الطرق", en: "Any method" },
};

const DELIVERY: Record<string, Bilingual> = {
  online: { ar: "أونلاين", en: "Online" },
  recorded: { ar: "مسجل", en: "Recorded" },
  offline: { ar: "حضوري", en: "Offline" },
  exam: { ar: "امتحان", en: "Exam" },
  shipping: { ar: "شحن", en: "Shipping" },
  certificate: { ar: "شهادة", en: "Certificate" },
  renewal: { ar: "تجديد", en: "Renewal" },
  unknown: { ar: "غير محدد", en: "Unspecified" },
};

const SCOPE: Record<string, Bilingual> = {
  individual: { ar: "دورة منفردة", en: "Single course" },
  bundle: { ar: "باقة", en: "Package" },
  level: { ar: "باقة مستوى", en: "Level package" },
  offer: { ar: "عرض", en: "Offer" },
  incentive: { ar: "حافز موظف", en: "Staff incentive" },
};

const MATCH: Record<string, Bilingual> = {
  odoo_product_id: { ar: "مطابقة بمعرّف أودو", en: "Matched by Odoo product id" },
  exact_code: { ar: "مطابقة بالكود", en: "Matched by exact code" },
  manual: { ar: "ربط يدوي معتمد", en: "Approved manual link" },
  alias: { ar: "مرادف معتمد", en: "Approved alias" },
  none: { ar: "بدون مطابقة", en: "No match" },
};

export const statusLabel = (value: string, lang: Lang): string => pick(STATUS[value], lang, value);
export const severityLabel = (value: string, lang: Lang): string =>
  pick(SEVERITY[value], lang, value);
export const methodLabel = (value: string, lang: Lang): string => pick(METHOD[value], lang, value);
export const deliveryLabel = (value: string, lang: Lang): string =>
  pick(DELIVERY[value], lang, value);
export const scopeLabel = (value: string, lang: Lang): string => pick(SCOPE[value], lang, value);
export const matchLabel = (value: string, lang: Lang): string => pick(MATCH[value], lang, value);

export const PAYMENT_METHOD_OPTIONS = ["tabby", "tamara", "cash", "cashier", "bank_transfer"];

export type Tone = "neutral" | "brand" | "success" | "warning" | "danger";

/** Colour a verdict by what it asks somebody to do, not by how bad it sounds. */
export const statusTone = (value: string): Tone => {
  if (value === "below_minimum") return "danger";
  if (value === "compliant" || value === "compliant_offer") return "success";
  if (value === "above_list") return "brand";
  if (value === "excluded") return "neutral";
  return "warning";
};

export const severityTone = (value: string): Tone => {
  if (value === "critical") return "danger";
  if (value === "warning") return "warning";
  if (value === "needs_review") return "warning";
  if (value === "informational") return "brand";
  return "neutral";
};

/**
 * Money in the currency it was quoted in.
 *
 * The price book publishes SAR and EGP; showing either converted to dollars
 * would hide the number a seller is actually held to.
 */
export function fmtMoney(value: number | null | undefined, currency: string, lang: Lang): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-US", {
      style: "currency",
      currency: currency || "SAR",
      maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
    }).format(value);
  } catch {
    return `${value.toLocaleString(lang === "ar" ? "ar-EG" : "en-US")} ${currency}`;
  }
}

/** A published band as one phrase: a single price, or a floor-to-ceiling range. */
export function bandText(
  price: { exact: number | null; minimum: number | null; maximum: number | null; currency: string },
  lang: Lang,
): string {
  const { minimum, maximum, exact, currency } = price;
  if (minimum !== null && maximum !== null && minimum !== maximum) {
    return `${fmtMoney(minimum, currency, lang)} – ${fmtMoney(maximum, currency, lang)}`;
  }
  return fmtMoney(exact ?? minimum ?? maximum, currency, lang);
}

/** Send an authenticated write, carrying the admin code when there is no SSO. */
export async function writeJson(
  url: string,
  method: "POST" | "PUT",
  payload: unknown,
  adminCode: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(adminCode ? { "x-admin-secret": adminCode } : {}),
    },
    body: JSON.stringify(payload),
  });
  const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || parsed.ok === false) {
    throw new Error(String(parsed.error || `Request failed: ${response.status}`));
  }
  return parsed;
}

/**
 * Where the admin code lives between visits.
 *
 * The same key the media-plan and target editors use, so somebody who has
 * already unlocked one editor does not have to type the code again here.
 */
export const ADMIN_CODE_KEY = "engosoft-admin-code";
