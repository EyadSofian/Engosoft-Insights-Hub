import { createFileRoute } from "@tanstack/react-router";

/** Returns the exact message text without sending it. */
export const Route = createFileRoute("/api/telegram/preview")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { buildReport } = await import("@/lib/telegram.server");
        const { schedulerStatus } = await import("@/lib/scheduler.server");
        const { json } = await import("@/lib/api.server");

        const p = new URL(request.url).searchParams;
        const days = Math.min(31, Math.max(1, Number(p.get("days") ?? 1) || 1));
        const to = p.get("to") || undefined;

        const text = await buildReport({ days, to });
        return json({ text, days, scheduler: schedulerStatus() });
      },
    },
  },
});
