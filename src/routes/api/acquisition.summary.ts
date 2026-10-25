import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/api.server";

export function acquisitionFilters(request: Request) {
  const params = new URL(request.url).searchParams;
  return {
    from: params.get("from") || undefined,
    to: params.get("to") || undefined,
    entityType: params.get("entityType") || undefined,
    sourceType: params.get("sourceType") || undefined,
    destination: params.get("destination") || undefined,
    campaignId: params.get("campaignId") || undefined,
    adsetId: params.get("adsetId") || undefined,
    adId: params.get("adId") || undefined,
    formId: params.get("formId") || undefined,
  };
}

/** Unified acquisition attribution: leads, conversations and landing sessions, never mixed. */
export const Route = createFileRoute("/api/acquisition/summary")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getAcquisitionSummary } = await import("@/lib/acquisition-attribution.server");
        return json(await getAcquisitionSummary(acquisitionFilters(request)));
      },
    },
  },
});
