import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/overview-revenue-source")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const {
          getFiltered,
          previousPeriod,
          isPreviousComparable,
          getRevenueSourceAccountingLines,
        } = await import("@/lib/metrics.server");
        const { parseFilters, json } = await import("@/lib/api.server");
        const filters = await parseFilters(request);
        const sourceKey = new URL(request.url).searchParams.get("sourceKey") || "";
        if (!sourceKey) return json({ error: "Choose a revenue source to inspect." }, 400);

        const data = await getFiltered(filters);
        const priorRange = previousPeriod(filters.from, filters.to);
        const comparable = await isPreviousComparable(priorRange);
        const previous =
          comparable && priorRange ? await getFiltered({ ...filters, ...priorRange }) : null;
        const lines = getRevenueSourceAccountingLines(data, previous, sourceKey);
        if (lines.length === 0) return json({ error: "This source is no longer available." }, 404);

        const totalRevenue = lines.reduce((sum, row) => sum + row.usdPaid, 0);
        const limit = 100;
        const requestedOffset = Number(new URL(request.url).searchParams.get("offset") || 0);
        const offset = Number.isFinite(requestedOffset)
          ? Math.max(0, Math.min(Math.floor(requestedOffset), Math.max(lines.length - 1, 0)))
          : 0;
        return json({
          totalLines: lines.length,
          totalRevenue,
          offset,
          limit,
          lines: lines.slice(offset, offset + limit).map((row) => ({
            id: row.id,
            movement: row.movement,
            paymentDate: row.paymentDate,
            invoiceDate: row.invoiceDate,
            partner: row.partner,
            product: row.product,
            course: row.course,
            salesperson: row.salesperson,
            salesTeam: row.salesTeam,
            campaignName: row.campaignName,
            campaignId: row.campaignId,
            adset: row.adset,
            adName: row.adName,
            source: row.source,
            usdPaid: row.usdPaid,
            currency: row.currency,
            isCreditNote: row.isCreditNote,
            orderRef: row.orderRef,
          })),
        });
      },
    },
  },
});
