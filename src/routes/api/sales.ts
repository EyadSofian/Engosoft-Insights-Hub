import { createFileRoute } from "@tanstack/react-router";

/** Detail tables stream a capped slice; aggregates always use every row. */
const ROW_CAP = 3000;

export const Route = createFileRoute("/api/sales")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered, groupSum } = await import("@/lib/metrics.server");
        const { parseFilters, json } = await import("@/lib/api.server");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        const rows = data.sales;
        const total = rows.reduce((s, r) => s + r.usdSales, 0);

        const byMonth = groupSum(rows, (r) => r.month, (r) => r.usdSales).sort((a, b) =>
          a.label.localeCompare(b.label),
        );

        return json({
          total,
          count: rows.length,
          avgOrder: rows.length > 0 ? total / rows.length : 0,
          byCourse: groupSum(rows, (r) => r.course, (r) => r.usdSales).slice(0, 20),
          byCategory: groupSum(rows, (r) => r.category, (r) => r.usdSales).slice(0, 20),
          byTeam: groupSum(rows, (r) => r.salesTeam, (r) => r.usdSales),
          bySalesperson: groupSum(rows, (r) => r.salesperson, (r) => r.usdSales).slice(0, 15),
          byMonth,
          rows: rows.slice(0, ROW_CAP),
          truncated: rows.length > ROW_CAP,
          appliedFilters: filters,
        });
      },
    },
  },
});
