import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/api.server";

export const Route = createFileRoute("/api/attribution/conversations")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const params = new URL(request.url).searchParams;
        const { getAttributionConversations } = await import("@/lib/chatwoot-attribution.server");
        return json(
          await getAttributionConversations({
            from: params.get("from") || undefined,
            to: params.get("to") || undefined,
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
            crmStatus: params.get("crmStatus") || undefined,
            limit: Number(params.get("limit") || 100),
            offset: Number(params.get("offset") || 0),
          }),
        );
      },
    },
  },
});
