/**
 * Canonical loss reasons.
 *
 * Odoo carries the same reason in two languages and several spellings: the
 * live Lost dataset holds `غير مهتم` (6,595) next to `Not Interested` (231),
 * `لم يسجل` next to `Didn't Register`, `ليد مكرر` / `العميل مكرر` / `Duplicate`.
 * Charts ranked on the raw text split one reason into several bars.
 *
 * Every chart and ranking groups by `canonicalReasonKey`. Drill-downs keep
 * `rawReason` so the original Odoo value stays auditable. Nothing is dropped:
 * an empty reason is `unknown`, a reason no rule recognises is `other` and
 * keeps its raw text.
 *
 * A synonym is added here only when the two values mean the same thing. Close
 * but different reasons (a wrong number vs a number that cannot be reached;
 * an unsuitable attendance mode vs a location) stay separate keys.
 */

export interface CanonicalLossReason {
  canonicalReasonKey: string;
  canonicalReasonLabelAr: string;
  canonicalReasonLabelEn: string;
  rawReason: string;
}

interface TaxonomyEntry {
  key: string;
  ar: string;
  en: string;
  /** Values compared after `normalizeReasonText`. */
  synonyms: string[];
}

export const LOSS_REASON_UNKNOWN_KEY = "unknown";
export const LOSS_REASON_OTHER_KEY = "other";

export const LOSS_REASON_TAXONOMY: readonly TaxonomyEntry[] = [
  {
    key: "not_interested",
    ar: "غير مهتم",
    en: "Not interested",
    synonyms: ["غير مهتم", "not interested", "مش مهتم"],
  },
  {
    key: "not_reached",
    ar: "لم يتم الوصول للعميل / لا يرد",
    en: "Not reached / no answer",
    synonyms: [
      "not reached",
      "no answer",
      "لا يرد",
      "العميل لا يرد",
      "العميل لا يرد وعدد محاولات الاتصال أكثر من اربع محاولات",
    ],
  },
  {
    key: "unreachable_number",
    ar: "الرقم لا يمكن الاتصال به",
    en: "Number cannot be reached",
    synonyms: [
      "الرقم لايمكن الاتصال به ولا يوجد واتس اب",
      "الرقم لا يمكن الاتصال به ولا يوجد واتس اب",
    ],
  },
  {
    key: "wrong_number",
    ar: "رقم خطأ",
    en: "Wrong number",
    synonyms: ["رقم خطأ", "رقم خاطئ", "رقم غلط", "wrong number"],
  },
  {
    key: "did_not_register",
    ar: "لم يسجل",
    en: "Did not register",
    synonyms: ["لم يسجل", "didn't register", "did not register", "not registered"],
  },
  {
    key: "registered_with_competitor",
    ar: "سجل في شركة أخرى",
    en: "Registered with a competitor",
    synonyms: ["سجل في شركة أخرى", "registered with competitor", "registered with a competitor"],
  },
  {
    key: "not_qualified",
    ar: "العميل غير مؤهل",
    en: "Not qualified",
    synonyms: ["العميل غير مؤهل", "غير مؤهل", "not qualified", "unqualified"],
  },
  {
    key: "budget_low",
    ar: "ميزانية العميل أقل من السعر",
    en: "Budget below price",
    synonyms: ["ميزانية العميل أقل من السعر", "budget low", "low budget"],
  },
  {
    key: "duplicate",
    ar: "ليد مكرر",
    en: "Duplicate lead",
    synonyms: ["ليد مكرر", "العميل مكرر", "duplicate", "duplicated"],
  },
  {
    key: "attendance_mode_unsuitable",
    ar: "طريقة الحضور غير مناسبة",
    en: "Attendance mode unsuitable",
    synonyms: ["طريقة الحضور غير مناسبة"],
  },
  { key: "location", ar: "الموقع", en: "Location", synonyms: ["location", "الموقع"] },
  {
    key: "job_seeker",
    ar: "يبحث عن عمل",
    en: "Looking for a job",
    synonyms: ["يبحث عن عمل", "need job", "needs job"],
  },
  {
    key: "refused_further_contact",
    ar: "رفض التواصل مرة أخرى",
    en: "Refused further contact",
    synonyms: ["العميل رفض التواصل مرة اخري", "رفض التواصل"],
  },
  {
    key: "other_specialization",
    ar: "تخصص آخر",
    en: "Other specialization",
    synonyms: ["تخصص اخر"],
  },
  {
    key: "other_certificate",
    ar: "شهادة أخرى",
    en: "Other certificate",
    synonyms: ["شهادات أخري", "شهادة اخرى"],
  },
  {
    key: "language_barrier",
    ar: "اللغة",
    en: "Language",
    synonyms: ["لا يتحدث العربية", "language", "محتوى بلغة مختلفة"],
  },
  {
    key: "wants_free_courses",
    ar: "يريد دورات مجانية",
    en: "Wants free courses",
    synonyms: ["محتاج دورات مجانية"],
  },
  {
    key: "already_subscribed",
    ar: "مشترك بالفعل",
    en: "Already subscribed",
    synonyms: ["العميل مشترك بالفعل"],
  },
  {
    key: "wants_diploma",
    ar: "يريد دراسة دبلوم",
    en: "Wants a diploma",
    synonyms: ["محتاج دراسه دبلوم"],
  },
  { key: "lost_broadcast", ar: "حملة بث", en: "Lost broadcast", synonyms: ["lost broadcast"] },
  { key: "age", ar: "العمر", en: "Age", synonyms: ["age"] },
];

const UNKNOWN_LABEL = { ar: "غير مسجل", en: "Not recorded" };
const OTHER_LABEL = { ar: "أخرى", en: "Other" };

/**
 * Comparison form: Arabic letter variants and diacritics folded, a bracketed
 * placeholder (`تخصص اخر (اسم التخصص)`) dropped, apostrophes removed, and
 * everything else reduced to single-spaced letters and digits.
 */
export function normalizeReasonText(value: string): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .toLocaleLowerCase("en")
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const BY_SYNONYM = new Map<string, TaxonomyEntry>();
for (const entry of LOSS_REASON_TAXONOMY) {
  for (const synonym of [entry.ar, entry.en, ...entry.synonyms]) {
    const normalized = normalizeReasonText(synonym);
    if (normalized && !BY_SYNONYM.has(normalized)) BY_SYNONYM.set(normalized, entry);
  }
}

export function canonicalLossReason(raw: string): CanonicalLossReason {
  const rawReason = String(raw ?? "").trim();
  if (!rawReason) {
    return {
      canonicalReasonKey: LOSS_REASON_UNKNOWN_KEY,
      canonicalReasonLabelAr: UNKNOWN_LABEL.ar,
      canonicalReasonLabelEn: UNKNOWN_LABEL.en,
      rawReason,
    };
  }
  const entry = BY_SYNONYM.get(normalizeReasonText(rawReason));
  return entry
    ? {
        canonicalReasonKey: entry.key,
        canonicalReasonLabelAr: entry.ar,
        canonicalReasonLabelEn: entry.en,
        rawReason,
      }
    : {
        canonicalReasonKey: LOSS_REASON_OTHER_KEY,
        canonicalReasonLabelAr: OTHER_LABEL.ar,
        canonicalReasonLabelEn: OTHER_LABEL.en,
        rawReason,
      };
}

export function lossReasonLabel(key: string): { ar: string; en: string } {
  if (key === LOSS_REASON_UNKNOWN_KEY) return UNKNOWN_LABEL;
  if (key === LOSS_REASON_OTHER_KEY) return OTHER_LABEL;
  const entry = LOSS_REASON_TAXONOMY.find((item) => item.key === key);
  return entry ? { ar: entry.ar, en: entry.en } : { ar: key, en: key };
}

export interface CanonicalReasonGroup {
  canonicalReasonKey: string;
  canonicalReasonLabelAr: string;
  canonicalReasonLabelEn: string;
  count: number;
  /** Share of all rows, 0–100. */
  share: number;
  /** Every raw Odoo spelling folded into this reason, most frequent first. */
  rawReasons: { rawReason: string; count: number }[];
}

/** Groups rows by canonical reason. Totals always equal the input length. */
export function groupByCanonicalReason<T>(
  rows: readonly T[],
  reasonOf: (row: T) => string,
): CanonicalReasonGroup[] {
  const groups = new Map<
    string,
    { reason: CanonicalLossReason; count: number; raw: Map<string, number> }
  >();
  for (const row of rows) {
    const reason = canonicalLossReason(reasonOf(row));
    const group = groups.get(reason.canonicalReasonKey) ?? {
      reason,
      count: 0,
      raw: new Map<string, number>(),
    };
    group.count += 1;
    group.raw.set(reason.rawReason, (group.raw.get(reason.rawReason) ?? 0) + 1);
    groups.set(reason.canonicalReasonKey, group);
  }
  const total = rows.length;
  return [...groups.values()]
    .map(({ reason, count, raw }) => ({
      canonicalReasonKey: reason.canonicalReasonKey,
      canonicalReasonLabelAr: reason.canonicalReasonLabelAr,
      canonicalReasonLabelEn: reason.canonicalReasonLabelEn,
      count,
      share: total > 0 ? (count / total) * 100 : 0,
      rawReasons: [...raw.entries()]
        .map(([rawReason, n]) => ({ rawReason, count: n }))
        .sort((a, b) => b.count - a.count || a.rawReason.localeCompare(b.rawReason)),
    }))
    .sort((a, b) => b.count - a.count || a.canonicalReasonKey.localeCompare(b.canonicalReasonKey));
}
