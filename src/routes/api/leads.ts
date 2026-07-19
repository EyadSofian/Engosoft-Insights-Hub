import { createFileRoute } from "@tanstack/react-router";

const ROW_CAP = 3000;

export const Route = createFileRoute("/api/leads")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered, groupSum } = await import("@/lib/metrics.server");
        const { parseFilters, json } = await import("@/lib/api.server");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        const rows = data.crm;
        const won = rows.filter((r) => r.cleanedStage.trim().toLowerCase() === "won").length;
        const count = <T,>(list: T[], key: (r: T) => string) => groupSum(list, key, () => 1);

        return json({
          total: rows.length,
          won,
          winRate: rows.length > 0 ? (won / rows.length) * 100 : 0,
          orderTotal: rows.reduce((s, r) => s + r.orderTotal, 0),
          byStage: count(rows, (r) => r.cleanedStage),
          bySource: count(rows, (r) => r.cleanedSource || r.source),
          byCourse: count(rows, (r) => r.course).slice(0, 20),
          byTeam: count(rows, (r) => r.salesTeam),
          bySalesperson: count(rows, (r) => r.salesperson).slice(0, 15),
          rows: rows.slice(0, ROW_CAP),
          truncated: rows.length > ROW_CAP,
          appliedFilters: filters,
        });
      },
    },
  },
});
