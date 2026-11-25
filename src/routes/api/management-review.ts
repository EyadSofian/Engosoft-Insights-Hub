import { createFileRoute } from "@tanstack/react-router";
import { accountingReportingDate } from "@/lib/accounting-policy";
import { matchMediaPlanCourse, OCTOBER_2026_SOURCE } from "@/lib/media-plan";
import {
  funnelFromHistory,
  funnelFromLive,
  rate,
  summarizeFunnel,
  mergeFunnelCourses,
} from "@/lib/management-review";
import { managementReviewWindow } from "@/lib/management-review-period";

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

export const Route = createFileRoute("/api/management-review")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { computeCourses, getFiltered } = await import("@/lib/metrics.server");
        const { loadMediaPlanSource } = await import("@/lib/media-plans.server");
        const { historicalCrm } = await import("@/lib/yearly-crm-history.server");
        const { loadAllData } = await import("@/lib/sheet-cache.server");
        const { isExcludedFromSalesRevenue } = await import("@/lib/sales-revenue-policy");
        const { accountingUsdPaid, fxRatesFromFilters } = await import("@/lib/fx-rates");
        const { lostPopulationCounts, lostPopulations } = await import("@/lib/lost-classification");
        const { json, parseFilters } = await import("@/lib/api.server");
        const today = cairoToday();
        const url = new URL(request.url);
        const requested = url.searchParams.get("month") ?? "";
        const legacyUrl = new URL(url);
        legacyUrl.searchParams.set("range", "all");
        // Old MCP clients may request a month, but explicit top-bar dates always win.
        const parseRequest =
          !url.searchParams.has("from") &&
          !url.searchParams.has("to") &&
          /^\d{4}-(0[1-9]|1[0-2])$/.test(requested)
            ? new Request(legacyUrl, {
                headers: request.headers,
              })
            : request;
        const filters = await parseFilters(parseRequest);
        let window: ReturnType<typeof managementReviewWindow>;
        try {
          window = managementReviewWindow(filters, today, requested);
        } catch {
          return json({ error: "Invalid review period. Use valid dates from 2025 onward." }, 400);
        }
        const { months, selectedMonth } = window;
        const scope = { ...filters, from: window.from, to: window.to, dateBasis: undefined };
        const targetScope = ![
          filters.course,
          filters.platform,
          filters.account,
          filters.channel,
          filters.source,
          filters.mainCategory,
          filters.salesTeam,
          filters.salesperson,
          filters.company,
          filters.campaign,
          filters.campaignKey,
          filters.adset,
          filters.adsetKey,
          filters.ad,
          filters.adKey,
        ].some(Boolean);
        const [data, closedData, allData, source, historical] = await Promise.all([
          getFiltered(scope),
          getFiltered({ ...scope, lostDateBasis: "closed" }),
          loadAllData(),
          loadMediaPlanSource(),
          historicalCrm(2025),
        ]);
        const fxRates = fxRatesFromFilters(filters);

        const monthRows = months.map((month) => {
          const historicalMonth = month.startsWith("2025");
          const crmCovered = historicalMonth
            ? historical.rows.length > 0 &&
              ![
                filters.platform,
                filters.source,
                filters.salesperson,
                filters.salesTeam,
                filters.company,
                filters.campaign,
                filters.account,
                filters.channel,
                filters.mainCategory,
                filters.campaignKey,
                filters.adset,
                filters.adsetKey,
                filters.ad,
                filters.adKey,
              ].some(Boolean)
            : !filters.company &&
              data.snapshot.crmDateMin.slice(0, 7) <= month &&
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
            ? funnelFromHistory(
                historical.rows.filter(
                  (row) =>
                    row.createdAt.startsWith(month) &&
                    row.createdAt >= window.from &&
                    row.createdAt <= window.to &&
                    (!filters.course || row.course === filters.course),
                ),
              )
            : funnelFromLive(
                data.crm.filter((row) => row.createdAt.startsWith(month)),
                data.lost.filter((row) => row.createdAt.startsWith(month)),
              );
          const funnel = summarizeFunnel(courseFacts);
          const plan = targetScope ? (source.plans[month] ?? null) : null;
          const spendSum = data.ads
            .filter((row) => row.date.startsWith(month))
            .reduce((sum, row) => sum + row.spend, 0);
          const revenueSum = data.accounting
            .filter((row) => accountingReportingDate(row, "payment").startsWith(month))
            .reduce((sum, row) => sum + row.usdPaid, 0);
          const certificateRevenue = allData.accounting
            .filter(
              (row) =>
                accountingReportingDate(row, "payment").startsWith(month) &&
                accountingReportingDate(row, "payment") >= window.from &&
                accountingReportingDate(row, "payment") <= window.to &&
                (!filters.company || row.company === filters.company) &&
                isExcludedFromSalesRevenue(row),
            )
            .reduce((sum, row) => sum + accountingUsdPaid(row, fxRates), 0);
          const spend =
            adsCovered &&
            ![
              filters.company,
              filters.salesTeam,
              filters.salesperson,
              filters.source,
              filters.mainCategory,
            ].some(Boolean)
              ? spendSum
              : null;
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
            ? plan.overallMarketingBudgetUsd !== undefined
              ? plan.overallMarketingBudgetUsd
              : plan.leadGenerationBudgetUsd > 0
                ? plan.leadGenerationBudgetUsd +
                  plan.additionalActivities.reduce((sum, activity) => sum + activity.budgetUsd, 0)
                : month === "2026-10" && !source.editedMonths.includes(month)
                  ? OCTOBER_2026_SOURCE.marketingBudgetUsd
                  : null
            : null;
          const lostCounts =
            historicalMonth || !crmCovered
              ? null
              : lostPopulationCounts(
                  lostPopulations({
                    cohortRows: data.lost,
                    closedRows: closedData.lost,
                    window: {
                      from: window.from > month + "-01" ? window.from : month + "-01",
                      to:
                        window.to < month + "-31"
                          ? window.to
                          : `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`,
                    },
                  }),
                );
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
              certificateRevenue: revenueCovered && targetScope ? certificateRevenue : null,
              revenueIncludingCertificates:
                revenueCovered && targetScope && revenue !== null
                  ? revenue + certificateRevenue
                  : null,
              spend,
              leads: planLeadsActual,
              crmLeads: crmCovered ? funnel.leads : null,
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
            budget: {
              actualRevenueAllowance:
                !plan || revenue === null || month !== "2026-09" ? null : revenue * 0.17,
              actualRevenueUtilization:
                !plan || revenue === null || spend === null || month !== "2026-09"
                  ? null
                  : rate(spend, revenue * 0.17),
              actualGrossAllowance:
                !plan || revenue === null || month !== "2026-09"
                  ? null
                  : (revenue + certificateRevenue) * 0.17,
              targetRate: plan && month === "2026-09" ? 0.17 : null,
            },
            lostMovement: {
              closedInMonth: lostCounts?.closedLostInPeriod ?? null,
              createdAndClosedInMonth: lostCounts?.createdAndLostInPeriod ?? null,
              olderCreatedClosedInMonth: lostCounts?.olderCohortClosedLostInPeriod ?? null,
              undatedCreatedClosedInMonth: lostCounts?.undatedCohortClosedLostInPeriod ?? null,
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
        const first = monthRows[0];
        if (!first) return json({ error: "No supported reporting period." }, 400);
        const sum = (values: (number | null)[]) =>
          values.every((n) => n !== null) ? values.reduce<number>((s, n) => s + (n ?? 0), 0) : null;
        const totalFunnel = summarizeFunnel(
          mergeFunnelCourses(monthRows.flatMap((row) => row.funnel.courses)),
        );
        const available = monthRows.every((row) => row.funnelAvailable);
        const enriched = monthRows.every((row) => row.funnelEnriched);
        const targets = {
          ...first.target,
          revenue: sum(monthRows.map((row) => row.target.revenue)),
          spend: sum(monthRows.map((row) => row.target.spend)),
          leads: sum(monthRows.map((row) => row.target.leads)),
        };
        const actual = {
          ...first.actual,
          revenue: sum(monthRows.map((row) => row.actual.revenue)),
          spend: sum(monthRows.map((row) => row.actual.spend)),
          leads: sum(monthRows.map((row) => row.actual.leads)),
          certificateRevenue: sum(monthRows.map((row) => row.actual.certificateRevenue)),
          revenueIncludingCertificates: sum(
            monthRows.map((row) => row.actual.revenueIncludingCertificates),
          ),
          crmLeads: available ? totalFunnel.leads : null,
          conversion: available ? totalFunnel.conversion : null,
          freshConversion: enriched ? totalFunnel.freshConversion : null,
          oldConversion: enriched ? totalFunnel.oldConversion : null,
        };
        const windowLostCounts =
          available && !months.some((month) => month.startsWith("2025"))
            ? lostPopulationCounts(
                lostPopulations({
                  cohortRows: data.lost,
                  closedRows: closedData.lost,
                  window: { from: window.from, to: window.to },
                }),
              )
            : null;
        const combined = {
          ...first,
          month: selectedMonth,
          planStatus: monthRows.every((row) => row.planStatus === "approved")
            ? ("approved" as const)
            : monthRows.every((row) => row.planStatus)
              ? ("draft" as const)
              : null,
          coverage: {
            crm: available,
            ads: monthRows.every((row) => row.coverage.ads),
            revenue: monthRows.every((row) => row.coverage.revenue),
          },
          target: targets,
          actual,
          funnelAvailable: available,
          funnelEnriched: enriched,
          achievement: {
            revenue:
              actual.revenue !== null && targets.revenue !== null
                ? rate(actual.revenue, targets.revenue)
                : null,
            spend:
              actual.spend !== null && targets.spend !== null
                ? rate(actual.spend, targets.spend)
                : null,
            leads:
              actual.leads !== null && targets.leads !== null
                ? rate(actual.leads, targets.leads)
                : null,
          },
          funnel: {
            ...totalFunnel,
            noAnswer: enriched ? totalFunnel.noAnswer : null,
            noAnswerRate: enriched ? totalFunnel.noAnswerRate : null,
            replyKnown: enriched ? totalFunnel.replyKnown : null,
            freshLeads: enriched ? totalFunnel.freshLeads : null,
            freshWon: enriched ? totalFunnel.freshWon : null,
            oldLeads: enriched ? totalFunnel.oldLeads : null,
            oldWon: enriched ? totalFunnel.oldWon : null,
            freshConversion: enriched ? totalFunnel.freshConversion : null,
            oldConversion: enriched ? totalFunnel.oldConversion : null,
            segmentCoverage: enriched ? totalFunnel.segmentCoverage : null,
            turnaroundDays: enriched ? totalFunnel.turnaroundDays : null,
            turnaroundSamples: enriched ? totalFunnel.turnaroundSamples : null,
            reasons: enriched ? totalFunnel.reasons : [],
            topConversionCourse: available ? totalFunnel.topConversionCourse : null,
            topFreshCourse: enriched ? totalFunnel.topFreshCourse : null,
          },
          budget: {
            actualRevenueAllowance: null,
            actualRevenueUtilization: null,
            actualGrossAllowance: null,
            targetRate: null,
          },
          lostMovement: {
            closedInMonth: windowLostCounts?.closedLostInPeriod ?? null,
            createdAndClosedInMonth: windowLostCounts?.createdAndLostInPeriod ?? null,
            olderCreatedClosedInMonth: windowLostCounts?.olderCohortClosedLostInPeriod ?? null,
            undatedCreatedClosedInMonth: windowLostCounts?.undatedCohortClosedLostInPeriod ?? null,
          },
        };
        return json({
          selectedMonth,
          today,
          months,
          rows: monthRows,
          selected: monthRows.length === 1 ? first : combined,
          selectedPeriod: { from: window.from, to: window.to },
          appliedFilters: scope,
          targetBasis:
            "Full saved monthly media plans, not prorated; separate from employee targets; no inferred subscope target.",
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
              "Paid Accounting USD by payment date, with products 246 and 1047 excluded by the sales revenue policy. The invoice-date toggle does not redefine this collection metric.",
            period:
              "Top-bar dates and supported filters apply. Legacy month is used only without explicit dates. The current window is not silently replaced by the previous month.",
            spend:
              "All connected ad-account spend by platform date. September 2026 fixed marketing budget is 17% of the $135,000 target; a separate floating 17%-of-sales allowance is shown, not substituted for the fixed plan.",
            lostMovement:
              "Creation-cohort Lost means leads created in the selected month that are now Lost. Closed-in-month Lost means all leads closed Lost in that month, including older creation cohorts.",
            leadTarget:
              "Paid course-lead target compared with course-matched platform leads, with labelled CRM fallback where a platform does not report leads.",
          },
        });
      },
    },
  },
});
