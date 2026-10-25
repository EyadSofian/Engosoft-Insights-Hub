/**
 * Lost Archive is a human audit of Lost records, not a CRM acquisition cohort.
 * The three Validation tabs repeat the No rows from the primary month tabs;
 * the direct read-only Google Sheets request reads Aug/Sep/Oct only. No phone or name leaves this
 * module in the API response.
 */
export type ArchiveRow = Record<string, string>;

export type AuditGroup = {
  name: string;
  total: number;
  review: number;
  approved: number;
  reviewPct: number;
};

export type AuditSummary = {
  total: number;
  approved: number;
  review: number;
  reviewPct: number;
  missingClosedDate: number;
  missingCreatedDate: number;
  missingCampaign: number;
  reasons: AuditGroup[];
  courses: AuditGroup[];
  salespeople: AuditGroup[];
  campaigns: AuditGroup[];
};

export type LostArchiveAuditResult = {
  source: "Lost Archive Google Sheet";
  sourceUrl: string;
  status: "success" | "failed" | "never";
  syncedAt: string;
  rowCount: number;
  selectedMonth: string;
  selectedCourse: string;
  selectedSalesperson: string;
  months: { key: string; label: string; total: number; review: number }[];
  courseOptions: string[];
  salespersonOptions: string[];
  all: AuditSummary;
  selected: AuditSummary;
  caveat: string;
};

export const LOST_ARCHIVE_SHEET_ID = "1r_KWVc-uUpj0xiNsq9hQgfyh83C52k3diDhsq6rrxWw";
export const LOST_ARCHIVE_URL = `https://docs.google.com/spreadsheets/d/${LOST_ARCHIVE_SHEET_ID}/edit`;

const MONTHS = [
  { key: "2026-08", sheet: "Aug", label: "أغسطس ٢٠٢٦" },
  { key: "2026-09", sheet: "Sep", label: "سبتمبر ٢٠٢٦" },
  { key: "2026-10", sheet: "Oct", label: "أكتوبر ٢٠٢٦" },
] as const;

export function archiveMonth(row: ArchiveRow): string {
  return MONTHS.find((month) => month.sheet === row.__sheet_month)?.key ?? "";
}

const clean = (value: string | undefined) => (value ?? "").trim().replace(/\s+/g, " ");
const norm = (value: string) => clean(value).toLocaleLowerCase().replace(/[أإآ]/g, "ا");

export function reasonCategory(raw: string): string {
  const value = norm(raw);
  if (!value) return "سبب غير مسجل";
  if (/duplicate|مكرر|تكرار|متكرر/.test(value)) return "مكرر";
  if (/no answer|not reached|unreachable|لا يرد|لم يرد|غير متاح|مغلق|لا يمكن الوصول/.test(value))
    return "لا يرد / تعذّر الوصول";
  if (/not interested|no interest|غير مهتم|عدم اهتمام/.test(value)) return "غير مهتم";
  if (/budget|price|سعر|ميزاني|تكلف/.test(value)) return "سعر / ميزانية";
  if (/not qualified|unqualified|غير مؤهل|غير مناسب|wrong data|رقم خطا|رقم غلط/.test(value))
    return "غير مؤهل / بيانات غير صحيحة";
  if (/competitor|شركة اخرى|شركه اخرى|منافس/.test(value)) return "منافس / شركة أخرى";
  if (/postpon|تاجيل|تأجيل|لاحق/.test(value)) return "تأجيل";
  if (/didn.t register|لم يسجل|لم يكمل/.test(value)) return "لم يسجل";
  return "أسباب أخرى";
}

function groups(rows: ArchiveRow[], name: (row: ArchiveRow) => string): AuditGroup[] {
  const result = new Map<string, AuditGroup>();
  for (const row of rows) {
    const label = clean(name(row)) || "غير محدد";
    const entry = result.get(label) ?? {
      name: label,
      total: 0,
      review: 0,
      approved: 0,
      reviewPct: 0,
    };
    entry.total++;
    if (norm(row.Validate) === "no") entry.review++;
    else entry.approved++;
    result.set(label, entry);
  }
  return [...result.values()]
    .map((entry) => ({ ...entry, reviewPct: entry.total ? (entry.review / entry.total) * 100 : 0 }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

export function summarizeArchive(rows: ArchiveRow[]): AuditSummary {
  const valid = rows.filter(
    (row) => archiveMonth(row) && ["yes", "no"].includes(norm(row.Validate)),
  );
  const review = valid.filter((row) => norm(row.Validate) === "no").length;
  return {
    total: valid.length,
    approved: valid.length - review,
    review,
    reviewPct: valid.length ? (review / valid.length) * 100 : 0,
    missingClosedDate: valid.filter((row) => !clean(row["Closed Date"])).length,
    missingCreatedDate: valid.filter((row) => !clean(row["Created on"])).length,
    missingCampaign: valid.filter((row) => !clean(row["Campaign Name"])).length,
    reasons: groups(valid, (row) => reasonCategory(row["Lost Reason"])),
    courses: groups(valid, (row) => row["Course Categories"]),
    salespeople: groups(valid, (row) => row.Salesperson),
    campaigns: groups(valid, (row) => row["Campaign Name"]),
  };
}

export function buildLostArchiveAudit(
  rows: ArchiveRow[],
  options: {
    month?: string;
    course?: string;
    salesperson?: string;
    status: "success" | "failed" | "never";
    syncedAt: string;
  },
): LostArchiveAuditResult {
  const primary = rows.filter(
    (row) => archiveMonth(row) && ["yes", "no"].includes(norm(row.Validate)),
  );
  const selectedMonth = MONTHS.some((item) => item.key === options.month)
    ? options.month!
    : "2026-10";
  const monthRows = primary.filter((row) => archiveMonth(row) === selectedMonth);
  const courseOptions = groups(monthRows, (row) => row["Course Categories"]).map(
    (group) => group.name,
  );
  const salespersonOptions = groups(monthRows, (row) => row.Salesperson).map((group) => group.name);
  const selectedCourse = courseOptions.includes(options.course ?? "") ? options.course! : "";
  const selectedSalesperson = salespersonOptions.includes(options.salesperson ?? "")
    ? options.salesperson!
    : "";
  const selectedRows = monthRows.filter(
    (row) =>
      (!selectedCourse || clean(row["Course Categories"]) === selectedCourse) &&
      (!selectedSalesperson || clean(row.Salesperson) === selectedSalesperson),
  );
  return {
    source: "Lost Archive Google Sheet",
    sourceUrl: LOST_ARCHIVE_URL,
    status: options.status,
    syncedAt: options.syncedAt,
    rowCount: primary.length,
    selectedMonth,
    selectedCourse,
    selectedSalesperson,
    months: MONTHS.map(({ key, label }) => {
      const summary = summarizeArchive(primary.filter((row) => archiveMonth(row) === key));
      return { key, label, total: summary.total, review: summary.review };
    }),
    courseOptions,
    salespersonOptions,
    all: summarizeArchive(primary),
    selected: summarizeArchive(selectedRows),
    caveat:
      "التبويبات الشهرية هنا مراجعة لسجلات Lost، وليست Cohort لليدز الجديدة ولا معدل Lost من كل الليدز. Validate=No يعني قرار الإغلاق أو سببه يحتاج مراجعة، وليس أن الليد Fresh أو غير مؤهل. الشيت لا يحتوي نوع السجل Lead/Opportunity أو CRM ID، لذلك لا ندمج هذه الأعداد مع مؤشرات أودو.",
  };
}
