import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/api.server";
import { acquisitionFilters } from "./acquisition.summary";

export const Route = createFileRoute("/api/acquisition/events")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getAcquisitionEvents } = await import("@/lib/acquisition-attribution.server");
        const limit = Number(new URL(request.url).searchParams.get("limit"));
        return json(
          await getAcquisitionEvents({
            ...acquisitionFilters(request),
            limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
          }),
        );
      },
    },
  },
});
