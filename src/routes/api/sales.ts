import { createFileRoute } from "@tanstack/react-router";

/**
 * The Sales tab is payment lines; Full Invoiced Orders is order lines. They
 * describe overlapping-but-different money ($822,730 vs $783,425 all-time) so
 * both totals are returned rather than blending them into one "revenue".
 */
export const Route = createFileRoute("/api/sales")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered, computeTotals, groupBy } = await import("@/lib/metrics.server");
        const { parseFilters, json, capped } = await import("@/lib/api.server");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        const rows = data.sales;
        const money = (r: (typeof rows)[number]) => r.usdSales;

        const byDay = new Map<string, number>();
        for (const r of rows) {
          if (!r.paymentDate) continue;
          byDay.set(r.paymentDate, (byDay.get(r.paymentDate) ?? 0) + r.usdSales);
        }

        return json({
          totals: computeTotals(data),
          salesTotal: rows.reduce((s, r) => s + r.usdSales, 0),
          salesRows: rows.length,
          salesOrders: new Set(rows.map((r) => r.orderRef).filter(Boolean)).size,
          invoicedTotal: data.invoiced.reduce((s, r) => s + r.usdSales, 0),
          byCourse: groupBy(rows, (r) => r.course || "—", money),
          byCategory: groupBy(rows, (r) => r.category || "—", money),
          byTeam: groupBy(rows, (r) => r.salesTeam || "—", money),
          byTeamLeader: groupBy(rows, (r) => r.teamLeader || "—", money),
          bySalesperson: groupBy(rows, (r) => r.salesperson || "—", money),
          byMonth: groupBy(rows, (r) => r.month || "—", money).sort((a, b) =>
            a.label.localeCompare(b.label),
          ),
          byDay: [...byDay.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([date, revenue]) => ({ date, revenue })),
          detail: capped(
            rows.map((r) => ({
              paymentDate: r.paymentDate,
              invoiceDate: r.invoiceDate,
              orderRef: r.orderRef,
              partner: r.partner,
              course: r.course,
              category: r.category,
              salesperson: r.salesperson,
              teamLeader: r.teamLeader,
              salesTeam: r.salesTeam,
              eventStage: r.eventStage,
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
