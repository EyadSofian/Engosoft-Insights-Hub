import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/api.server";
import { acquisitionDateFilters } from "@/lib/acquisition-reporting-period";

/**
 * Acquisition performance by campaign, ad set, ad, creative, landing page and
 * Meta lead form, plus today's summary. Exact provider IDs only; Meta's
 * aggregate lead totals are returned separately from event counts.
 */
export const Route = createFileRoute("/api/acquisition/performance")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const params = new URL(request.url).searchParams;
        const { getAcquisitionPerformance } = await import("@/lib/acquisition-performance.server");
        return json(
          await getAcquisitionPerformance({
            ...acquisitionDateFilters(params),
          }),
        );
      },
    },
  },
});
