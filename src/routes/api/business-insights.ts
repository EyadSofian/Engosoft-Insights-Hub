import { createFileRoute } from "@tanstack/react-router";

/**
 * Lightweight executive facts for the home page.
 *
 * Do not build the full agent analytics report here: that report talks to PBX
 * and Chatwoot and is intentionally reserved for the employee/social pages.
 * The executive page only needs paid sales performance and the published quota,
 * both already present in the filtered Odoo snapshot and target store.
 */
export const Route = createFileRoute("/api/business-insights")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { parseFilters, json } = await import("@/lib/api.server");
        const { computeTeams, getFiltered } = await import("@/lib/metrics.server");
        const { loadTargetSource } = await import("@/lib/sales-targets.server");
        const { targetsByPerson, windowTarget } = await import("@/lib/sales-targets");
        const { normalizePersonName } = await import("@/lib/person-name");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        const people = computeTeams(data)
          .flatMap((team) => team.people ?? [])
          .filter((person) => person.name !== "—");
        const bestEmployee =
          [...people].sort(
            (a, b) =>
              b.revenue - a.revenue ||
              (b.conversionRate ?? 0) - (a.conversionRate ?? 0) ||
              b.crmLeads - a.crmLeads,
          )[0] ?? null;

        const { source } = await loadTargetSource();
        const { byName } = targetsByPerson(source);
        const matchedIds = new Set<string>();
        const missingMonths = new Set<string>();
        let totalTarget = 0;
        let complete = true;

        for (const person of people) {
          const published = byName.get(normalizePersonName(person.name));
          if (!published || matchedIds.has(published.entry.employeeId)) continue;
          const resolved = windowTarget(published.monthly, filters.from, filters.to);
          if (resolved.target === null) continue;
          matchedIds.add(published.entry.employeeId);
          totalTarget += resolved.target;
          complete = complete && resolved.complete;
          for (const month of resolved.monthsMissing) missingMonths.add(month);
        }

        return json({
          bestEmployee: bestEmployee
            ? {
                key: bestEmployee.key,
                name: bestEmployee.name,
                team: bestEmployee.parent ?? "—",
                paidRevenue: bestEmployee.revenue,
                leads: bestEmployee.crmLeads,
                won: bestEmployee.won,
                conversionRate: bestEmployee.conversionRate,
              }
            : null,
          targets: {
            totalTarget: matchedIds.size ? totalTarget : null,
            complete: matchedIds.size > 0 && complete,
            monthsMissing: [...missingMonths].sort(),
            matchedEmployees: matchedIds.size,
          },
        });
      },
    },
  },
});
