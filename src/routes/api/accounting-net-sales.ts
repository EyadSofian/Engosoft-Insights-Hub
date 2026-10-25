import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/accounting-net-sales")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { parseFilters, json } = await import("@/lib/api.server");
        const { fxRatesFromFilters } = await import("@/lib/fx-rates");
        const { buildNetSalesMonths, usdCents } = await import("@/lib/net-sales");
        const { loadNetSalesLedger } = await import("@/lib/net-sales-odoo.server");
        const filters = await parseFilters(request);
        const scope = new URL(request.url).searchParams.get("scope") === "all" ? "all" : "report";
        const from = filters.from ?? "2025-01-01";
        const to = filters.to ?? new Date().toISOString().slice(0, 10);
        if (from > to)
          return json({ error: "The accounting start date is after the end date." }, 400);
        try {
          const ledger = await loadNetSalesLedger(from, to, filters.company, scope);
          const rates = fxRatesFromFilters(filters);
          const months = buildNetSalesMonths(ledger.rows, rates);
          const total = months.reduce(
            (sum, month) => ({
              salesUsd: sum.salesUsd + month.salesUsd,
              certificateUsd: sum.certificateUsd + month.certificateUsd,
              otherIncomeUsd: sum.otherIncomeUsd + month.otherIncomeUsd,
              gatewayFeesUsd: sum.gatewayFeesUsd + month.gatewayFeesUsd,
              outputVatUsd: sum.outputVatUsd + month.outputVatUsd,
              roundingUsd: sum.roundingUsd + month.roundingUsd,
              netSalesUsd: sum.netSalesUsd + month.netSalesUsd,
            }),
            {
              salesUsd: 0,
              certificateUsd: 0,
              otherIncomeUsd: 0,
              gatewayFeesUsd: 0,
              outputVatUsd: 0,
              roundingUsd: 0,
              netSalesUsd: 0,
            },
          );
          for (const key of [
            "salesUsd",
            "certificateUsd",
            "otherIncomeUsd",
            "gatewayFeesUsd",
            "outputVatUsd",
            "roundingUsd",
          ] as const) {
            total[key] = usdCents(total[key]);
          }
          total.netSalesUsd = usdCents(total.salesUsd - total.gatewayFeesUsd);
          return json({
            period: { from, to },
            months,
            total,
            companies: ledger.companies,
            scope: filters.company ? "selected-company" : scope,
            accountCodes: ledger.accountCodes,
            fxRates: rates,
            source: {
              model: "account.move.line",
              state: "posted",
              dateBasis: "journal_entry_date",
              sales: "income accounts, credit less debit, excluding product 246",
              gatewayFees: "5121807 — platform collection expenses, debit less credit",
              vat: "2131006/2131007 — output VAT shown for reconciliation, not deducted twice",
              rounding: "40000016/40000017 — rounding write-offs monitored separately",
            },
          });
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Could not read posted Odoo accounting entries.",
            },
            503,
          );
        }
      },
    },
  },
});
