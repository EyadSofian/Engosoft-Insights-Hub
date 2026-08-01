import { createFileRoute } from "@tanstack/react-router";

/** @deprecated Compatibility endpoint. New clients should use `/api/accounting`. */
export const Route = createFileRoute("/api/sales")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered, computeTotals, groupBy } = await import("@/lib/metrics.server");
        const { parseFilters, json, capped } = await import("@/lib/api.server");
        const { accountingReportingDate } = await import("@/lib/accounting-policy");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        const rows = data.accounting;
        const money = (row: (typeof rows)[number]) => row.usdPaid;
        const dateBasis = filters.dateBasis === "invoice" ? "invoice" : "payment";

        const byDay = new Map<string, number>();
        for (const r of rows) {
          const date = accountingReportingDate(r, dateBasis);
          if (!date) continue;
          byDay.set(date, (byDay.get(date) ?? 0) + r.usdPaid);
        }

        return json({
          totals: computeTotals(data),
          salesTotal: rows.reduce((s, r) => s + r.usdPaid, 0),
          salesRows: rows.length,
          salesOrders: new Set(rows.map((r) => r.movement).filter(Boolean)).size,
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
              movement: r.movement,
              moveType: r.moveType,
              isCreditNote: r.isCreditNote,
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
              usdSales: r.usdPaid,
            })),
          ),
          health: data.snapshot.health,
          appliedFilters: filters,
        });
      },
    },
  },
});
