import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/profitability")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { parseFilters, json } = await import("@/lib/api.server");
        const { getProfitability } = await import("@/lib/profitability.server");
        const filters = await parseFilters(request);
        let from = filters.from || "2026-01-01";
        let to = filters.to || new Date().toISOString().slice(0, 10);
        const detailMonth = new URL(request.url).searchParams.get("detailMonth");
        if (detailMonth) {
          if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(detailMonth))
            return json({ error: "Invalid accounting month." }, 400);
          const [year, month] = detailMonth.split("-").map(Number);
          const monthFrom = `${detailMonth}-01`;
          const monthTo = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
          from = from > monthFrom ? from : monthFrom;
          to = to < monthTo ? to : monthTo;
          if (from > to) return json({ error: "Month is outside the selected period." }, 400);
        }
        const profitability = await getProfitability(
          from,
          to,
          filters.company,
          Number(filters.fxSar),
        );
        return json({
          ...profitability,
          appliedFilters: filters,
          source: {
            system: "Odoo 17 Profit and Loss",
            reportId: Number(process.env.ODOO_PNL_REPORT_ID || 11),
            postedOnly: true,
            companies:
              profitability.snapshot?.companies ??
              (filters.company ? [{ id: null, name: filters.company }] : []),
            selection: filters.company || "all companies accessible to the Odoo API user",
          },
        });
      },
    },
  },
});
