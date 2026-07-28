import { createFileRoute } from "@tanstack/react-router";
import type { Platform } from "@/lib/types";

/** Per-platform ad metrics. Unavailable metrics come back `null`, never 0. */
export const Route = createFileRoute("/api/ads")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered, computeTotals, computePerf, div } =
          await import("@/lib/metrics.server");
        const { parseFilters, json } = await import("@/lib/api.server");
        const { PLATFORMS } = await import("@/lib/constants");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);

        const byPlatform = PLATFORMS.map((platform) => {
          const rows = data.ads.filter((a) => a.platform === platform);
          const spend = rows.reduce((s, r) => s + r.spend, 0);
          const impressions = rows.reduce((s, r) => s + r.impressions, 0);
          const clicksAll = rows.reduce((s, r) => s + r.clicksAll, 0);
          // Availability is row-driven: the corrected Snapchat feed reports
          // native leads but still has no link-click metric.
          const reportsLinks = rows.some((r) => r.linkClicks !== null);
          const reportsLeads = rows.some((r) => r.platformLeads !== null);
          const linkClicks = reportsLinks
            ? rows.reduce((s, r) => s + (r.linkClicks ?? 0), 0)
            : null;
          const platformLeads = reportsLeads
            ? rows.reduce((s, r) => s + (r.platformLeads ?? 0), 0)
            : null;
          const cpmRatio = div(spend, impressions);
          const ctr = div(clicksAll, impressions);
          const ctrLink = linkClicks === null ? null : div(linkClicks, impressions);
          return {
            platform,
            rows: rows.length,
            spend,
            impressions,
            clicksAll,
            linkClicks,
            platformLeads,
            viewCompletions: rows.some((r) => r.viewCompletions !== null)
              ? rows.reduce((s, r) => s + (r.viewCompletions ?? 0), 0)
              : null,
            ctrAll: ctr === null ? null : ctr * 100,
            ctrLink: ctrLink === null ? null : ctrLink * 100,
            cpm: cpmRatio === null ? null : cpmRatio * 1000,
            cpc: div(spend, clicksAll),
            platformCpl: platformLeads === null ? null : div(spend, platformLeads),
            accounts: [...new Set(rows.map((r) => r.account))],
            dateMin:
              rows
                .map((r) => r.date)
                .filter(Boolean)
                .sort()[0] ?? "",
            dateMax:
              rows
                .map((r) => r.date)
                .filter(Boolean)
                .sort()
                .pop() ?? "",
          };
        }).filter((p) => p.rows > 0);

        // Keyed by Platform rather than a hand-written literal, so adding a
        // platform cannot leave one silently missing from the daily series.
        type DayPoint = { date: string; impressions: number; clicks: number } & Record<
          Platform,
          number
        >;
        const blankDay = (date: string): DayPoint => {
          const e = { date, impressions: 0, clicks: 0 } as DayPoint;
          for (const p of PLATFORMS) e[p] = 0;
          return e;
        };
        const dayMap = new Map<string, DayPoint>();
        for (const a of data.ads) {
          if (!a.date) continue;
          let e = dayMap.get(a.date);
          if (!e) {
            e = blankDay(a.date);
            dayMap.set(a.date, e);
          }
          e[a.platform] += a.spend;
          e.impressions += a.impressions;
          e.clicks += a.clicksAll;
        }

        return json({
          totals: computeTotals(data),
          byPlatform,
          byDay: [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
          // Return the complete aggregate. Client-side search, sorting and CSV
          // export must operate on the same population shown by the row count.
          byAd: computePerf(data, "ad"),
          byAdset: computePerf(data, "adset"),
          accounts: data.snapshot.accounts,
          health: data.snapshot.health,
          appliedFilters: filters,
        });
      },
    },
  },
});
