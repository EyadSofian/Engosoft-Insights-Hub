import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/lost")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const {
          getFiltered,
          archivedLostReportingDate,
          computeLost,
          computeTotals,
          authoritativeLostLeads,
          archivedCrmLeads,
        } = await import("@/lib/metrics.server");
        const { parseFilters, json, capped } = await import("@/lib/api.server");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        const labels = data.snapshot.sourceLabels;

        const lostRows = authoritativeLostLeads(data);
        const archivedRows = archivedCrmLeads(data);

        // Each team's denominator is its clean CRM population plus that team's
        // archived losses. The numerator is never inferred from CRM stage text.
        const leadsByTeam = new Map<string, number>();
        const lostByTeam = new Map<string, number>();
        for (const c of data.crm) {
          const k = c.salesTeam || "—";
          leadsByTeam.set(k, (leadsByTeam.get(k) ?? 0) + 1);
        }
        for (const archived of archivedRows) {
          const k = archived.salesTeam || "—";
          leadsByTeam.set(k, (leadsByTeam.get(k) ?? 0) + 1);
        }
        for (const lost of lostRows) {
          const k = lost.salesTeam || "—";
          lostByTeam.set(k, (lostByTeam.get(k) ?? 0) + 1);
        }
        const teamLostRates = [...leadsByTeam.entries()]
          .map(([team, leads]) => {
            const lost = lostByTeam.get(team) ?? 0;
            return { team, leads, lost, rate: leads > 0 ? (lost / leads) * 100 : null };
          })
          .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));

        return json({
          breakdown: computeLost(data),
          teamLostRates,
          totals: computeTotals(data),
          detail: capped(
            lostRows.map((l) => ({
              createdAt: l.createdAt,
              closeDate: l.closeDate,
              reportingDate: archivedLostReportingDate(l, data.snapshot),
              campaign: l.campaignName,
              adName: l.adName,
              reason: l.lossReason,
              course: l.course,
              mainCategory: l.mainCategory,
              salesTeam: l.salesTeam,
              salesperson: l.salesperson,
              source: labels.get(l.sourceKey) ?? l.source,
              stage: l.stage,
            })),
          ),
          health: data.snapshot.health,
          appliedFilters: filters,
        });
      },
    },
  },
});
