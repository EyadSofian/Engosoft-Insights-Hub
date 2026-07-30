import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/profitability")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { parseFilters, json } = await import("@/lib/api.server");
        const { getProfitability } = await import("@/lib/profitability.server");
        const filters = await parseFilters(request);
        const from = filters.from || "2026-01-01";
        const to = filters.to || new Date().toISOString().slice(0, 10);
        return json({
          ...(await getProfitability(from, to, filters.company)),
          appliedFilters: filters,
          source: {
            system: "Odoo 17 Profit and Loss",
            reportId: Number(process.env.ODOO_PNL_REPORT_ID || 11),
            postedOnly: true,
            companies: filters.company || [2, 3, 4],
          },
        });
      },
    },
  },
});
