import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/campaigns")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered, computePerf, computeTotals, UNKNOWN_ADSET_KEY } = await import(
          "@/lib/metrics.server"
        );
        const { parseFilters, json } = await import("@/lib/api.server");

        const raw = new URL(request.url).searchParams.get("grain");
        const grain = raw === "adset" || raw === "ad" ? raw : "campaign";

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);

        return json({
          grain,
          rows: computePerf(data, grain),
          totals: computeTotals(data),
          unknownAdsetKey: UNKNOWN_ADSET_KEY,
          health: data.snapshot.health,
          appliedFilters: filters,
        });
      },
    },
  },
});
