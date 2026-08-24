import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/employee-call-recording")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { proxyCallsHubRecording } = await import("@/lib/calls-hub.server");
        const callId = new URL(request.url).searchParams.get("id") || "";
        try {
          return proxyCallsHubRecording(callId, request.headers.get("range"));
        } catch {
          return Response.json({ error: "Recording is unavailable" }, { status: 503 });
        }
      },
    },
  },
});
