import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/meta")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered, computeTotals } = await import("@/lib/metrics.server");
        const { parseFilters, json } = await import("@/lib/api.server");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        const totals = computeTotals(data);

        const byDay = new Map<
          string,
          { date: string; spend: number; impressions: number; clicks: number; linkClicks: number; leads: number; ctr: number; cpm: number }
        >();
        for (const m of data.meta) {
          if (!m.date) continue;
          let d = byDay.get(m.date);
          if (!d) {
            d = { date: m.date, spend: 0, impressions: 0, clicks: 0, linkClicks: 0, leads: 0, ctr: 0, cpm: 0 };
            byDay.set(m.date, d);
          }
          d.spend += m.spend;
          d.impressions += m.impressions;
          d.clicks += m.clicksAll;
          d.linkClicks += m.linkClicks;
          d.leads += m.metaLeads;
        }
        // CTR/CPM recomputed from the day's totals, never averaged across rows.
        for (const d of byDay.values()) {
          d.ctr = d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0;
          d.cpm = d.impressions > 0 ? (d.spend / d.impressions) * 1000 : 0;
        }

        const byAd = new Map<
          string,
          { ad: string; campaign: string; adset: string; spend: number; impressions: number; clicks: number; linkClicks: number; leads: number; ctr: number; ctrLink: number; cpm: number; cpc: number; cpl: number }
        >();
        for (const m of data.meta) {
          if (!m.adName) continue;
          const k = m.adName + "::" + m.campaign;
          let a = byAd.get(k);
          if (!a) {
            a = {
              ad: m.adName,
              campaign: m.campaign,
              adset: m.adsetName,
              spend: 0, impressions: 0, clicks: 0, linkClicks: 0, leads: 0,
              ctr: 0, ctrLink: 0, cpm: 0, cpc: 0, cpl: 0,
            };
            byAd.set(k, a);
          }
          a.spend += m.spend;
          a.impressions += m.impressions;
          a.clicks += m.clicksAll;
          a.linkClicks += m.linkClicks;
          a.leads += m.metaLeads;
        }
        for (const a of byAd.values()) {
          a.ctr = a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0;
          a.ctrLink = a.impressions > 0 ? (a.linkClicks / a.impressions) * 100 : 0;
          a.cpm = a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0;
          a.cpc = a.clicks > 0 ? a.spend / a.clicks : 0;
          a.cpl = a.leads > 0 ? a.spend / a.leads : 0;
        }

        return json({
          totals,
          daily: Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date)),
          byAd: Array.from(byAd.values()).sort((a, b) => b.spend - a.spend),
          metaDateMin: data.metaDateMin,
          metaDateMax: data.metaDateMax,
          appliedFilters: filters,
        });
      },
    },
  },
});
