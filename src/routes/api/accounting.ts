import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/accounting")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered, computeTotals, groupBy } = await import("@/lib/metrics.server");
        const { parseFilters, json, capped } = await import("@/lib/api.server");
        const { buildAccountingCourses } = await import("@/lib/accounting-courses");
        const { fxRatesFromFilters } = await import("@/lib/fx-rates");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        const rows = data.accounting;
        const paid = (row: (typeof rows)[number]) => row.usdPaid;
        const invoiceCount = new Set(rows.map((row) => row.movement).filter(Boolean)).size;
        const paidUsd = rows.reduce((sum, row) => sum + row.usdPaid, 0);

        const byDay = new Map<string, { date: string; spend: number; revenue: number }>();
        const atDay = (date: string) => {
          let point = byDay.get(date);
          if (!point) {
            point = { date, spend: 0, revenue: 0 };
            byDay.set(date, point);
          }
          return point;
        };
        for (const row of data.ads) {
          if (!row.date) continue;
          atDay(row.date).spend += row.spend;
        }
        for (const row of rows) {
          if (!row.paymentDate) continue;
          atDay(row.paymentDate).revenue += row.usdPaid;
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
          byDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
          courses: buildAccountingCourses(rows),
          detail: capped(
            rows.map((row) => ({
              id: row.id,
              movement: row.movement,
              paymentDate: row.paymentDate,
              invoiceDate: row.invoiceDate,
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
              quantity: row.quantity,
              untaxedTotal: row.untaxedTotal,
              totalInCurrency: row.totalInCurrency,
              currency: row.currency,
              companyCurrency: row.companyCurrency,
              usdPaid: row.usdPaid,
              website: row.website,
              event: row.event,
              eventStage: row.eventStage,
              source: row.source,
            })),
          ),
          health: data.snapshot.health,
          source: {
            tab: "Paid Invoices",
            dateBasis: "Payment Date",
            valueBasis: "USD Paid",
            grain: "invoice_product_line",
          },
          fxRates: fxRatesFromFilters(filters),
          appliedFilters: filters,
        });
      },
    },
  },
});
