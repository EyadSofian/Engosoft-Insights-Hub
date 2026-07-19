import { createFileRoute } from "@tanstack/react-router";

const ROW_CAP = 3000;

export const Route = createFileRoute("/api/full-invoiced")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered, groupSum } = await import("@/lib/metrics.server");
        const { parseFilters, json } = await import("@/lib/api.server");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        const rows = data.invoiced;
        const total = rows.reduce((s, r) => s + r.usdSales, 0);
        const orders = new Set(rows.map((r) => r.orderRef).filter(Boolean)).size || rows.length;

        return json({
          total,
          count: rows.length,
          orders,
          avgOrder: orders > 0 ? total / orders : 0,
          byCourse: groupSum(rows, (r) => r.course, (r) => r.usdSales).slice(0, 20),
          byCategory: groupSum(rows, (r) => r.mainCategory, (r) => r.usdSales).slice(0, 20),
          byTeam: groupSum(rows, (r) => r.salesTeam, (r) => r.usdSales),
          byCampaign: groupSum(rows, (r) => r.campaignName, (r) => r.usdSales).slice(0, 20),
          bySource: groupSum(rows, (r) => r.cleanedSource || r.source, (r) => r.usdSales),
          rows: rows.slice(0, ROW_CAP),
          truncated: rows.length > ROW_CAP,
          // How much of this revenue actually carries a campaign tag.
          missingDate: rows.filter((r) => !r.revenueDate).length,
          appliedFilters: filters,
        });
      },
    },
  },
});
