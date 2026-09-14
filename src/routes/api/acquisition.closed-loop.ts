import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/api.server";

/**
 * Closed-loop Marketing → Sales performance: acquisitions joined to CRM
 * outcomes, sales orders and paid revenue through exact provider IDs, with
 * coverage, lead quality and funnel. No personal data is returned.
 */
export const Route = createFileRoute("/api/acquisition/closed-loop")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const params = new URL(request.url).searchParams;
        const { getClosedLoop } = await import("@/lib/closed-loop.server");
        return json(
          await getClosedLoop({
            from: params.get("from") || undefined,
            to: params.get("to") || undefined,
          }),
        );
      },
    },
  },
});
