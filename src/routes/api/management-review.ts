import { createFileRoute } from "@tanstack/react-router";
import { accountingReportingDate } from "@/lib/accounting-policy";
import { matchMediaPlanCourse, OCTOBER_2026_SOURCE } from "@/lib/media-plan";
import { funnelFromHistory, funnelFromLive, rate, summarizeFunnel } from "@/lib/management-review";

function cairoToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function monthsThrough(today: string): string[] {
  const result: string[] = [];
  for (let year = 2025; year <= Number(today.slice(0, 4)); year++) {
    for (let month = 1; month <= 12; month++) {
      const key = `${year}-${String(month).padStart(2, "0")}`;
      if (key <= today.slice(0, 7)) result.push(key);
    }
  }
  return result;
}

export const Route = createFileRoute("/api/management-review")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { computeCourses, getFiltered } = await import("@/lib/metrics.server");
        const { loadMediaPlanSource } = await import("@/lib/media-plans.server");
        const { historicalCrm } = await import("@/lib/yearly-crm-history.server");
        const { json } = await import("@/lib/api.server");
        const today = cairoToday();
        const months = monthsThrough(today);
        const previousMonth = months.at(-2) ?? months[0];
        const requested = new URL(request.url).searchParams.get("month") ?? "";
        const selectedMonth = months.includes(requested) ? requested : previousMonth;
        const [data, source, historical] = await Promise.all([
          getFiltered({ from: "2025-01-01", to: today }),
          loadMediaPlanSource(),
          historicalCrm(2025),
        ]);

        const monthRows = months.map((month) => {
          const historicalMonth = month.startsWith("2025");
          const crmCovered = historicalMonth
            ? historical.rows.length > 0
            : data.snapshot.crmDateMin.slice(0, 7) <= month &&
              data.snapshot.crmDateMax.slice(0, 7) >= month &&
              data.snapshot.health.lostAuthority !== "unavailable";
          const adsCovered =
            data.snapshot.adsDateMin.slice(0, 7) <= month &&
            data.snapshot.adsDateMax.slice(0, 7) >= month;
          const revenueCovered =
            data.snapshot.revenueDateMin.slice(0, 7) <= month &&
            data.snapshot.revenueDateMax.slice(0, 7) >= month;
          const enriched = crmCovered && (historicalMonth ? historical.funnelReady : true);
          const courseFacts = historicalMonth
            ? funnelFromHistory(historical.rows.filter((row) => row.createdAt.startsWith(month)))
            : funnelFromLive(
                data.crm.filter((row) => row.createdAt.startsWith(month)),
                data.lost.filter((row) => row.createdAt.startsWith(month)),
              );
          const funnel = summarizeFunnel(courseFacts);
          const plan = source.plans[month] ?? null;
          const spendSum = data.ads
            .filter((row) => row.date.startsWith(month))
            .reduce((sum, row) => sum + row.spend, 0);
          const revenueSum = data.accounting
            .filter((row) => accountingReportingDate(row, "payment").startsWith(month))
            .reduce((sum, row) => sum + row.usdPaid, 0);
          const spend = adsCovered ? spendSum : null;
          const revenue = revenueCovered ? revenueSum : null;
          const salesTarget = plan?.salesTargetUsd ?? null;
          const leadTarget = plan?.paidLeadTarget ?? null;
          const matchedCourses = plan
            ? computeCourses({
                ...data,
                ads: data.ads.filter((item) => item.date.startsWith(month)),
                crm: data.crm.filter((item) => item.createdAt.startsWith(month)),
                lost: data.lost.filter((item) => item.createdAt.startsWith(month)),
                accounting: data.accounting.filter((item) =>
                  accountingReportingDate(item, "payment").startsWith(month),
                ),
                invoiced: data.invoiced.filter((item) => item.revenueDate.startsWith(month)),
              }).filter((course) => matchMediaPlanCourse(plan.courses, course.course, course.name))
            : [];
          const planLeadsActual =
            plan && crmCovered && adsCovered
              ? matchedCourses.reduce(
                  (sum, course) => sum + (course.platformLeads ?? course.crmLeads),
                  0,
                )
              : null;
          const leadBasis = matchedCourses.some((course) => course.platformLeads === null)
            ? "mixed_platform_crm"
            : "platform";
          const adBudget = plan
            ? plan.leadGenerationBudgetUsd > 0
              ? plan.leadGenerationBudgetUsd
              : month === "2026-10" && !source.editedMonths.includes(month)
                ? OCTOBER_2026_SOURCE.marketingBudgetUsd
                : null
            : null;
          return {
            month,
            historicalStatus: historicalMonth ? historical.status : "ready",
            coverage: { crm: crmCovered, ads: adsCovered, revenue: revenueCovered },
            funnelAvailable: crmCovered,
            funnelEnriched: enriched,
            planStatus: plan?.status ?? null,
            planBasisMonth: plan?.basisMonth ?? null,
            leadBasis: plan ? leadBasis : null,
            target: {
              revenue: salesTarget,
              spend: adBudget,
              leads: leadTarget,
              conversion: null,
              freshConversion: null,
              oldConversion: null,
            },
            actual: {
              revenue,
              spend,
              leads: planLeadsActual,
              conversion: crmCovered ? funnel.conversion : null,
              freshConversion: enriched ? funnel.freshConversion : null,
              oldConversion: enriched ? funnel.oldConversion : null,
            },
            achievement: {
              revenue: salesTarget === null || revenue === null ? null : rate(revenue, salesTarget),
              spend: adBudget === null || spend === null ? null : rate(spend, adBudget),
              leads:
                leadTarget === null || planLeadsActual === null
                  ? null
                  : rate(planLeadsActual, leadTarget),
            },
            funnel: {
              ...funnel,
              noAnswer: enriched ? funnel.noAnswer : null,
              noAnswerRate: enriched ? funnel.noAnswerRate : null,
              replyKnown: enriched ? funnel.replyKnown : null,
              freshLeads: enriched ? funnel.freshLeads : null,
              freshWon: enriched ? funnel.freshWon : null,
              oldLeads: enriched ? funnel.oldLeads : null,
              oldWon: enriched ? funnel.oldWon : null,
              freshConversion: enriched ? funnel.freshConversion : null,
              oldConversion: enriched ? funnel.oldConversion : null,
              segmentCoverage: enriched ? funnel.segmentCoverage : null,
              turnaroundDays: enriched ? funnel.turnaroundDays : null,
              turnaroundSamples: enriched ? funnel.turnaroundSamples : null,
              reasons: enriched ? funnel.reasons : [],
              topConversionCourse: crmCovered ? funnel.topConversionCourse : null,
              topFreshCourse: enriched ? funnel.topFreshCourse : null,
              courses: !crmCovered
                ? []
                : enriched
                  ? funnel.courses
                  : funnel.courses.map((row) => ({
                      ...row,
                      freshLeads: 0,
                      freshWon: 0,
                      oldLeads: 0,
                      oldWon: 0,
                      noAnswer: 0,
                      turnaroundSamples: 0,
                      turnaroundDays: null,
                      freshConversion: null,
                      oldConversion: null,
                    })),
            },
          };
        });
        return json({
          selectedMonth,
          today,
          months,
          rows: monthRows,
          selected: monthRows.find((row) => row.month === selectedMonth),
          historical: {
            status: historical.status,
            funnelReady: historical.funnelReady,
            syncedAt: historical.syncedAt,
          },
          methodology: {
            cohort:
              "Odoo CRM leads grouped by creation date; 2025 historical scope includes Inventory, while the 2026 operational snapshot excludes Inventory. Won/Lost are current state as of the latest CRM sync, not historical month-end status.",
            oldFresh:
              "Odoo Lead Segment = Fresh or Old Data only. Untagged leads are excluded from both conversion denominators.",
            noAnswer:
              "Calling reply? = Not answer/No answer or canonical Lost reason = Not reached; divided by all created leads.",
            turnaround:
              "Mean calendar days from create date to documented close/won/lost date, closed leads with dates only.",
            revenue:
              "Paid Accounting USD by payment date, with product 246 excluded by the sales revenue policy.",
            spend:
              "All connected ad-account spend by platform date. A missing plan target is not inferred.",
            leadTarget:
              "Paid course-lead target compared with course-matched platform leads, with labelled CRM fallback where a platform does not report leads.",
          },
        });
      },
    },
  },
});
