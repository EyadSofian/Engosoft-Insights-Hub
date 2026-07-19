import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/lost")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered, computeLost, computeTotals } = await import("@/lib/metrics.server");
        const { parseFilters, json, capped } = await import("@/lib/api.server");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        const labels = data.snapshot.sourceLabels;

        // Each team's own lost rate needs the team's total CRM leads, not just
        // its share of the lost pile — a big team loses more in absolute terms
        // while still losing a smaller fraction of what it handles.
        const leadsByTeam = new Map<string, number>();
        const lostByTeam = new Map<string, number>();
        for (const c of data.crm) {
          const k = c.salesTeam || "—";
          leadsByTeam.set(k, (leadsByTeam.get(k) ?? 0) + 1);
          if (c.isLost) lostByTeam.set(k, (lostByTeam.get(k) ?? 0) + 1);
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
            data.lost.map((l) => ({
              createdAt: l.createdAt,
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
