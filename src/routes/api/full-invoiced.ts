import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/full-invoiced")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered, computeTotals, groupBy } = await import("@/lib/metrics.server");
        const { parseFilters, json, capped } = await import("@/lib/api.server");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        const rows = data.invoiced;
        const labels = data.snapshot.sourceLabels;

        const attributed = rows.filter((r) => !!r.campaignKey);
        const unattributed = rows.filter((r) => !r.campaignKey);
        const money = (rs: typeof rows) => rs.reduce((s, r) => s + r.usdSales, 0);

        return json({
          totals: computeTotals(data),
          byCampaign: groupBy(attributed, (r) => r.campaignName || "—", (r) => r.usdSales),
          byCourse: groupBy(rows, (r) => r.course || "—", (r) => r.usdSales),
          byTeam: groupBy(rows, (r) => r.salesTeam || "—", (r) => r.usdSales),
          bySalesperson: groupBy(rows, (r) => r.salesperson || "—", (r) => r.usdSales),
          bySource: groupBy(rows, (r) => labels.get(r.sourceKey) ?? r.source ?? "—", (r) => r.usdSales),
          byMonth: groupBy(rows, (r) => (r.revenueDate ? r.revenueDate.slice(0, 7) : "—"), (r) => r.usdSales)
            .sort((a, b) => a.label.localeCompare(b.label)),
          // Both sides of the attribution gap, with counts, so the missing 54%
          // of invoice lines stays visible instead of quietly vanishing.
          attribution: {
            withCampaign: { rows: attributed.length, revenue: money(attributed) },
            withoutCampaign: { rows: unattributed.length, revenue: money(unattributed) },
          },
          detail: capped(
            rows.map((r) => ({
              orderRef: r.orderRef,
              revenueDate: r.revenueDate,
              invoiceDate: r.invoiceDate,
              customer: r.customer,
              product: r.product,
              course: r.course,
              campaign: r.campaignName,
              adName: r.adName,
              adset: r.adset,
              adsetOrigin: r.adsetOrigin,
              salesperson: r.salesperson,
              salesTeam: r.salesTeam,
              source: labels.get(r.sourceKey) ?? r.source,
              usdSales: r.usdSales,
            })),
          ),
          health: data.snapshot.health,
          appliedFilters: filters,
        });
      },
    },
  },
});
