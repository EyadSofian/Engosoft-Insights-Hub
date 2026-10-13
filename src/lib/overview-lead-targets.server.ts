import { matchMediaPlanCourse, type MonthlyMediaPlan } from "./media-plan";
import { authoritativeLostLeads, type FilteredData } from "./metrics.server";
import { countsAsPotentialLead } from "./lead-count-policy";
import type { GlobalFilters } from "./types";

export interface OverviewLeadGoal {
  actual: number | null;
  target: number | null;
  achievement: number | null;
}

export interface OverviewLeadTargets {
  month: string | null;
  status: MonthlyMediaPlan["status"] | null;
  reason: "no_single_month" | "no_plan" | "plan_unavailable" | "narrow_filter" | null;
  courses: OverviewLeadGoal;
  website: OverviewLeadGoal;
}

const emptyGoal = (): OverviewLeadGoal => ({ actual: null, target: null, achievement: null });
const rate = (actual: number, target: number): number | null =>
  target > 0 ? (actual / target) * 100 : null;

/**
 * The two monthly plan targets describe different axes: Odoo course category
 * and Odoo Website source. A Website lead tagged CFM can advance both cards;
 * the cards must not be summed. This matches the existing Media Plan report.
 * The selected date window controls actuals; the denominator remains the full
 * month's saved target, explicitly labelled that way in the cards.
 */
export function overviewLeadTargets(
  data: FilteredData,
  filters: GlobalFilters,
  plans: Record<string, MonthlyMediaPlan>,
  planError = "",
): OverviewLeadTargets {
  const month =
    filters.from && filters.to && filters.from.slice(0, 7) === filters.to.slice(0, 7)
      ? filters.from.slice(0, 7)
      : null;
  const base = {
    month,
    status: month ? (plans[month]?.status ?? null) : null,
    courses: emptyGoal(),
    website: emptyGoal(),
  };
  if (!month) return { ...base, reason: "no_single_month" };
  if (planError) return { ...base, reason: "plan_unavailable" };
  const plan = plans[month];
  if (!plan) return { ...base, reason: "no_plan" };

  const narrowFilter = Boolean(
    filters.company ||
    filters.platform ||
    filters.channel ||
    filters.account ||
    filters.campaign ||
    filters.campaignKey ||
    filters.adset ||
    filters.adsetKey ||
    filters.ad ||
    filters.adKey ||
    filters.source ||
    filters.course ||
    filters.mainCategory ||
    filters.salesTeam ||
    filters.salesperson,
  );
  if (narrowFilter) return { ...base, reason: "narrow_filter" };

  const records = new Map(
    [...data.crm, ...authoritativeLostLeads(data)].map((row) => [row.id, row]),
  );
  let courseActual = 0;
  let websiteActual = 0;
  for (const row of records.values()) {
    if (!countsAsPotentialLead(row.source)) continue;
    const website = row.sourceKey === "website";
    if (website) websiteActual++;
    if (matchMediaPlanCourse(plan.courses, row.course)) courseActual++;
  }
  const courseTarget = plan.paidLeadTarget;
  const websiteTarget = plan.additionalActivities
    .filter(
      (activity) => activity.metric === "leads" && activity.actualSource === "website_crm_leads",
    )
    .reduce((sum, activity) => sum + (activity.target ?? 0), 0);
  return {
    month,
    status: plan.status,
    reason: null,
    courses: {
      actual: courseActual,
      target: courseTarget,
      achievement: rate(courseActual, courseTarget),
    },
    website: {
      actual: websiteActual,
      target: websiteTarget || null,
      achievement: rate(websiteActual, websiteTarget),
    },
  };
}
