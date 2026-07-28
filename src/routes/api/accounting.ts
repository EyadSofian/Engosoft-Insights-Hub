import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/accounting")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered, computeTotals, groupBy } = await import("@/lib/metrics.server");
        const { parseFilters, json, capped } = await import("@/lib/api.server");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        const rows = data.accounting;
        const paid = (row: (typeof rows)[number]) => row.usdPaid;
        const invoiceCount = new Set(rows.map((row) => row.movement).filter(Boolean)).size;
        const paidUsd = rows.reduce((sum, row) => sum + row.usdPaid, 0);

        const byDay = new Map<string, number>();
        for (const row of rows) {
          if (!row.paymentDate) continue;
          byDay.set(row.paymentDate, (byDay.get(row.paymentDate) ?? 0) + row.usdPaid);
        }

        return json({
          totals: computeTotals(data),
          summary: {
            paidUsd,
            invoices: invoiceCount,
            productLines: rows.length,
            averageInvoice: invoiceCount > 0 ? paidUsd / invoiceCount : null,
          },
          byProduct: groupBy(rows, (row) => row.product || "—", paid),
          byProductCategory: groupBy(rows, (row) => row.productCategory || "—", paid),
          byMainCategory: groupBy(rows, (row) => row.mainCategory || "—", paid),
          byCompany: groupBy(rows, (row) => row.company || "—", paid),
          byCurrency: groupBy(rows, (row) => row.currency || "—", paid),
          byTeam: groupBy(rows, (row) => row.salesTeam || "—", paid),
          bySalesperson: groupBy(rows, (row) => row.salesperson || "—", paid),
          byMonth: groupBy(rows, (row) => row.month || "—", paid).sort((a, b) =>
            a.label.localeCompare(b.label),
          ),
          byDay: [...byDay.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([date, revenue]) => ({ date, revenue })),
          detail: capped(
            rows.map((row) => ({
              id: row.id,
              movement: row.movement,
              paymentDate: row.paymentDate,
              invoiceDate: row.invoiceDate,
              orderRef: row.orderRef,
              partner: row.partner,
              country: row.country,
              company: row.company,
              salesperson: row.salesperson,
              salesTeam: row.salesTeam,
              code: row.code,
              product: row.product,
              productCategory: row.productCategory,
              mainCategory: row.mainCategory,
              productCode: row.productCode,
              untaxedTotal: row.untaxedTotal,
              totalInCurrency: row.totalInCurrency,
              currency: row.currency,
              companyCurrency: row.companyCurrency,
              usdPaid: row.usdPaid,
              website: row.website,
              event: row.event,
              eventStage: row.eventStage,
            })),
          ),
          health: data.snapshot.health,
          source: {
            tab: data.snapshot.tabSyncs.find((item) => item.key === "accounting")?.label ?? "Accounting",
            dateBasis: "Payment Date",
            valueBasis: "USD Paid",
            grain: "invoice_product_line",
          },
          appliedFilters: filters,
        });
      },
    },
  },
});
