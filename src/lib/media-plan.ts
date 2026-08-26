export type MediaPlanStatus = "approved" | "draft";

export interface MediaPlanCourseTarget {
  key: "cfm" | "interior" | "pmp" | "cmrp" | "bim" | "automotive";
  label: string;
  targetLeads: number;
  targetCpl: number;
  owners: string[];
}

export interface MediaPlanActivityBudget {
  key: "website" | "webinar" | "youtube" | "branding";
  label: string;
  budgetUsd: number;
}

export interface MonthlyMediaPlan {
  month: string;
  status: MediaPlanStatus;
  basisMonth?: string;
  leadTarget: number;
  paidLeadTarget: number;
  organicWebinarLeadTarget: number;
  leadGenerationBudgetUsd: number;
  salesTargetSar: number;
  courses: MediaPlanCourseTarget[];
  additionalActivities: MediaPlanActivityBudget[];
}

const AUGUST_COURSES: MediaPlanCourseTarget[] = [
  { key: "cfm", label: "CFM", targetLeads: 1_000, targetCpl: 7, owners: ["Sayed"] },
  {
    key: "interior",
    label: "Interior / Decor",
    targetLeads: 1_000,
    targetCpl: 3.5,
    owners: ["Shazly", "Sayed"],
  },
  { key: "pmp", label: "PMP", targetLeads: 500, targetCpl: 6, owners: ["Sayed"] },
  { key: "cmrp", label: "CMRP", targetLeads: 500, targetCpl: 5, owners: ["Sayed"] },
  {
    key: "bim",
    label: "BIM",
    targetLeads: 500,
    targetCpl: 3.5,
    owners: ["Shazly", "Sayed"],
  },
  {
    key: "automotive",
    label: "Automotive",
    targetLeads: 500,
    targetCpl: 3.5,
    owners: ["Shazly"],
  },
];

const ADDITIONAL_ACTIVITIES: MediaPlanActivityBudget[] = [
  { key: "website", label: "Website campaigns", budgetUsd: 3_000 },
  { key: "webinar", label: "Webinar promotion", budgetUsd: 500 },
  { key: "youtube", label: "YouTube", budgetUsd: 250 },
  { key: "branding", label: "Social media branding", budgetUsd: 250 },
];

const basePlan = (
  month: string,
  status: MediaPlanStatus,
  basisMonth?: string,
): MonthlyMediaPlan => ({
  month,
  status,
  basisMonth,
  leadTarget: 5_000,
  paidLeadTarget: 4_000,
  organicWebinarLeadTarget: 1_000,
  leadGenerationBudgetUsd: 20_000,
  salesTargetSar: 150_000,
  courses: AUGUST_COURSES.map((row) => ({ ...row, owners: [...row.owners] })),
  additionalActivities: ADDITIONAL_ACTIVITIES.map((row) => ({ ...row })),
});

/**
 * August is the approved source plan. September intentionally starts as a
 * visible draft copied from that baseline until management publishes revised
 * targets; the UI never presents copied numbers as approved September facts.
 */
export const MEDIA_PLANS: Record<string, MonthlyMediaPlan> = {
  "2026-08": basePlan("2026-08", "approved"),
  "2026-09": basePlan("2026-09", "draft", "2026-08"),
};

export const mediaPlanMonths = (): string[] =>
  Object.keys(MEDIA_PLANS).sort((a, b) => b.localeCompare(a));

export function mediaPlanForMonth(month?: string): MonthlyMediaPlan {
  const selected = (month && MEDIA_PLANS[month]) || MEDIA_PLANS[mediaPlanMonths()[0]];
  return {
    ...selected,
    courses: selected.courses.map((row) => ({ ...row, owners: [...row.owners] })),
    additionalActivities: selected.additionalActivities.map((row) => ({ ...row })),
  };
}

export function plannedCourseBudget(row: MediaPlanCourseTarget): number {
  return row.targetLeads * row.targetCpl;
}

const normalized = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Maps live dashboard course labels to the six course targets in the plan. */
export function mediaPlanCourseKey(value: string): MediaPlanCourseTarget["key"] | null {
  const key = normalized(value);
  if (/\bcfm\b|facility management/.test(key)) return "cfm";
  if (/\bcmrp\b|maintenance/.test(key)) return "cmrp";
  if (/\binterior\b|\bdecor\b/.test(key)) return "interior";
  if (/\bpmp\b/.test(key)) return "pmp";
  if (/\bbim\b/.test(key)) return "bim";
  if (/\bautomotive\b|\bauto\b/.test(key)) return "automotive";
  return null;
}
