import { createFileRoute } from "@tanstack/react-router";
import type { Platform } from "@/lib/types";

/** Per-platform ad metrics. Unavailable metrics come back `null`, never 0. */
export const Route = createFileRoute("/api/ads")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered, computeTotals, computePerf, dailyTrend, div, UNKNOWN_ADSET_KEY } =
          await import("@/lib/metrics.server");
        const { parseFilters, json } = await import("@/lib/api.server");
        const { PLATFORMS } = await import("@/lib/constants");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);

        // Optional. Without it the response keeps its original shape, which is
        // what the production validator reads. With it the page asks for one
        // grain at a time instead of shipping every ad row on first paint.
        const rawGrain = new URL(request.url).searchParams.get("grain");
        const grain =
          rawGrain === "campaign" || rawGrain === "adset" || rawGrain === "ad" ? rawGrain : null;

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

        /* --- platform switcher availability ---------------------------------
         * Answers one question the blocks above cannot: which platforms have
         * data *at all* in this window. It deliberately drops the platform
         * filter and keeps every other one, so selecting Meta does not make
         * Snapchat look empty. Nothing here is a new metric — each platform is
         * scored by running the existing filter + totals path scoped to it.
         *
         * TikTok is the reason this exists. It produces thousands of CRM leads
         * with no spend tab, so it must appear as a real platform with its lead
         * count and an explicit "spend not available" state, rather than either
         * vanishing or reporting a fabricated zero cost. */
        const totals = computeTotals(data);
        // The "all platforms" tab needs the unscoped totals, otherwise selecting
        // Meta would make the tab it came from report Meta's numbers. It also
        // cannot be a sum of the three platform rows: leads from UChat, WhatsApp
        // and referrals belong to no ad platform and would silently vanish.
        const overall = filters.platform
          ? computeTotals(await getFiltered({ ...filters, platform: undefined }))
          : totals;

        const coverage = await Promise.all(
          PLATFORMS.map(async (platform) => {
            const scoped = await getFiltered({ ...filters, platform });
            const totals = computeTotals(scoped);
            const adRows = scoped.ads.length;
            return {
              platform,
              adRows,
              /** False means: no spend tab for this platform, so cost is unknown. */
              spendAvailable: adRows > 0,
              spend: totals.spend,
              impressions: totals.impressions,
              clicksAll: totals.clicksAll,
              ctrAll: totals.ctrAll,
              platformLeads: totals.platformLeads,
              linkClicks: totals.linkClicks,
              crmLeads: totals.totalLeads,
              won: totals.won,
              lost: totals.lost,
              revenue: totals.revenue,
              accounts: [...new Set(scoped.ads.map((a) => a.account))],
            };
          }),
        );

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
          totals,
          byPlatform,
          platformCoverage: coverage,
          platformCoverageAll: {
            spend: overall.spend,
            crmLeads: overall.totalLeads,
            won: overall.won,
            lost: overall.lost,
            revenue: overall.revenue,
          },
          byDay: [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
          // Spend, revenue, leads and won on one shared day axis.
          trend: dailyTrend(data),
          // One grain at a time when asked for; otherwise the original complete
          // aggregate, so existing consumers and the validator are unaffected.
          ...(grain
            ? { grain, rows: computePerf(data, grain) }
            : { byAd: computePerf(data, "ad"), byAdset: computePerf(data, "adset") }),
          accounts: data.snapshot.accounts,
          unknownAdsetKey: UNKNOWN_ADSET_KEY,
          health: data.snapshot.health,
          appliedFilters: filters,
        });
      },
    },
  },
});
