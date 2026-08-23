import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/overview")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const {
          getFiltered,
          computeTotals,
          computePerf,
          computeCourses,
          computeFunnel,
          computeLeadOrigin,
          bestCampaign,
          moneyLeak,
          bestCPL,
          topLeaks,
          dailyTrend,
          previousPeriod,
          isPreviousComparable,
          computeDeltas,
          execSummary,
          computeRecentCampaignActivity,
        } = await import("@/lib/metrics.server");
        const { parseFilters, json } = await import("@/lib/api.server");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        const totals = computeTotals(data);
        const campaigns = computePerf(data, "campaign");
        const activity = await computeRecentCampaignActivity(filters, data);

        // Previous equal-length window, for the delta on each KPI card. Skipped
        // entirely when that window predates the data — see isPreviousComparable.
        const prevRange = previousPeriod(filters.from, filters.to);
        const prevComparable = await isPreviousComparable(prevRange);
        const prevData =
          prevComparable && prevRange ? await getFiltered({ ...filters, ...prevRange }) : null;
        const deltas = prevData ? computeDeltas(totals, computeTotals(prevData)) : {};
        const courses = computeCourses(data, prevData ?? undefined);
        const soldCourses = courses
          .filter((course) => course.course !== "Unattributed" && course.revenue > 0)
          .sort((a, b) => b.revenue - a.revenue);
        const classifiedCourseRevenue = soldCourses.reduce(
          (sum, course) => sum + course.revenue,
          0,
        );
        const courseSales = soldCourses.map((course) => ({
          course: course.course,
          mainCategory: course.mainCategory,
          revenue: course.revenue,
          contribution:
            classifiedCourseRevenue > 0 ? (course.revenue / classifiedCourseRevenue) * 100 : 0,
          paidInvoices: course.invoices,
          averageSalePrice: course.avgOrder,
        }));

        const spending = campaigns.filter((c) => c.spend >= 50);
        const health = data.snapshot.health;

        return json({
          totals,
          deltas,
          prevRange,
          prevComparable,
          trend: dailyTrend(data),
          funnel: computeFunnel(totals),
          origin: computeLeadOrigin(data),
          best: bestCampaign(campaigns),
          leak: moneyLeak(campaigns),
          bestCPL: bestCPL(campaigns),
          activity,
          topLeaks: topLeaks(campaigns, 5),
          topByROAS: [...spending].sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0)).slice(0, 6),
          topSpend: [...campaigns].sort((a, b) => b.spend - a.spend).slice(0, 6),
          topCourses: courses.slice(0, 6),
          courseSales,
          accounts: data.snapshot.accounts,
          summary: execSummary(totals, campaigns, deltas, filters, health),
          appliedFilters: filters,
          coverage: {
            adsDateMin: data.snapshot.adsDateMin,
            adsDateMax: data.snapshot.adsDateMax,
            crmDateMin: data.snapshot.crmDateMin,
            crmDateMax: data.snapshot.crmDateMax,
            revenueDateMin: data.snapshot.revenueDateMin,
            revenueDateMax: data.snapshot.revenueDateMax,
          },
          syncedAt: data.snapshot.syncedAt,
          health,
          fetchErrors: data.snapshot.fetchErrors,
          staleTabs: data.snapshot.staleTabs,
        });
      },
    },
  },
});
