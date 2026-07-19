import { createFileRoute } from "@tanstack/react-router";

/** Per-platform ad metrics. Unavailable metrics come back `null`, never 0. */
export const Route = createFileRoute("/api/ads")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered, computeTotals, computePerf, div } = await import("@/lib/metrics.server");
        const { parseFilters, json } = await import("@/lib/api.server");
        const { PLATFORMS } = await import("@/lib/constants");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);

        const byPlatform = PLATFORMS.map((platform) => {
          const rows = data.ads.filter((a) => a.platform === platform);
          const spend = rows.reduce((s, r) => s + r.spend, 0);
          const impressions = rows.reduce((s, r) => s + r.impressions, 0);
          const clicksAll = rows.reduce((s, r) => s + r.clicksAll, 0);
          // Snapchat reports neither link clicks nor leads; `null` keeps those
          // columns honest instead of showing a zero the platform never sent.
          const reportsLinks = rows.some((r) => r.linkClicks !== null);
          const reportsLeads = rows.some((r) => r.platformLeads !== null);
          const linkClicks = reportsLinks ? rows.reduce((s, r) => s + (r.linkClicks ?? 0), 0) : null;
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
            dateMin: rows.map((r) => r.date).filter(Boolean).sort()[0] ?? "",
            dateMax: rows.map((r) => r.date).filter(Boolean).sort().pop() ?? "",
          };
        }).filter((p) => p.rows > 0);

        const dayMap = new Map<
          string,
          { date: string; meta: number; snapchat: number; impressions: number; clicks: number }
        >();
        for (const a of data.ads) {
          if (!a.date) continue;
          let e = dayMap.get(a.date);
          if (!e) {
            e = { date: a.date, meta: 0, snapchat: 0, impressions: 0, clicks: 0 };
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
          byAd: computePerf(data, "ad").slice(0, 300),
          byAdset: computePerf(data, "adset").slice(0, 300),
          accounts: data.snapshot.accounts,
          health: data.snapshot.health,
          appliedFilters: filters,
        });
      },
    },
  },
});
