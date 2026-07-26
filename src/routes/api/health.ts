import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () =>
        Response.json(
          {
            ok: true,
            service: "engosoft-insights-hub",
            checkedAt: new Date().toISOString(),
          },
          { headers: { "cache-control": "no-store" } },
        ),
    },
  },
});
