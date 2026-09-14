import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/api.server";

/** Audit of inferred (phone-key) CRM links: time gaps, ambiguity, duplicate risk. IDs and counts only. */
export const Route = createFileRoute("/api/acquisition/inferred-links")({
  server: {
    handlers: {
      GET: async () => {
        const { getInferredLinkAudit } = await import("@/lib/closed-loop.server");
        return json(await getInferredLinkAudit());
      },
    },
  },
});
