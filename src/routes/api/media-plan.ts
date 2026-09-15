import { createFileRoute } from "@tanstack/react-router";
import {
  matchMediaPlanCourse,
  plannedCourseBudget,
  type MediaPlanDeliverable,
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

interface DeliverableDelivery {
  key: string;
  label: string;
  category: MediaPlanDeliverable["category"];
  metric: MediaPlanDeliverable["metric"];
  target: number;
  unit: string;
  actual: number | null;
  connected: boolean;
  actualSource: string;
  dateScope: string;
  matchingRule: string;
  reportTo: string;
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
        const { loadMediaPlanSource } = await import("@/lib/media-plans.server");
        const { writesEnabled, ssoConfigured, adminCodeConfigured, authorizeWrite } =
          await import("@/lib/admin-auth.server");

        const query = new URL(request.url).searchParams;
        const requestedMonth = query.get("month") ?? undefined;
        const source = await loadMediaPlanSource();
        const availableMonths = Object.keys(source.plans).sort((a, b) => b.localeCompare(a));
        const selectedMonth =
          (requestedMonth && source.plans[requestedMonth] ? requestedMonth : "") ||
          availableMonths[0];
        const plan = source.plans[selectedMonth];
        const guard = authorizeWrite(request);
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

        const [data, organicData, websiteData, webinarData] = await Promise.all([
          getFiltered(scopedFilters),
          getFiltered({ ...scopedFilters, channel: "organic" }),
          getFiltered({ ...scopedFilters, source: "Website" }),
          getFiltered({ ...scopedFilters, source: "Webinar" }),
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
          const target = matchMediaPlanCourse(plan.courses, course.course, course.name);
          if (!target) {
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
          const actual = actualByKey.get(target.key) ?? emptyActual();
          addActual(actual, course);
          actualByKey.set(target.key, actual);
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
        const additionalBudgetUsd = plan.additionalActivities.reduce(
          (sum, row) => sum + row.budgetUsd,
          0,
        );

        const dateScope = `${window.from} → ${window.to}`;
        const websiteLeads = computeTotals(websiteData).totalLeads;
        const webinarLeads = computeTotals(webinarData).totalLeads;
        const paidPlatformLeads = data.ads
          .filter((row) => row.objective === "leads")
          .reduce((sum, row) => sum + (row.platformLeads ?? 0), 0);
        const sourceForDeliverable = (deliverable: {
          actualSource?: string;
          metric?: MediaPlanDeliverable["metric"];
        }) => {
          switch (deliverable.actualSource) {
            case "website_crm_leads":
              return {
                actual: websiteLeads,
                connected: true,
                actualSource: "Odoo CRM · Source=Website",
                matchingRule: "Source exactly equals Website; active CRM + canonical Lost rows.",
                reportTo: "/website",
              };
            case "webinar_crm_leads":
              return {
                actual: webinarLeads,
                connected: true,
                actualSource: "Odoo CRM · Source=Webinar",
                matchingRule: "Source exactly equals Webinar; active CRM + canonical Lost rows.",
                reportTo: "/leads",
              };
            case "creative_catalog":
              return {
                actual: data.snapshot.creatives.length,
                connected: data.snapshot.creatives.length > 0,
                actualSource: "Canonical creative catalog",
                matchingRule: "Creative catalog rows available in the selected plan snapshot.",
                reportTo: "/creatives",
              };
            case "paid_media_platform_leads":
              return {
                actual: paidPlatformLeads,
                connected: data.ads.some((row) => row.platformLeads !== null),
                actualSource: "Paid-media platform lead fields",
                matchingRule:
                  "Objective=leads; sum platform-reported lead fields inside the plan window.",
                reportTo: "/ads",
              };
            default:
              return {
                actual: null,
                connected: false,
                actualSource: "Not connected",
                matchingRule: "No authoritative source configured for this deliverable.",
                reportTo: "/media-plan",
              };
          }
        };
        const deliverables: DeliverableDelivery[] = [
          {
            key: "paid-media-leads",
            label: "Paid media leads",
            category: "paid_media",
            metric: "leads",
            target: plan.paidLeadTarget,
            unit: "leads",
            actual: targetedLeads,
            connected: data.ads.some((row) => row.platformLeads !== null),
            actualSource: "Course-attributed paid delivery",
            dateScope,
            matchingRule:
              "Course/campaign matching from the selected plan; platform leads preferred, CRM fallback labelled below.",
            reportTo: "/ads",
          },
          ...plan.courses.map((target) => {
            const row = courseRows.find((candidate) => candidate.key === target.key);
            return {
              key: target.key,
              label: target.label,
              category: "paid_media" as const,
              metric: "leads" as const,
              target: target.targetLeads,
              unit: "leads",
              actual: row?.actual.actualLeads ?? null,
              connected: !!row,
              actualSource:
                row?.actual.leadBasis === "platform"
                  ? "Platform campaign delivery"
                  : "CRM fallback",
              dateScope,
              matchingRule: "Campaign name/course aliases from the selected monthly plan.",
              reportTo: "/campaigns",
            };
          }),
          ...plan.additionalActivities
            .filter(
              (activity) =>
                activity.target !== undefined &&
                activity.category &&
                activity.metric &&
                activity.unit,
            )
            .map((activity) => {
              const source = sourceForDeliverable(activity);
              return {
                key: activity.key,
                label: activity.label,
                category: activity.category!,
                metric: activity.metric!,
                target: activity.target!,
                unit: activity.unit!,
                ...source,
                dateScope,
              };
            }),
        ];

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
            salesAchievement: divide(totals.revenue, plan.salesTargetUsd),
          },
          courses: courseRows,
          deliverables,
          unplanned: unplanned.sort((a, b) => b.spend - a.spend),
          availableMonths,
          editable: source.editable && writesEnabled(),
          edited: source.editedMonths.includes(plan.month),
          auth: {
            signedIn: guard.ok,
            via: guard.ok ? guard.actor.via : null,
            name: guard.ok ? guard.actor.name : "",
            sso: ssoConfigured(),
            adminCode: adminCodeConfigured(),
          },
          storeError: source.error,
          sources: [
            "ENGOSOFT Marketing Plan Aug 2026: lead, budget, sales and ownership targets",
            "July Media Plan and Media Buyers Plan: course CPL benchmarks",
          ],
          health: data.snapshot.health,
        });
      },
      POST: async ({ request }) => {
        const { authorizeWrite } = await import("@/lib/admin-auth.server");
        const guard = authorizeWrite(request);
        if (!guard.ok) {
          return Response.json(
            { ok: false, error: guard.error },
            { status: guard.status, headers: { "cache-control": "no-store" } },
          );
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
        }

        try {
          const { saveMediaPlan } = await import("@/lib/media-plans.server");
          const plan = await saveMediaPlan(
            body,
            guard.actor.email || guard.actor.name || guard.actor.id,
          );
          return Response.json(
            { ok: true, plan, savedBy: guard.actor.name || guard.actor.id },
            { headers: { "cache-control": "no-store" } },
          );
        } catch (error) {
          return Response.json(
            { ok: false, error: error instanceof Error ? error.message : "Saving failed." },
            { status: 400, headers: { "cache-control": "no-store" } },
          );
        }
      },
    },
  },
});
