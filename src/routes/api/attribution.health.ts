import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/api.server";

export const Route = createFileRoute("/api/attribution/health")({
  server: {
    handlers: {
      GET: async () => {
        const { getAttributionHealth } = await import("@/lib/chatwoot-attribution.server");
        return json(await getAttributionHealth());
      },
    },
  },
});
