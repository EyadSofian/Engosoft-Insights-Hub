import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/leads")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered, computeTotals, computeLeadOrigin, groupBy } = await import(
          "@/lib/metrics.server"
        );
        const { parseFilters, json, capped } = await import("@/lib/api.server");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        const labels = data.snapshot.sourceLabels;

        const detail = capped(
          data.crm.map((c) => ({
            createdAt: c.createdAt,
            contact: c.contact,
            campaign: c.campaignName,
            adName: c.adName,
            adset: c.adset,
            adsetOrigin: c.adsetOrigin,
            course: c.course,
            stage: c.cleanedStage,
            source: labels.get(c.sourceKey) ?? c.source,
            salesperson: c.salesperson,
            salesTeam: c.salesTeam,
            subTeam: c.subTeam,
            priority: c.priority,
            closedAt: c.closedAt,
            daysToClose: c.daysToClose,
          })),
        );

        return json({
          totals: computeTotals(data),
          origin: computeLeadOrigin(data),
          byStage: groupBy(data.crm, (c) => c.cleanedStage || "—"),
          bySource: groupBy(data.crm, (c) => labels.get(c.sourceKey) ?? c.source ?? "—"),
          byCourse: groupBy(data.crm, (c) => c.course || "—"),
          byTeam: groupBy(data.crm, (c) => c.salesTeam || "—"),
          bySubTeam: groupBy(data.crm, (c) => c.subTeam || "—"),
          bySalesperson: groupBy(data.crm, (c) => c.salesperson || "—"),
          byCampaign: groupBy(data.crm.filter((c) => c.fromCampaign), (c) => c.campaignName || "—"),
          byPriority: groupBy(data.crm, (c) => c.priority || "—"),
          byMonth: groupBy(data.crm, (c) => (c.createdAt ? c.createdAt.slice(0, 7) : "—")).sort((a, b) =>
            a.label.localeCompare(b.label),
          ),
          detail,
          health: data.snapshot.health,
          appliedFilters: filters,
        });
      },
    },
  },
});
