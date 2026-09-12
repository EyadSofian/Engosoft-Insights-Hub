import { createFileRoute } from "@tanstack/react-router";
import type { CreativeAnalyticsRow, PlatformSourceHealth } from "@/lib/types";

export const Route = createFileRoute("/api/ads-creatives")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { parseFilters, json } = await import("@/lib/api.server");
        const { getFiltered, computePerf, adPerformanceKey } = await import("@/lib/metrics.server");
        const { invalidateDataCache, normalizeName } = await import("@/lib/sheet-cache.server");
        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        const performance = new Map(computePerf(data, "ad").map((row) => [row.key, row]));
        const wantedCourse = normalizeName(filters.course ?? "");
        const matchesFilters = (creative: (typeof data.snapshot.creatives)[number]) => {
          if (filters.platform && creative.platform !== filters.platform) return false;
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
        };
        let creatives = data.snapshot.creatives.filter(matchesFilters);

        // A Meta daily fact already carries the real Ad ID and Creative ID, but
        // not the image/copy resource. Enrich only the selected Meta ads on
        // demand, return them in this very response, and retain a durable
        // last-good copy in Railway PostgreSQL for later visits.
        const metaCandidates = creatives.filter((creative) => creative.platform === "meta");
        const shouldSyncMeta =
          metaCandidates.length > 0 &&
          (filters.platform === "meta" || !!filters.campaignKey || !!filters.adKey);
        let metaSync:
          | Awaited<ReturnType<typeof import("@/lib/meta-creatives.server").syncMetaCreativesDirect>>
          | null = null;
        if (shouldSyncMeta) {
          const { syncMetaCreativesDirect } = await import("@/lib/meta-creatives.server");
          metaSync = await syncMetaCreativesDirect(metaCandidates);
          if (metaSync.creatives.length) {
            const byAd = new Map(creatives.map((creative) => [creative.adId, creative] as const));
            for (const creative of metaSync.creatives) byAd.set(creative.adId, creative);
            creatives = [...byAd.values()];
          }
          if (metaSync.persisted) invalidateDataCache();
        }

        const creativePlatforms = new Set(creatives.map((creative) => creative.platform));
        const emptyHealth: PlatformSourceHealth = {
          configured: false,
          ok: false,
          source: "none",
          rows: 0,
          creatives: 0,
          syncedAt: "",
          message: "Creative metadata is not available for this source yet.",
        };
        const baseHealth = filters.platform
          ? (data.snapshot.health.platformSources?.[filters.platform] ?? emptyHealth)
          : null;
        const metaContent = metaSync
          ? creatives.filter(
              (creative) =>
                creative.platform === "meta" &&
                (creative.imageUrl ||
                  creative.thumbnailUrl ||
                  creative.videoUrl ||
                  creative.videoId ||
                  creative.headline ||
                  creative.body ||
                  creative.permalinkUrl),
            ).length
          : 0;
        const health: PlatformSourceHealth = metaSync
          ? {
              configured: metaSync.configured || (baseHealth?.configured ?? false),
              ok: metaSync.failed === 0 && metaContent > 0,
              source: metaSync.fetched > 0 ? "api" : (baseHealth?.source ?? "none"),
              rows: baseHealth?.rows ?? data.ads.length,
              creatives: metaContent,
              syncedAt: metaSync.syncedAt || baseHealth?.syncedAt || "",
              message: metaSync.message,
            }
          : baseHealth ?? {
              configured: creativePlatforms.size > 0,
              ok: creativePlatforms.size > 0,
              source: "sheet",
              rows: data.ads.length,
              creatives: creatives.length,
              syncedAt: data.snapshot.syncedAt,
              message: `${creatives.length} creative resources are available.`,
            };

        if (filters.channel === "organic") {
          return json({
            rows: [] as CreativeAnalyticsRow[],
            health,
            facets: { accounts: [], campaigns: [], adsets: [], statuses: [], reviewStatuses: [] },
            appliedFilters: filters,
          });
        }

        const rawRows: CreativeAnalyticsRow[] = creatives.map((creative) => {
          const performanceKey = adPerformanceKey(creative);
          const metrics = performance.get(performanceKey);
          const deliveryAvailable = !!metrics?.platforms.includes(creative.platform);
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
        const addMaybe = (left: number | null, right: number | null) =>
          left === null && right === null ? null : (left ?? 0) + (right ?? 0);
        const groupedRows = new Map<string, CreativeAnalyticsRow>();
        for (const current of rawRows) {
          const creativeKey = `${current.platform}\u001f${current.creativeId || current.adId}`;
          const previous = groupedRows.get(creativeKey);
          if (!previous) {
            groupedRows.set(creativeKey, current);
            continue;
          }
          const spend = addMaybe(previous.spend, current.spend);
          const impressions = addMaybe(previous.impressions, current.impressions);
          const clicksAll = addMaybe(previous.clicksAll, current.clicksAll);
          const platformLeads = addMaybe(previous.platformLeads, current.platformLeads);
          const revenue = previous.revenue + current.revenue;
          groupedRows.set(creativeKey, {
            ...previous,
            // Prefer the richer copy when one ad only carried an id/name.
            creativeName: previous.creativeName || current.creativeName,
            headline: previous.headline || current.headline,
            body: previous.body || current.body,
            imageUrl: previous.imageUrl || current.imageUrl,
            thumbnailUrl: previous.thumbnailUrl || current.thumbnailUrl,
            videoUrl: previous.videoUrl || current.videoUrl,
            videoId: previous.videoId || current.videoId,
            permalinkUrl: previous.permalinkUrl || current.permalinkUrl,
            landingPageUrl: previous.landingPageUrl || current.landingPageUrl,
            spend,
            impressions,
            clicksAll,
            ctrAll:
              impressions !== null && impressions > 0 && clicksAll !== null
                ? (clicksAll / impressions) * 100
                : null,
            cpc: clicksAll !== null && clicksAll > 0 && spend !== null ? spend / clicksAll : null,
            platformLeads,
            crmLeads: previous.crmLeads + current.crmLeads,
            won: previous.won + current.won,
            lost: previous.lost + current.lost,
            revenue,
            roas: spend !== null && spend > 0 ? revenue / spend : null,
          });
        }
        const rows = [...groupedRows.values()];
        rows.sort(
          (a, b) =>
            b.won - a.won ||
            b.crmLeads - a.crmLeads ||
            (b.platformLeads ?? -1) - (a.platformLeads ?? -1) ||
            (b.spend ?? -1) - (a.spend ?? -1) ||
            a.creativeName.localeCompare(b.creativeName),
        );

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
          sync: metaSync
            ? {
                mode: "meta-direct",
                requested: metaSync.requested,
                fetched: metaSync.fetched,
                failed: metaSync.failed,
                persisted: metaSync.persisted,
              }
            : null,
          appliedFilters: filters,
        });
      },
    },
  },
});
