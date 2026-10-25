import { createFileRoute } from "@tanstack/react-router";

import {
  MEDIA_BUYERS as BUYERS,
  buyerReturn,
  isDelayedRevenueRow,
  mediaBuyerForCampaign as ownerOf,
  type MediaBuyerId as Owner,
} from "@/lib/media-buyers";

export const Route = createFileRoute("/api/media-buyers")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered, computePerf, div } = await import("@/lib/metrics.server");
        const { parseFilters, json } = await import("@/lib/api.server");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        const campaigns = computePerf(data, "campaign");

        // A campaign paid inside the window may have last spent before it. Its
        // spend up to the day before the window is read through the same
        // filters, so `buyerReturn` can put it in the ROAS denominator.
        const earlierSpendByKey = new Map<string, number>();
        if (filters.from && campaigns.some(isDelayedRevenueRow)) {
          const start = new Date(`${filters.from}T00:00:00Z`);
          start.setUTCDate(start.getUTCDate() - 1);
          const earlier = await getFiltered({
            ...filters,
            from: undefined,
            to: start.toISOString().slice(0, 10),
          });
          for (const row of computePerf(earlier, "campaign")) {
            if (row.spend > 0) earlierSpendByKey.set(row.key, row.spend);
          }
        }
        const earlierSpendOf = (row: (typeof campaigns)[number]): number =>
          isDelayedRevenueRow(row) ? (earlierSpendByKey.get(row.key) ?? 0) : 0;
        const groups = new Map<Owner, typeof campaigns>();
        groups.set("sayed", []);
        groups.set("shazly", []);
        const unassigned: typeof campaigns = [];
        const ambiguous: typeof campaigns = [];

        for (const row of campaigns) {
          const owner = ownerOf(row.course, row.campaignName || row.name);
          if (owner === "ambiguous") ambiguous.push(row);
          else if (owner) groups.get(owner)!.push(row);
          else unassigned.push(row);
        }

        const buyers = (["sayed", "shazly"] as Owner[]).map((id) => {
          const rows = groups.get(id)!;
          const spend = rows.reduce((sum, row) => sum + row.spend, 0);
          const revenue = rows.reduce((sum, row) => sum + row.revenue, 0);
          const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
          const clicksAll = rows.reduce((sum, row) => sum + row.clicksAll, 0);
          const reportedLeadRows = rows.filter((row) => row.platformLeads !== null);
          const platformLeads = reportedLeadRows.length
            ? reportedLeadRows.reduce((sum, row) => sum + (row.platformLeads ?? 0), 0)
            : null;
          const crmLeads = rows.reduce((sum, row) => sum + row.crmLeads, 0);
          const won = rows.reduce((sum, row) => sum + row.won, 0);
          const lost = rows.reduce((sum, row) => sum + row.lost, 0);
          const invoices = rows.reduce((sum, row) => sum + row.invoices, 0);
          const salesOrders = rows.reduce((sum, row) => sum + row.salesOrders, 0);
          const platforms = [...new Set(rows.flatMap((row) => row.platforms))];
          const ret = buyerReturn(rows, earlierSpendByKey);

          return {
            id,
            ...BUYERS[id],
            campaigns: rows.length,
            platforms,
            spend,
            revenue,
            impressions,
            clicksAll,
            platformLeads,
            crmLeads,
            won,
            lost,
            invoices,
            salesOrders,
            ctrAll: impressions > 0 ? (clicksAll / impressions) * 100 : null,
            cpl: platformLeads === null ? null : div(spend, platformLeads),
            cpa: div(spend, invoices),
            roas: ret.roas,
            roasSpend: ret.roasSpend,
            earlierSpend: ret.earlierSpend,
            delayedRevenue: ret.delayedRevenue,
            delayedCampaigns: ret.delayedCampaigns,
            uncostedRevenue: ret.uncostedRevenue,
            conversionRate: crmLeads > 0 ? (won / crmLeads) * 100 : null,
            lostRate: crmLeads > 0 ? (lost / crmLeads) * 100 : null,
            rows: rows.map((row) => ({ ...row, earlierSpend: earlierSpendOf(row) })),
          };
        });

        const spendOf = (rows: typeof campaigns) => rows.reduce((sum, row) => sum + row.spend, 0);
        return json({
          buyers,
          mapping: {
            sayed: "Standalone SAYED campaign token, except Auto/Automotive, BIM and CMRP",
            shazly:
              "Auto/Automotive, BIM and CMRP course ownership overrides campaign tokens; otherwise standalone SH",
          },
          coverage: {
            assignedCampaigns: buyers.reduce((sum, buyer) => sum + buyer.campaigns, 0),
            unassignedCampaigns: unassigned.length,
            unassignedSpend: spendOf(unassigned),
            ambiguousCampaigns: ambiguous.length,
            ambiguousSpend: spendOf(ambiguous),
          },
          health: data.snapshot.health,
          appliedFilters: filters,
        });
      },
    },
  },
});
