import { canonicalCourseValue, normalizeCourseKey } from "./course-taxonomy";

export const INTERIOR_REPORT_COURSES = {
  online: "Interior · Online",
  offline: "Interior · Offline",
  unattributed: "Interior · Unattributed",
} as const;
export type InteriorDelivery = keyof typeof INTERIOR_REPORT_COURSES;
export interface DailyCourseEvidence {
  course: string;
  campaign?: string;
  campaignKey?: string;
  reportCourse?: string;
}
export function dailyBaseCourse(course: string): string {
  return Object.values(INTERIOR_REPORT_COURSES).some(
    (label) => normalizeCourseKey(label) === normalizeCourseKey(course),
  )
    ? "Interior"
    : canonicalCourseValue(course) || course.trim() || "Unclassified";
}

/** Owner-confirmed naming rule: standalone off/offline token, not offer/office.
 * A missing or unrelated campaign is unknown, never automatically Online.
 */
export function interiorCampaignDelivery(campaign: string): InteriorDelivery {
  const name = campaign.normalize("NFKC").trim().toLowerCase().replace(/[‐-―]/g, "-");
  if (!/^(?:interior|nterior)(?:[\s_-]|$)/.test(name)) return "unattributed";
  return /(?:^|[\s_-])off(?:line)?(?:$|[\s_-])/.test(name) ? "offline" : "online";
}

export function interiorCampaignLookup(rows: readonly DailyCourseEvidence[]) {
  const evidence = new Map<string, Set<InteriorDelivery>>();
  for (const row of rows) {
    if (dailyBaseCourse(row.course) !== "Interior" || !row.campaignKey || !row.campaign) continue;
    const modes = evidence.get(row.campaignKey) || new Set<InteriorDelivery>();
    modes.add(interiorCampaignDelivery(row.campaign));
    evidence.set(row.campaignKey, modes);
  }
  return new Map(
    [...evidence].map(([key, modes]) => [
      key,
      modes.size === 1 ? [...modes][0] : ("unattributed" as InteriorDelivery),
    ]),
  );
}

export function classifyDailyCourse<T extends DailyCourseEvidence>(
  row: T,
  lookup: ReadonlyMap<string, InteriorDelivery>,
): T & { reportCourse: string } {
  const base = dailyBaseCourse(row.course);
  if (base !== "Interior") return { ...row, reportCourse: base };
  const mode = row.campaign?.trim()
    ? interiorCampaignDelivery(row.campaign)
    : lookup.get(row.campaignKey || "") || "unattributed";
  return { ...row, reportCourse: INTERIOR_REPORT_COURSES[mode] };
}
export const dailyReportCourse = (row: { course: string; reportCourse?: string }) =>
  row.reportCourse || row.course;
export function dailyCourseLabel(course: string, ar = false): string {
  const mode = (Object.entries(INTERIOR_REPORT_COURSES) as [InteriorDelivery, string][]).find(
    ([, value]) => value === course,
  )?.[0];
  if (!mode) return course;
  return ar
    ? `ديكور · ${{ online: "أونلاين", offline: "أوفلاين", unattributed: "غير منسوب" }[mode]}`
    : course;
}
