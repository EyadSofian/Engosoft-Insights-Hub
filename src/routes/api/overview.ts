import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/overview")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const {
          getFiltered,
          computeTotals,
          computeCampaigns,
          computeCourses,
          bestCampaign,
          moneyLeak,
          bestCPL,
          dailyTrend,
          previousPeriod,
          computeDeltas,
          execSummary,
        } = await import("@/lib/metrics.server");
        const { parseFilters, json } = await import("@/lib/api.server");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        const totals = computeTotals(data);
        const campaigns = computeCampaigns(data);
        const trend = dailyTrend(data);

        // Previous equal-length window, for the WoW deltas on each KPI.
        const prevRange = previousPeriod(filters.from, filters.to);
        const prevData = prevRange
          ? await getFiltered({ ...filters, ...prevRange })
          : null;
        const prevTotals = prevData ? computeTotals(prevData) : null;
        const deltas = prevTotals ? computeDeltas(totals, prevTotals) : {};

        const best = bestCampaign(campaigns);
        const leak = moneyLeak(campaigns);
        const cpl = bestCPL(campaigns);
        const courses = computeCourses(data, prevData ?? undefined);

        const spending = campaigns.filter((c) => c.spend >= 50);
        const topLeaks = [...spending].sort((a, b) => a.roas - b.roas).slice(0, 5);

        return json({
          totals,
          deltas,
          prevRange,
          trend,
          best,
          leak,
          bestCPL: cpl,
          topLeaks,
          topByROAS: [...spending].sort((a, b) => b.roas - a.roas).slice(0, 6),
          bottomByROAS: [...spending].sort((a, b) => a.roas - b.roas).slice(0, 6),
          topCourses: courses.slice(0, 6),
          summary: execSummary(totals, campaigns, deltas, filters),
          appliedFilters: filters,
          metaDateMin: data.metaDateMin,
          metaDateMax: data.metaDateMax,
          revenueDateMin: data.revenueDateMin,
          revenueDateMax: data.revenueDateMax,
          syncedAt: data.syncedAt,
          matchRate: data.matchRate,
          unmatchedCampaigns: data.unmatchedCampaigns.length,
          unmatchedRevenueCampaigns: data.unmatchedRevenueCampaigns.length,
          dateMismatch: data.dateMismatch,
          dataQuality: data.dataQuality,
          fetchErrors: data.fetchErrors,
          funnel: {
            impressions: totals.impressions,
            clicks: totals.clicksAll,
            metaLeads: totals.metaLeads,
            crmLeads: totals.crmLeads,
            won: totals.won,
            revenue: totals.revenue,
          },
        });
      },
    },
  },
});
