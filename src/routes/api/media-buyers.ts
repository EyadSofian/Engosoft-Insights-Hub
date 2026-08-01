import { createFileRoute } from "@tanstack/react-router";

type Owner = "sayed" | "shazly";

const BUYERS: Record<Owner, { name: string; token: string }> = {
  sayed: { name: "Sayed", token: "SAYED" },
  shazly: { name: "Shazly", token: "SH" },
};

function ownerOf(name: string): Owner | "ambiguous" | null {
  const sayed = /(^|[^a-z0-9])sayed([^a-z0-9]|$)/i.test(name);
  const shazly = /(^|[^a-z0-9])sh([^a-z0-9]|$)/i.test(name);
  if (sayed && shazly) return "ambiguous";
  if (sayed) return "sayed";
  if (shazly) return "shazly";
  return null;
}

export const Route = createFileRoute("/api/media-buyers")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered, computePerf, div } = await import("@/lib/metrics.server");
        const { parseFilters, json } = await import("@/lib/api.server");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        const campaigns = computePerf(data, "campaign");
        const groups = new Map<Owner, typeof campaigns>();
        groups.set("sayed", []);
        groups.set("shazly", []);
        const unassigned: typeof campaigns = [];
        const ambiguous: typeof campaigns = [];

        for (const row of campaigns) {
          const owner = ownerOf(row.campaignName || row.name);
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
            roas: div(revenue, spend),
            conversionRate: crmLeads > 0 ? (won / crmLeads) * 100 : null,
            lostRate: crmLeads > 0 ? (lost / crmLeads) * 100 : null,
            rows,
          };
        });

        const spendOf = (rows: typeof campaigns) => rows.reduce((sum, row) => sum + row.spend, 0);
        return json({
          buyers,
          mapping: {
            sayed: "Campaign name contains the standalone token SAYED",
            shazly: "Campaign name contains the standalone token SH",
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
