import { createFileRoute } from "@tanstack/react-router";
import {
  mediaPlanCourseKey,
  mediaPlanForMonth,
  mediaPlanMonths,
  plannedCourseBudget,
} from "@/lib/media-plan";
import type { CourseAgg } from "@/lib/types";

interface ActualCourse {
  spend: number;
  platformLeads: number | null;
  crmLeads: number;
  won: number;
  lost: number;
  revenueUsd: number;
  invoices: number;
}

const emptyActual = (): ActualCourse => ({
  spend: 0,
  platformLeads: null,
  crmLeads: 0,
  won: 0,
  lost: 0,
  revenueUsd: 0,
  invoices: 0,
});

const addActual = (target: ActualCourse, row: CourseAgg): void => {
  target.spend += row.spend;
  if (row.platformLeads !== null) {
    target.platformLeads = (target.platformLeads ?? 0) + row.platformLeads;
  }
  target.crmLeads += row.crmLeads;
  target.won += row.won;
  target.lost += row.lost;
  target.revenueUsd += row.revenue;
  target.invoices += row.invoices;
};

const divide = (top: number, bottom: number): number | null => (bottom > 0 ? top / bottom : null);

function monthWindow(month: string): { from: string; to: string; days: number } {
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(days).padStart(2, "0")}`, days };
}

function cairoDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function elapsedShare(from: string, to: string, days: number, today: string): number {
  if (today < from) return 0;
  if (today > to) return 1;
  return Math.min(1, Math.max(0, Number(today.slice(-2)) / days));
}

export const Route = createFileRoute("/api/media-plan")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { computeCourses, computeTotals, getFiltered } = await import("@/lib/metrics.server");
        const { parseFilters, json } = await import("@/lib/api.server");
        const { fxRatesFromFilters } = await import("@/lib/fx-rates");

        const query = new URL(request.url).searchParams;
        const requestedMonth = query.get("month") ?? undefined;
        const plan = mediaPlanForMonth(requestedMonth);
        const filters = await parseFilters(request);
        const window = monthWindow(plan.month);
        const scopedFilters = {
          ...filters,
          range: undefined,
          from: window.from,
          to: window.to,
          platform: undefined,
          channel: undefined,
          account: undefined,
          campaign: undefined,
          campaignKey: undefined,
          adset: undefined,
          adsetKey: undefined,
          ad: undefined,
          adKey: undefined,
          source: undefined,
          course: undefined,
          mainCategory: undefined,
          salesTeam: undefined,
          salesperson: undefined,
        } as const;

        const [data, organicData] = await Promise.all([
          getFiltered(scopedFilters),
          getFiltered({ ...scopedFilters, channel: "organic" }),
        ]);
        const courses = computeCourses(data);
        const totals = computeTotals(data);
        const organicTotals = computeTotals(organicData);
        const actualByKey = new Map<string, ActualCourse>();
        const unplanned: Array<{
          course: string;
          spend: number;
          platformLeads: number | null;
          crmLeads: number;
        }> = [];

        for (const course of courses) {
          const key = mediaPlanCourseKey(course.course || course.name);
          if (!key) {
            if (course.spend > 0 || (course.platformLeads ?? 0) > 0 || course.crmLeads > 0) {
              unplanned.push({
                course: course.course || course.name,
                spend: course.spend,
                platformLeads: course.platformLeads,
                crmLeads: course.crmLeads,
              });
            }
            continue;
          }
          const actual = actualByKey.get(key) ?? emptyActual();
          addActual(actual, course);
          actualByKey.set(key, actual);
        }

        const today = cairoDate();
        const elapsed = elapsedShare(window.from, window.to, window.days, today);
        const courseRows = plan.courses.map((target) => {
          const actual = actualByKey.get(target.key) ?? emptyActual();
          const actualLeads = actual.platformLeads ?? actual.crmLeads;
          const targetBudgetUsd = plannedCourseBudget(target);
          const achievement = divide(actualLeads, target.targetLeads);
          const expectedLeads = target.targetLeads * elapsed;
          const actualCpl = divide(actual.spend, actualLeads);
          const cplVariance =
            actualCpl === null ? null : divide(actualCpl - target.targetCpl, target.targetCpl);

          return {
            ...target,
            targetBudgetUsd,
            actual: {
              ...actual,
              actualLeads,
              leadBasis: actual.platformLeads === null ? "crm_fallback" : "platform",
              actualCpl,
              achievement,
              expectedLeads,
              expectedAchievement: elapsed,
              budgetUsed: divide(actual.spend, targetBudgetUsd),
              cplVariance,
            },
          };
        });

        const targetedSpend = courseRows.reduce((sum, row) => sum + row.actual.spend, 0);
        const targetedLeads = courseRows.reduce((sum, row) => sum + row.actual.actualLeads, 0);
        const targetedCrmLeads = courseRows.reduce((sum, row) => sum + row.actual.crmLeads, 0);
        const plannedCourseBudgetUsd = courseRows.reduce(
          (sum, row) => sum + row.targetBudgetUsd,
          0,
        );
        const fx = fxRatesFromFilters(filters);
        const additionalBudgetUsd = plan.additionalActivities.reduce(
          (sum, row) => sum + row.budgetUsd,
          0,
        );

        return json({
          plan: {
            ...plan,
            targetCpl: divide(plan.leadGenerationBudgetUsd, plan.paidLeadTarget),
            plannedCourseBudgetUsd,
            reserveBudgetUsd: plan.leadGenerationBudgetUsd - plannedCourseBudgetUsd,
            additionalBudgetUsd,
            totalMarketingBudgetUsd: plan.leadGenerationBudgetUsd + additionalBudgetUsd,
          },
          window: {
            ...window,
            today,
            elapsed,
            phase: today < window.from ? "upcoming" : today > window.to ? "complete" : "active",
          },
          actual: {
            targetedSpend,
            targetedLeads,
            targetedCrmLeads,
            targetedCpl: divide(targetedSpend, targetedLeads),
            paidLeadAchievement: divide(targetedLeads, plan.paidLeadTarget),
            organicWebinarLeads: organicTotals.totalLeads,
            organicAchievement: divide(organicTotals.totalLeads, plan.organicWebinarLeadTarget),
            allSpend: totals.spend,
            unattributedOrUnplannedSpend: Math.max(0, totals.spend - targetedSpend),
            revenueUsd: totals.revenue,
            revenueSar: totals.revenue * fx.SAR,
            salesAchievement: divide(totals.revenue * fx.SAR, plan.salesTargetSar),
          },
          courses: courseRows,
          unplanned: unplanned.sort((a, b) => b.spend - a.spend),
          availableMonths: mediaPlanMonths(),
          sources: [
            "ENGOSOFT Marketing Plan Aug 2026: lead, budget, sales and ownership targets",
            "July Media Plan and Media Buyers Plan: course CPL benchmarks",
          ],
          health: data.snapshot.health,
        });
      },
    },
  },
});
