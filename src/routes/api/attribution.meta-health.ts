import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/api.server";

export const Route = createFileRoute("/api/attribution/meta-health")({
  server: {
    handlers: {
      GET: async () => {
        const { getMetaAttributionHealth } = await import("@/lib/meta-message-attribution.server");
        return json(await getMetaAttributionHealth());
      },
    },
  },
});
