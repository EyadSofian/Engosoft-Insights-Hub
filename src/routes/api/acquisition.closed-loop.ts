import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/api.server";

/**
 * Closed-loop Marketing → Sales performance: acquisitions joined to CRM
 * outcomes, sales orders and paid revenue through exact provider IDs, with
 * coverage, lead quality and funnel. No personal data is returned.
 *
 * The global platform/channel filter is honoured: the selected-scope figures
 * follow it, and exact attribution (Meta only) reports itself unavailable for
 * any other platform instead of silently showing Meta.
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
            platform: params.get("platform") || undefined,
            channel: params.get("channel") || undefined,
            fxEgp: params.get("fxEgp") || undefined,
            fxSar: params.get("fxSar") || undefined,
          }),
        );
      },
    },
  },
});
