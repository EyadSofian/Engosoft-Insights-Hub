import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/sales")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered } = await import("@/lib/metrics.server");
        const { buildSalesFunnel } = await import("@/lib/sales-funnel.server");
        const { parseFilters, json } = await import("@/lib/api.server");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        return json({
          ...buildSalesFunnel(data, filters),
          health: data.snapshot.health,
          appliedFilters: filters,
        });
      },
    },
  },
});
