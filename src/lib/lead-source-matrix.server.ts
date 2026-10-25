import { loadLeadCourseRecords, type CourseLeadRecord } from "./lead-course-distribution.server";
import { buildLeadSourceMatrix, matrixSource, type SourceMatrix } from "./lead-source-matrix";
import { OCTOBER_2026_SOURCE } from "./media-plan";
import { loadMediaPlanSource } from "./media-plans.server";
import type { GlobalFilters } from "./types";

export interface LeadSourceMatrixResponse extends SourceMatrix {
  detail: { rows: CourseLeadRecord[]; total: number; page: number; pageSize: number } | null;
  period: { from: string; to: string };
  fetchedAt: string;
  sixDayPlan: {
    month: string;
    status: "approved" | "draft";
    workingDays: number;
    total: number;
    courses: { label: string; target: number }[];
  } | null;
}

export async function loadLeadSourceMatrix(
  filters: GlobalFilters,
  detail?: { source: string; course?: string; page: number },
): Promise<LeadSourceMatrixResponse> {
  const [records, plans] = await Promise.all([
    loadLeadCourseRecords(filters),
    filters.from?.startsWith("2026-10") && filters.to?.startsWith("2026-10")
      ? loadMediaPlanSource().catch(() => null)
      : Promise.resolve(null),
  ]);
  const matrix = buildLeadSourceMatrix(records);
  const matches = detail
    ? records
        .filter(
          (record) =>
            matrixSource(record.source) === detail.source &&
            (!detail.course || (record.course || "غير محدد") === detail.course),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    : null;
  const pageSize = 50;
  const plan = plans?.plans["2026-10"];
  const sixDayCourses =
    plan?.courses.map((course) => ({
      label: course.label,
      target: Math.round((course.targetLeads * 6) / OCTOBER_2026_SOURCE.workingDays),
    })) ?? [];
  return {
    ...matrix,
    detail: matches
      ? {
          rows: matches.slice((detail!.page - 1) * pageSize, detail!.page * pageSize),
          total: matches.length,
          page: detail!.page,
          pageSize,
        }
      : null,
    period: { from: filters.from || "", to: filters.to || "" },
    fetchedAt: new Date().toISOString(),
    sixDayPlan: plan
      ? {
          month: plan.month,
          status: plan.status,
          workingDays: OCTOBER_2026_SOURCE.workingDays,
          total: sixDayCourses.reduce((sum, course) => sum + course.target, 0),
          courses: sixDayCourses,
        }
      : null,
  };
}
