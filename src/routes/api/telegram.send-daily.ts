import { createFileRoute } from "@tanstack/react-router";

/** Builds the report and broadcasts it to every subscriber. */
export const Route = createFileRoute("/api/telegram/send-daily")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { sendDaily } = await import("@/lib/telegram.server");
        const { subscriberCount } = await import("@/lib/subscribers.server");
        const { json } = await import("@/lib/api.server");

        const days = Math.min(31, Math.max(1, Number(new URL(request.url).searchParams.get("days") ?? 1) || 1));
        const result = await sendDaily(days);

        return json({
          ok: result.ok,
          error: result.error,
          sent: result.sent,
          failed: result.failed,
          removed: result.removed.length,
          subscribers: await subscriberCount(),
          text: result.text,
        });
      },
    },
  },
});
