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
  platformActual?: number | null;
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
        const { loadAllData } = await import("@/lib/sheet-cache.server");
        const { isExcludedFromSalesRevenue } = await import("@/lib/sales-revenue-policy");
        const { accountingReportingDate } = await import("@/lib/accounting-policy");
        const { accountingUsdPaid, fxRatesFromFilters } = await import("@/lib/fx-rates");
        const { funnelFromLive, summarizeFunnel } = await import("@/lib/management-review");
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

        const [data, organicData, websiteData, webinarData, allData] = await Promise.all([
          getFiltered(scopedFilters),
          getFiltered({ ...scopedFilters, channel: "organic" }),
          getFiltered({ ...scopedFilters, source: "Website" }),
          getFiltered({ ...scopedFilters, source: "Webinar" }),
          loadAllData(),
        ]);
        const allCrmLeads = summarizeFunnel(funnelFromLive(
          data.crm.filter((row) => row.createdAt >= window.from && row.createdAt <= window.to),
          data.lost.filter((row) => row.createdAt >= window.from && row.createdAt <= window.to),
        )).leads;
        const certificateRows = allData.accounting
          .filter((row) =>
            accountingReportingDate(row, "payment") >= window.from &&
            accountingReportingDate(row, "payment") <= window.to &&
            isExcludedFromSalesRevenue(row),
          );
        const rates = fxRatesFromFilters({});
        const certificateRevenueUsd = certificateRows
          .reduce((sum, row) => sum + accountingUsdPaid(row, rates), 0);
        const companyRevenueMap = new Map<string, { company: string; salesUsd: number; certificateUsd: number; certificateLines: number }>();
        const companyRow = (company: string) => {
          const key = company.trim() || "غير محدد";
          const current = companyRevenueMap.get(key) ?? { company: key, salesUsd: 0, certificateUsd: 0, certificateLines: 0 };
          companyRevenueMap.set(key, current);
          return current;
        };
        for (const row of data.accounting) companyRow(row.company).salesUsd += row.usdPaid;
        for (const row of certificateRows) {
          const current = companyRow(row.company);
          current.certificateUsd += accountingUsdPaid(row, rates);
          current.certificateLines++;
        }
        const revenueByCompany = [...companyRevenueMap.values()].sort(
          (a, b) => b.salesUsd + b.certificateUsd - a.salesUsd - a.certificateUsd,
        );
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
          // The actionable number is the Odoo lead population users can open.
          // Platform-reported delivery remains separate for reconciliation.
          const actualLeads = actual.crmLeads;
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
              leadBasis: "crm",
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
        const targetedPlatformLeads = courseRows.some((row) => row.actual.platformLeads !== null)
          ? courseRows.reduce((sum, row) => sum + (row.actual.platformLeads ?? 0), 0)
          : null;
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
          reportedActual?: number;
        }) => {
          switch (deliverable.actualSource) {
            case "manual_reported":
              return {
                actual: deliverable.reportedActual ?? null,
                connected: deliverable.reportedActual !== undefined,
                actualSource: "Manual month-to-date report",
                matchingRule:
                  "Entered by a plan editor; not independently verified or inferred from campaign or creative counts.",
                reportTo: "/media-plan",
              };
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
          ...(plan.month === "2026-10"
            ? []
            : [
                {
                  key: "paid-media-leads",
                  label: "Paid media leads",
                  category: "paid_media" as const,
                  metric: "leads" as const,
                  target: plan.paidLeadTarget,
                  unit: "leads",
                  actual: targetedLeads,
                  connected: true,
                  actualSource: "Odoo CRM · Course Categories",
                  platformActual: targetedPlatformLeads,
                  dateScope,
                  matchingRule:
                    "Odoo CRM Course Categories for the primary number; platform delivery shown separately.",
                  reportTo: "/ads",
                },
              ]),
          ...plan.courses.map((target) => {
            const row = courseRows.find((candidate) => candidate.key === target.key);
            return {
              key: target.key,
              label: target.label,
              category: "paid_media" as const,
              metric: "leads" as const,
              target: target.targetLeads,
              unit: "leads",
              actual: row?.actual.crmLeads ?? null,
              connected: !!row,
              actualSource: "Odoo CRM · Course Categories",
              platformActual: row?.actual.platformLeads ?? null,
              dateScope,
              matchingRule: "Odoo lead Course Categories and creation month; platform campaign delivery is a separate comparison.",
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
            targetCpl:
              plan.leadGenerationBudgetUsd > 0
                ? divide(plan.leadGenerationBudgetUsd, plan.paidLeadTarget)
                : null,
            plannedCourseBudgetUsd,
            reserveBudgetUsd: plan.leadGenerationBudgetUsd - plannedCourseBudgetUsd,
            additionalBudgetUsd,
            totalMarketingBudgetUsd:
              plan.overallMarketingBudgetUsd ?? plan.leadGenerationBudgetUsd + additionalBudgetUsd,
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
            targetedPlatformLeads,
            allCrmLeads,
            targetedCpl: divide(targetedSpend, targetedLeads),
            paidLeadAchievement: divide(targetedLeads, plan.paidLeadTarget),
            organicWebinarLeads: organicTotals.totalLeads,
            organicAchievement: divide(organicTotals.totalLeads, plan.organicWebinarLeadTarget),
            allSpend: totals.spend,
            unattributedOrUnplannedSpend: Math.max(0, totals.spend - targetedSpend),
            revenueUsd: totals.revenue,
            certificateRevenueUsd,
            certificateLines: certificateRows.length,
            revenueByCompany,
            revenueIncludingCertificatesUsd: totals.revenue + certificateRevenueUsd,
            actualSalesBudgetAllowanceUsd: plan.month === "2026-09" ? totals.revenue * 0.17 : null,
            actualGrossBudgetAllowanceUsd: plan.month === "2026-09" ? (totals.revenue + certificateRevenueUsd) * 0.17 : null,
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
            ...(plan.month === "2026-10"
              ? [
                  "October 2026 Media Plan image supplied by management; conflicting totals remain a draft note",
                ]
              : []),
            ...(plan.month === "2026-09"
              ? ["Management correction, 2026-10-01: September sales target $135,000; marketing budget 17% of target ($22,950). August course/activity allocations remain a draft."]
              : []),
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
