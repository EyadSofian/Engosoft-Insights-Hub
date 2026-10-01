import { canonicalLossReason, LOSS_REASON_TAXONOMY } from "./loss-reason-taxonomy";
import type { HistoricalCrmDay } from "./crm-odoo.server";
import type { CrmLeadRow, LostRow } from "./types";

export interface FunnelFacts {
  leads: number;
  won: number;
  lost: number;
  noAnswer: number;
  replyKnown: number;
  freshLeads: number;
  freshWon: number;
  oldLeads: number;
  oldWon: number;
  turnaroundDaysSum: number;
  turnaroundSamples: number;
  lostReasons: Record<string, number>;
}

export interface FunnelCourse extends FunnelFacts {
  course: string;
}

export const emptyFunnel = (): FunnelFacts => ({
  leads: 0,
  won: 0,
  lost: 0,
  noAnswer: 0,
  replyKnown: 0,
  freshLeads: 0,
  freshWon: 0,
  oldLeads: 0,
  oldWon: 0,
  turnaroundDaysSum: 0,
  turnaroundSamples: 0,
  lostReasons: {},
});

export const rate = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? numerator / denominator : null;

export function addFunnel(target: FunnelFacts, value: FunnelFacts): void {
  for (const key of [
    "leads",
    "won",
    "lost",
    "noAnswer",
    "replyKnown",
    "freshLeads",
    "freshWon",
    "oldLeads",
    "oldWon",
    "turnaroundDaysSum",
    "turnaroundSamples",
  ] as const)
    target[key] += value[key];
  for (const [reason, count] of Object.entries(value.lostReasons))
    target.lostReasons[reason] = (target.lostReasons[reason] ?? 0) + count;
}

function taggedSegment(segment: string): "fresh" | "old" | "" {
  const value = segment.trim().toLowerCase();
  return value === "fresh" ? "fresh" : value === "old data" ? "old" : "";
}

function noAnswer(reply: string, reason: string): boolean {
  const answer = reply.trim().toLowerCase();
  return (
    answer === "not answer" ||
    answer === "no answer" ||
    canonicalLossReason(reason).canonicalReasonKey === "not_reached"
  );
}

function closeDays(createdAt: string, closedAt: string): number | null {
  if (!createdAt || !closedAt) return null;
  const days =
    (Date.parse(closedAt.slice(0, 10)) - Date.parse(createdAt.slice(0, 10))) / 86_400_000;
  return Number.isFinite(days) && days >= 0 ? days : null;
}

/** Creation-date cohort, deduplicated by the canonical Odoo lead id. */
export function funnelFromLive(crm: CrmLeadRow[], lost: LostRow[]): FunnelCourse[] {
  const courses = new Map<string, FunnelCourse>();
  const seen = new Set<string>();
  const add = (row: CrmLeadRow | LostRow, isLost: boolean) => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    const course = row.course || "غير محدد";
    const current = courses.get(course) ?? { ...emptyFunnel(), course };
    const isWon = !isLost && (row as CrmLeadRow).isWon;
    current.leads++;
    if (isWon) current.won++;
    if (isLost) {
      current.lost++;
      const key = canonicalLossReason(row.lossReason).canonicalReasonKey;
      current.lostReasons[key] = (current.lostReasons[key] ?? 0) + 1;
    }
    if (row.callingReply.trim()) current.replyKnown++;
    if (noAnswer(row.callingReply, isLost ? row.lossReason : "")) current.noAnswer++;
    const segment = taggedSegment(row.leadSegment);
    if (segment === "fresh") {
      current.freshLeads++;
      if (isWon) current.freshWon++;
    } else if (segment === "old") {
      current.oldLeads++;
      if (isWon) current.oldWon++;
    }
    if (isWon || isLost) {
      const closed = isLost
        ? (row as LostRow).closeDate || row.lostDate
        : (row as CrmLeadRow).closedAt || row.wonDate;
      const days = closeDays(row.createdAt, closed);
      if (days !== null) {
        current.turnaroundDaysSum += days;
        current.turnaroundSamples++;
      }
    }
    courses.set(course, current);
  };
  for (const row of crm) add(row, false);
  for (const row of lost) add(row, true);
  return [...courses.values()];
}

export function funnelFromHistory(rows: HistoricalCrmDay[]): FunnelCourse[] {
  const courses = new Map<string, FunnelCourse>();
  for (const row of rows) {
    const course = row.course || "غير محدد";
    const current = courses.get(course) ?? { ...emptyFunnel(), course };
    addFunnel(current, row);
    courses.set(course, current);
  }
  return [...courses.values()];
}

export function summarizeFunnel(courses: FunnelCourse[]) {
  const total = emptyFunnel();
  for (const row of courses) addFunnel(total, row);
  const reasons = Object.entries(total.lostReasons)
    .map(([key, count]) => ({
      key,
      label:
        LOSS_REASON_TAXONOMY.find((reason) => reason.key === key)?.ar ??
        (key === "unknown" ? "غير مسجل" : "أسباب أخرى"),
      count,
      share: rate(count, total.lost),
    }))
    .sort((a, b) => b.count - a.count);
  const courseRows = courses
    .map((row) => ({
      ...row,
      conversion: rate(row.won, row.leads),
      freshConversion: rate(row.freshWon, row.freshLeads),
      oldConversion: rate(row.oldWon, row.oldLeads),
      lostRate: rate(row.lost, row.leads),
      turnaroundDays: rate(row.turnaroundDaysSum, row.turnaroundSamples),
    }))
    .sort((a, b) => b.leads - a.leads);
  return {
    ...total,
    lostRate: rate(total.lost, total.leads),
    noAnswerRate: rate(total.noAnswer, total.leads),
    freshConversion: rate(total.freshWon, total.freshLeads),
    oldConversion: rate(total.oldWon, total.oldLeads),
    conversion: rate(total.won, total.leads),
    segmentCoverage: rate(total.freshLeads + total.oldLeads, total.leads),
    turnaroundDays: rate(total.turnaroundDaysSum, total.turnaroundSamples),
    reasons,
    courses: courseRows,
    topConversionCourse:
      [...courseRows]
        .filter((row) => row.leads >= 20)
        .sort((a, b) => (b.conversion ?? -1) - (a.conversion ?? -1))[0] ?? null,
    topFreshCourse:
      [...courseRows]
        .filter((row) => row.freshLeads >= 20)
        .sort((a, b) => (b.freshConversion ?? -1) - (a.freshConversion ?? -1))[0] ?? null,
  };
}
