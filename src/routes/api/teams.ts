import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/teams")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered, computeTeams, computeTotals } = await import("@/lib/metrics.server");
        const { parseFilters, json } = await import("@/lib/api.server");
        const { rankHighestClosedLost } = await import("@/lib/lost-classification");
        const { METRIC_CONTRACTS } = await import("@/lib/metric-contracts");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        const teams = computeTeams(data);
        const { buildAgentAnalytics } = await import("@/lib/agent-analytics.server");
        const agentAnalytics = await buildAgentAnalytics(data, filters, teams);

        // The same roster the agent cards use, so a person is spelled one way
        // whether the eye lands on their card, their team row, or the
        // leaderboard. Cached, so this costs no second call to Odoo. Only
        // people are renamed: a sales team is not a person and has no HR record.
        const { getEmployeeDirectory } = await import("@/lib/employee-directory.server");
        const directory = await getEmployeeDirectory();
        const people = teams.flatMap((t) => t.people ?? []);
        for (const person of people) person.displayName = directory.displayNameFor(person.name);
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

        // Ranked by the closure movement (Lost/Close Date in the window), never
        // by the cohort `lost` field.
        const highestClosedLost = rankHighestClosedLost(
          agentAnalytics.agents.map((agent) => ({
            key: agent.key,
            name: agent.displayName || agent.name,
            team: agent.team,
            closedLostInPeriod: agent.closedLostInPeriod,
            createdAndLostInPeriod: agent.createdAndLostInPeriod,
            olderCohortClosedLostInPeriod: agent.olderCohortClosedLostInPeriod,
            undatedCohortClosedLostInPeriod: agent.undatedCohortClosedLostInPeriod,
            cohortLost: agent.cohortLost,
          })),
        );

        return json({
          teams,
          ...agentAnalytics,
          leaderboard,
          needsAttention,
          rankings: {
            highestClosedLost,
            contract: METRIC_CONTRACTS.closedLostInPeriod,
          },
          medianConversion: medianConv,
          totals: computeTotals(data),
          health: data.snapshot.health,
          appliedFilters: filters,
        });
      },
    },
  },
});
