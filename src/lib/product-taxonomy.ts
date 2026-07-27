// Pure, isomorphic taxonomy for the Products tab: how a raw Odoo product name
// becomes a course + a modality, and how a raw utm.source becomes a channel.
//
// It lives outside `products.server.ts` so the page renders the same labels the
// server grouped by — a second copy of these strings would drift within a week.
//
// Everything here is a NAMING convention, not a measurement. No number in this
// dashboard depends on it: units and revenue are aggregated per Odoo product id,
// and the UI always shows the exact product names inside a group.

export interface Bilingual {
  ar: string;
  en: string;
}

/* --- acquisition source --------------------------------------------------- */

export const UNATTRIBUTED = "__none__";

// Odoo's utm.source table has grown organic duplicates: `UChat` and `uchat`,
// `Email` and `E-mail`, `Facebook [2]` and `Facebook`. Only pairs that are
// demonstrably the same channel are merged. Anything unrecognised keeps its own
// name rather than being swept into an "Other" bucket that hides it.
const SOURCE_RULES: { key: string; label: Bilingual; test: RegExp }[] = [
  {
    key: "facebook",
    label: { ar: "فيسبوك / إنستجرام", en: "Facebook / Instagram" },
    test: /^(facebook|fb|meta|ig|instagram)\b/i,
  },
  { key: "tiktok", label: { ar: "تيك توك", en: "TikTok" }, test: /^tik\s*tok/i },
  { key: "snapchat", label: { ar: "سناب شات", en: "Snapchat" }, test: /^snap/i },
  { key: "whatsapp", label: { ar: "واتساب", en: "WhatsApp" }, test: /whats\s*app/i },
  { key: "uchat", label: { ar: "UChat", en: "UChat" }, test: /^u\s*chat/i },
  { key: "chatwoot", label: { ar: "Chatwoot", en: "Chatwoot" }, test: /^chatwoot/i },
  { key: "trengo", label: { ar: "Trengo", en: "Trengo" }, test: /^trengo/i },
  {
    key: "phone",
    label: { ar: "مكالمة هاتفية", en: "Phone call" },
    test: /(phone\s*call|^call\b|auto\s*dialer)/i,
  },
  {
    key: "recommendation",
    label: { ar: "ترشيح / توصية", en: "Recommendation" },
    test: /(recommend|referral|ترشيح)/i,
  },
  {
    key: "website",
    label: { ar: "الموقع الإلكتروني", en: "Website" },
    test: /(^website$|^web$|landing\s*page|^odoo$)/i,
  },
  { key: "email", label: { ar: "البريد الإلكتروني", en: "Email" }, test: /^e-?mail$/i },
  { key: "linkedin", label: { ar: "لينكدإن", en: "LinkedIn" }, test: /^linked\s*in/i },
  {
    key: "webinar",
    label: { ar: "ندوات وفعاليات", en: "Webinars & seminars" },
    test: /^(webinar|seminar)/i,
  },
  {
    key: "resale",
    label: { ar: "بيانات قديمة / إعادة بيع", en: "Resale / old data" },
    test: /resale/i,
  },
];

export const SOURCE_LABELS: Record<string, Bilingual> = Object.fromEntries([
  ...SOURCE_RULES.map((r) => [r.key, r.label] as const),
  [UNATTRIBUTED, { ar: "بدون مصدر مسجَّل", en: "No source recorded" }] as const,
]);

/** Strips Odoo's `[2]`-style suffixes the same way the rest of the dashboard does. */
const cleanSourceName = (raw: string): string => raw.split("[")[0].trim();

export function normalizeSource(raw: string): { key: string; label: string } {
  const clean = cleanSourceName(raw);
  if (!clean) return { key: UNATTRIBUTED, label: "" };
  for (const rule of SOURCE_RULES)
    if (rule.test.test(clean)) return { key: rule.key, label: rule.label.en };
  // Unknown source: keep its real name so it can never hide inside "Other".
  return { key: `raw:${clean.toLowerCase()}`, label: clean };
}

/** Resolves a breakdown row to display text; unknown sources fall back to their raw label. */
export function sourceLabel(key: string, fallback: string, lang: "ar" | "en"): string {
  const known = SOURCE_LABELS[key];
  if (known) return known[lang];
  return fallback || key.replace(/^raw:/, "");
}

/* --- course modality ------------------------------------------------------ */

// Engosoft does not model course modality as an Odoo product variant. `CMRP` is
// eleven separate product templates whose modality lives in the product NAME:
// "... - Recorded", "... - Event", "CMRP Exam Simulator", "CMRP Registration".
//
// Every pattern must consume WHOLE words. An earlier version used
// `exam\s*simulat`, which stripped "Exam Simulat" out of "PMP Exam Simulator"
// and left a course family literally called "PMP or".
const VARIANT_RULES: { key: string; label: Bilingual; test: RegExp }[] = [
  {
    key: "exam_simulator",
    label: { ar: "محاكي الاختبار", en: "Exam simulator" },
    test: /\bexams?\s*simulat\w*\b|\bsimulator\b/i,
  },
  {
    key: "registration",
    label: { ar: "تسجيل الاختبار", en: "Exam registration" },
    test: /\bregistrations?\b/i,
  },
  {
    key: "individual_prep",
    label: { ar: "تحضير فردي", en: "Individual preparation" },
    test: /\bindividual\s+preparation\b/i,
  },
  {
    key: "offline_attendance",
    label: { ar: "حضوري", en: "Offline attendance" },
    test: /\boffline\s+attendance\b/i,
  },
  {
    key: "online_attendance",
    label: { ar: "حضوري أونلاين", en: "Online attendance" },
    test: /\bonline\s+attendance\b|دورة\s*حضورية\s*أونلاين/i,
  },
  {
    key: "recorded",
    label: { ar: "مسجَّل", en: "Recorded" },
    test: /\brecorded\b|\brecord\b|\bself\s*-?\s*study\b|\bselfstudy\b|محتوى\s*مقروء/i,
  },
  { key: "event", label: { ar: "دورة حضورية", en: "Event / live" }, test: /\bevents?\b/i },
  { key: "online", label: { ar: "أونلاين", en: "Online" }, test: /\bonline\b/i },
  {
    key: "membership",
    label: { ar: "اشتراك", en: "Membership" },
    test: /\bmemberships?\b|\bplatform\s+renewal\b/i,
  },
  { key: "package", label: { ar: "باقة", en: "Package" }, test: /\bpackages?\b|حزم/i },
];

export const VARIANT_LABELS: Record<string, Bilingual> = Object.fromEntries([
  ...VARIANT_RULES.map((r) => [r.key, r.label] as const),
  ["standard", { ar: "بدون نوع محدد", en: "Unspecified" }] as const,
  ["discount", { ar: "خصم", en: "Discount" }] as const,
  ["free", { ar: "منتج مجاني", en: "Free product" }] as const,
  ["fee", { ar: "رسوم / دفعة", en: "Fee / payment" }] as const,
]);

export const variantLabel = (key: string, lang: "ar" | "en"): string =>
  VARIANT_LABELS[key]?.[lang] ?? key;

/** `NN% on ...` and `Free Product - ...` are promo wrappers, not course modalities. */
const PROMO_PREFIX = /^\s*(\d+(\.\d+)?\s*%\s*on\b|free\s+product\b)\s*[-–—:]?\s*/i;
const FEE_WORDS =
  /\b(payment\s+fee|down-?payment|top-?up|gift\s+card|delivery|booking\s+fee|e-?wallet)\b/i;

export function detectVariant(name: string, category: string): string {
  if (/\bdiscount\b/i.test(category) || /^\s*\d+(\.\d+)?\s*%\s*on\b/i.test(name)) return "discount";
  if (/^\s*free\s+product\b/i.test(name)) return "free";
  if (FEE_WORDS.test(name)) return "fee";
  for (const rule of VARIANT_RULES) if (rule.test.test(name)) return rule.key;
  return "standard";
}

/* --- course family -------------------------------------------------------- */

/** Discounts and fees get their own buckets so they never distort a course family. */
export const DISCOUNT_FAMILY = "__discount__";
export const FEE_FAMILY = "__fee__";

export const FAMILY_LABELS: Record<string, Bilingual> = {
  [DISCOUNT_FAMILY]: { ar: "الخصومات", en: "Discounts" },
  [FEE_FAMILY]: { ar: "رسوم ودفعات", en: "Fees & payments" },
};

/**
 * Department prefixes ("Management - PMP - Event") are derived from the live
 * product-category tree rather than hardcoded, so a new department in Odoo is
 * picked up without a code change.
 */
export function buildDepartmentMatcher(categoryNames: string[]): RegExp | null {
  const leaves = new Set<string>();
  for (const full of categoryNames) {
    for (const part of full.split("/")) {
      const leaf = part.trim();
      // "All", "revenue" and similar roots are not department names.
      if (leaf.length >= 3 && !/^(all|revenue|saleable|miscellaneous)$/i.test(leaf))
        leaves.add(leaf);
    }
  }
  // Prefixes that appear in the product catalogue but not as a category.
  for (const extra of [
    "Graphic design",
    "Graphic Design",
    "Interior",
    "Management",
    "Technology",
  ]) {
    leaves.add(extra);
  }
  if (!leaves.size) return null;
  const escaped = [...leaves]
    .sort((a, b) => b.length - a.length)
    .map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^(?:${escaped.join("|")})\\s*[-–—]\\s*`, "i");
}

const stripCode = (name: string) => name.replace(/^\s*\[[^\]]*\]\s*/, "");

const normalizeKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

/** Removes the modality words so what remains is the course itself. */
function stripVariantWords(name: string): string {
  let out = name;
  for (const rule of VARIANT_RULES) out = out.replace(new RegExp(rule.test.source, "gi"), " ");
  return out
    .replace(/\(([^)]*)\)/g, " ")
    .replace(/\s*[-–—]\s*/g, " - ")
    .replace(/(^|\s)-+(\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function deriveFamily(
  name: string,
  department: RegExp | null,
  variantKey: string,
): { key: string; label: string } {
  if (variantKey === "discount")
    return { key: DISCOUNT_FAMILY, label: FAMILY_LABELS[DISCOUNT_FAMILY].en };
  if (variantKey === "fee") return { key: FEE_FAMILY, label: FAMILY_LABELS[FEE_FAMILY].en };

  let base = stripCode(name).replace(PROMO_PREFIX, "");
  // The department prefix has to go first, while the dashes that delimit it are
  // still intact — stripping variant words rewrites the separators.
  if (department) base = base.replace(department, "").trim();
  base = stripVariantWords(base);
  base = base.replace(/^[-–—\s]+|[-–—\s]+$/g, "").trim();
  if (!base) base = stripCode(name).trim();
  return { key: normalizeKey(base), label: base };
}

/** "CMRP", "PMP", "CFM" — a course code, as opposed to a word like "Interior". */
const ACRONYM = /^[A-Z][A-Z0-9&.]{2,7}$/;
const isAcronym = (label: string) => ACRONYM.test(label.trim());

/** All-caps course codes inside a label, used to spot "PMP or CFM" style names. */
const acronymsIn = (label: string): string[] =>
  label.split(/[^A-Za-z0-9&.]+/).filter((w) => ACRONYM.test(w));

/**
 * Merges the spelled-out form of a course into its course code: "CMRP" absorbs
 * "CMRP – Certified Maintenance & Reliability Professional", which are the same
 * course written two ways.
 *
 * Deliberately narrow. A plain-word prefix rule looks equivalent and is not — it
 * swallowed all eleven "Interior Design …" courses into one row called
 * "Interior", and every "Navisworks …" specialisation into "NavisWorks". So a
 * merge needs the short name to be an acronym AND the long name to mention no
 * other acronym, which keeps "PMP or CFM Exam Simulator" out of both PMP and CFM.
 */
export function buildFamilyAliases(
  families: { key: string; label: string }[],
): Map<string, string> {
  const byKey = new Map<string, string>();
  for (const f of families) if (f.key && !byKey.has(f.key)) byKey.set(f.key, f.label);

  const codes = [...byKey.entries()].filter(([, label]) => isAcronym(label));
  const alias = new Map<string, string>();

  for (const [longKey, longLabel] of byKey) {
    for (const [shortKey, shortLabel] of codes) {
      if (shortKey === longKey || !longKey.startsWith(shortKey + " ")) continue;
      const others = acronymsIn(longLabel).filter(
        (a) => a.toLowerCase() !== shortLabel.toLowerCase(),
      );
      if (others.length) continue;
      alias.set(longKey, shortKey);
      break;
    }
  }
  return alias;
}

/** Family heading, translated for the two synthetic buckets. */
export const familyLabel = (key: string, fallback: string, lang: "ar" | "en"): string =>
  FAMILY_LABELS[key]?.[lang] ?? fallback;
