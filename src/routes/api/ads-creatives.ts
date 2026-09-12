import { createFileRoute } from "@tanstack/react-router";
import type { CreativeAnalyticsRow } from "@/lib/types";

export const Route = createFileRoute("/api/ads-creatives")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { parseFilters, json } = await import("@/lib/api.server");
        const { getFiltered, computePerf, adPerformanceKey } = await import("@/lib/metrics.server");
        const { normalizeName } = await import("@/lib/sheet-cache.server");
        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        const health = data.snapshot.health.platformSources?.chatgpt ?? {
          configured: false,
          ok: false,
          source: "none" as const,
          rows: 0,
          creatives: 0,
          syncedAt: "",
          message: "OpenAI Ads credentials are not configured.",
        };

        if (filters.channel === "organic" || (filters.platform && filters.platform !== "chatgpt")) {
          return json({
            rows: [] as CreativeAnalyticsRow[],
            health,
            facets: { accounts: [], campaigns: [], adsets: [], statuses: [], reviewStatuses: [] },
            appliedFilters: filters,
          });
        }

        const performance = new Map(computePerf(data, "ad").map((row) => [row.key, row]));
        const wantedCourse = normalizeName(filters.course ?? "");
        const creatives = data.snapshot.creatives.filter((creative) => {
          if (creative.platform !== "chatgpt") return false;
          if (filters.account && creative.account !== filters.account) return false;
          if (filters.campaign && creative.campaign !== filters.campaign) return false;
          if (filters.campaignKey && creative.campaignKey !== filters.campaignKey) return false;
          if (filters.adset && creative.adset !== filters.adset) return false;
          if (filters.ad && creative.ad !== filters.ad) return false;
          if (filters.adKey && adPerformanceKey(creative) !== filters.adKey) return false;
          if (wantedCourse) {
            const course =
              performance.get(adPerformanceKey(creative))?.course ||
              data.snapshot.campaigns.get(creative.campaignKey)?.course ||
              "";
            if (normalizeName(course) !== wantedCourse) return false;
          }
          return true;
        });

        const rows: CreativeAnalyticsRow[] = creatives.map((creative) => {
          const performanceKey = adPerformanceKey(creative);
          const metrics = performance.get(performanceKey);
          const deliveryAvailable = !!metrics?.platforms.includes("chatgpt");
          return {
            ...creative,
            performanceKey,
            spend: deliveryAvailable ? metrics!.spend : null,
            impressions: deliveryAvailable ? metrics!.impressions : null,
            clicksAll: deliveryAvailable ? metrics!.clicksAll : null,
            ctrAll: deliveryAvailable ? metrics!.ctrAll : null,
            cpc: deliveryAvailable ? metrics!.cpc : null,
            platformLeads: deliveryAvailable ? metrics!.platformLeads : null,
            crmLeads: metrics?.crmLeads ?? 0,
            won: metrics?.won ?? 0,
            lost: metrics?.lost ?? 0,
            revenue: metrics?.revenue ?? 0,
            roas: deliveryAvailable ? metrics!.roas : null,
          };
        });

        const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort();
        return json({
          rows,
          health,
          facets: {
            accounts: unique(rows.map((row) => row.account)),
            campaigns: unique(rows.map((row) => row.campaign)),
            adsets: unique(rows.map((row) => row.adset)),
            statuses: unique(rows.map((row) => row.status)),
            reviewStatuses: unique(rows.map((row) => row.reviewStatus)),
          },
          appliedFilters: filters,
        });
      },
    },
  },
});
