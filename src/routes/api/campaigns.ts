import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/campaigns")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered, computeCampaigns, computeDrilldown } = await import("@/lib/metrics.server");
        const { normalizeName } = await import("@/lib/sheet-cache.server");
        const { parseFilters, json } = await import("@/lib/api.server");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        const campaigns = computeCampaigns(data);

        // Ad set → ad drilldown, keyed by normalized campaign name. Only built
        // for campaigns that actually spent, to keep the payload small.
        const drilldown: Record<string, ReturnType<typeof computeDrilldown>> = {};
        for (const c of campaigns) {
          if (!c.campaign || c.spend <= 0) continue;
          const key = normalizeName(c.campaign);
          if (drilldown[key]) continue;
          const d = computeDrilldown(data, c.campaign);
          if (d.length) drilldown[key] = d;
        }

        return json({
          campaigns,
          drilldown,
          matchRate: data.matchRate,
          appliedFilters: filters,
        });
      },
    },
  },
});
