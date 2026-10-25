import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/api.server";

/** Admin-only: rebuild the closed-loop identity graph now, or read its last run. */
export const Route = createFileRoute("/api/acquisition/closed-loop-refresh")({
  server: {
    handlers: {
      GET: async () => {
        const { closedLoopRefreshState } = await import("@/lib/closed-loop.server");
        return json(await closedLoopRefreshState());
      },
      POST: async ({ request }) => {
        const { authorizeWrite } = await import("@/lib/admin-auth.server");
        const guard = authorizeWrite(request);
        if (!guard.ok) return json({ error: guard.error }, guard.status);
        const { refreshClosedLoop } = await import("@/lib/closed-loop.server");
        return json(await refreshClosedLoop());
      },
    },
  },
});
