import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/courses")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered, computeCourses, computeTotals, previousPeriod, isPreviousComparable, groupBy } =
          await import("@/lib/metrics.server");
        const { parseFilters, json } = await import("@/lib/api.server");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        const prevRange = previousPeriod(filters.from, filters.to);
        // No prior-period revenue delta when that window predates the data.
        const prevComparable = await isPreviousComparable(prevRange);
        const prevData = prevComparable && prevRange ? await getFiltered({ ...filters, ...prevRange }) : null;

        const courses = computeCourses(data, prevData ?? undefined);
        const detail = new URL(request.url).searchParams.get("detail");

        let drill = null;
        if (detail) {
          const rows = data.crm.filter((c) => c.course === detail);
          const invoices = data.invoiced.filter((i) => i.course === detail);
          const monthly = new Map<string, { month: string; revenue: number; leads: number; won: number }>();
          const at = (m: string) => {
            let e = monthly.get(m);
            if (!e) {
              e = { month: m, revenue: 0, leads: 0, won: 0 };
              monthly.set(m, e);
            }
            return e;
          };
          for (const i of invoices) if (i.revenueDate) at(i.revenueDate.slice(0, 7)).revenue += i.usdSales;
          for (const c of rows) {
            if (!c.createdAt) continue;
            const e = at(c.createdAt.slice(0, 7));
            e.leads++;
            if (c.isWon) e.won++;
          }
          drill = {
            course: detail,
            campaigns: groupBy(rows.filter((c) => c.fromCampaign), (c) => c.campaignName),
            salespeople: groupBy(rows, (c) => c.salesperson || "—"),
            teams: groupBy(rows, (c) => c.salesTeam || "—"),
            monthly: [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)),
          };
        }

        return json({
          courses,
          totals: computeTotals(data),
          drill,
          prevRange,
          prevComparable,
          health: data.snapshot.health,
          appliedFilters: filters,
        });
      },
    },
  },
});
