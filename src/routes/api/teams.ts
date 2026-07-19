import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/teams")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered, computeTeams, computeTotals } = await import("@/lib/metrics.server");
        const { parseFilters, json } = await import("@/lib/api.server");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        const teams = computeTeams(data);

        const people = teams.flatMap((t) => t.people ?? []);
        const MIN_LEADS = 20;
        const leaderboard = [...people]
          .filter((p) => p.crmLeads >= MIN_LEADS)
          .sort((a, b) => (b.conversionRate ?? 0) - (a.conversionRate ?? 0))
          .slice(0, 10);

        // The benchmark is the median across people who handle real volume. Taken
        // across everyone it collapses to 0% — most names carry a handful of
        // leads and no wins — and then nobody ever falls below it.
        const medianConv = (() => {
          const vals = people
            .filter((p) => p.crmLeads >= MIN_LEADS && p.conversionRate !== null)
            .map((p) => p.conversionRate!)
            .sort((a, b) => a - b);
          if (!vals.length) return 0;
          const mid = Math.floor(vals.length / 2);
          return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
        })();

        // High volume, low conversion — where coaching pays off most.
        const needsAttention = people
          .filter((p) => p.crmLeads >= 50 && (p.conversionRate ?? 0) < medianConv)
          .sort((a, b) => b.crmLeads - a.crmLeads)
          .slice(0, 10);

        return json({
          teams,
          leaderboard,
          needsAttention,
          medianConversion: medianConv,
          totals: computeTotals(data),
          health: data.snapshot.health,
          appliedFilters: filters,
        });
      },
    },
  },
});
