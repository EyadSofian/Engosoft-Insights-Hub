import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/employee-call-detail")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getCallsHubCallDetail } = await import("@/lib/calls-hub.server");
        const callId = new URL(request.url).searchParams.get("id") || "";
        try {
          return Response.json(await getCallsHubCallDetail(callId), {
            headers: { "cache-control": "private, max-age=30" },
          });
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "Call details are unavailable" },
            { status: 503 },
          );
        }
      },
    },
  },
});
