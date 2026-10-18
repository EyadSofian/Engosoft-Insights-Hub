import { matchMediaPlanCourse, type MonthlyMediaPlan } from "./media-plan";
import type { CourseLeadRecord } from "./lead-course-distribution.server";
import { countsAsPotentialLead } from "./lead-count-policy";

export type MediaPlanLeadMatch = "course_category" | "source" | "plan_courses" | "unavailable";

export interface MediaPlanLeadDetailResponse {
  match: MediaPlanLeadMatch;
  total: number;
  filteredTotal: number;
  stages: Record<string, number>;
  rows: CourseLeadRecord[];
  page: number;
  pageSize: number;
  period: { from: string; to: string };
}

/** Keep platform delivery and Odoo records distinct: only Odoo fields link a record. */
export function mediaPlanLeadMatch(plan: MonthlyMediaPlan, key: string): MediaPlanLeadMatch {
  if (plan.courses.some((row) => row.key === key)) return "course_category";
  if (key === "paid-media-leads") return "plan_courses";
  const activity = plan.additionalActivities.find((row) => row.key === key);
  if (activity?.metric !== "leads") return "unavailable";
  if (
    activity.actualSource === "website_crm_leads" ||
    activity.actualSource === "webinar_crm_leads"
  )
    return "source";
  return "unavailable";
}

export function linkedMediaPlanLeads(
  plan: MonthlyMediaPlan,
  key: string,
  rows: CourseLeadRecord[],
): CourseLeadRecord[] {
  const match = mediaPlanLeadMatch(plan, key);
  const eligible = rows.filter((row) => countsAsPotentialLead(row.source, row.leadSegment));
  if (match === "course_category")
    return eligible.filter(
      (row) => row.verified && matchMediaPlanCourse(plan.courses, row.course)?.key === key,
    );
  if (match === "plan_courses")
    return eligible.filter(
      (row) => row.verified && Boolean(matchMediaPlanCourse(plan.courses, row.course)),
    );
  if (match === "source") {
    const activity = plan.additionalActivities.find((row) => row.key === key);
    const source = activity?.actualSource === "website_crm_leads" ? "Website" : "Webinar";
    return eligible.filter((row) => row.source.trim().toLowerCase() === source.toLowerCase());
  }
  return [];
}
