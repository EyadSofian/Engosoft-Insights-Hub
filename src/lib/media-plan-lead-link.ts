import { matchMediaPlanCourse, type MonthlyMediaPlan } from "./media-plan";
import type { CourseLeadRecord } from "./lead-course-distribution.server";

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
  if (match === "course_category")
    return rows.filter(
      (row) => row.verified && matchMediaPlanCourse(plan.courses, row.course)?.key === key,
    );
  if (match === "plan_courses")
    return rows.filter(
      (row) => row.verified && Boolean(matchMediaPlanCourse(plan.courses, row.course)),
    );
  if (match === "source") {
    const activity = plan.additionalActivities.find((row) => row.key === key);
    const source = activity?.actualSource === "website_crm_leads" ? "Website" : "Webinar";
    return rows.filter((row) => row.source === source);
  }
  return [];
}
