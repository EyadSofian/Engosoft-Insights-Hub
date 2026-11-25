import { canonicalLossReason } from "./loss-reason-taxonomy";

/** Current owner is a snapshot field, never evidence of assignment or contact history. */
export const LEAD_OWNERSHIP_INTERPRETATION = {
  ar: "غياب المسؤول الحالي لا يثبت أن الليد لم يُوزَّع أو لم يتم الاتصال به. Lost بسبب مكرر سجل مكرر مسجّل، وليس إثبات ضياع عميل جديد بسبب السيلز. التكرار المحتمل بالهوية إشارة مراجعة منفصلة؛ لا تجمعه مع سبب مكرر. لا تُثبت جودة الليد أو تقصير البائع أو مكسب تغيير التوزيع من مقارنة نسب مجمعة بدون تطابق الفترة والكورس والمصدر ودليل التواصل.",
  en: "Missing current owner does not prove never-assigned or never-contacted. A Lost reason of duplicate is a recorded duplicate, not proof a new customer was lost by sales. Identity-based duplicate candidates are a separate review signal and must not be added to duplicate reasons. Aggregate rate comparisons do not establish lead quality, seller fault or gains from reassignment without matched periods, course/source mix and contact evidence.",
} as const;

export function currentOwnerMissing(name: string | null | undefined): boolean {
  const value = (name ?? "").trim();
  return !value || ["—", "-", "–"].includes(value);
}

export function buildLeadOwnershipAudit(
  rows: readonly { id: string; salesperson: string; status: string; lossReason: string }[],
) {
  const seen = new Set<string>();
  const records = rows.filter((row) => {
    if (!row.id || seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
  const missing = records.filter((row) => currentOwnerMissing(row.salesperson));
  const losses = missing.filter((row) => row.status === "lost");
  const duplicateLosses = losses.filter(
    (row) => canonicalLossReason(row.lossReason).canonicalReasonKey === "duplicate",
  );
  return {
    contract: "current-owner-snapshot-v1",
    totalRecords: records.length,
    currentOwnerMissing: missing.length,
    currentOwnerMissingLost: losses.length,
    currentOwnerMissingRecordedDuplicateLost: duplicateLosses.length,
    currentOwnerMissingOtherLost: losses.length - duplicateLosses.length,
    currentOwnerMissingOpenOrLead: missing.filter((row) => ["lead", "open"].includes(row.status))
      .length,
    currentOwnerMissingWon: missing.filter((row) => row.status === "won").length,
    // Absence is not a measured zero. These verdicts need a separate evidence source.
    neverAssigned: null,
    neverContacted: null,
    lostBecauseUnassigned: null,
    interpretation: LEAD_OWNERSHIP_INTERPRETATION,
  };
}
