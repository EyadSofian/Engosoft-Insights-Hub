import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/api.server";

function filters(request: Request) {
  const params = new URL(request.url).searchParams;
  return {
    from: params.get("from") || undefined,
    to: params.get("to") || undefined,
    channel: params.get("channel") || undefined,
    platform: params.get("platform") || undefined,
    source: params.get("source") || undefined,
    medium: params.get("medium") || undefined,
    campaignId: params.get("campaignId") || undefined,
    adsetId: params.get("adsetId") || undefined,
    adId: params.get("adId") || undefined,
    branchId: params.get("branchId") || undefined,
    inboxId: params.get("inboxId") || undefined,
    agentId: params.get("agentId") || undefined,
    method: params.get("method") || undefined,
    confidence: params.get("confidence") || undefined,
    unknownReason: params.get("unknownReason") || undefined,
    crmStatus: params.get("crmStatus") || undefined,
  };
}

export const Route = createFileRoute("/api/attribution/summary")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getAttributionSummary } = await import("@/lib/chatwoot-attribution.server");
        return json(await getAttributionSummary(filters(request)));
      },
    },
  },
});
