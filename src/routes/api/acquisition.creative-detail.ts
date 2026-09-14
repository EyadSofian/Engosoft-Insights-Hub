import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/api.server";

/** One creative: media, hierarchy, spend, acquisitions, lead quality and sales outcomes. */
export const Route = createFileRoute("/api/acquisition/creative-detail")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const params = new URL(request.url).searchParams;
        const { getCreativeDetail } = await import("@/lib/closed-loop.server");
        return json(
          await getCreativeDetail(params.get("creativeId") || "", {
            from: params.get("from") || undefined,
            to: params.get("to") || undefined,
          }),
        );
      },
    },
  },
});
