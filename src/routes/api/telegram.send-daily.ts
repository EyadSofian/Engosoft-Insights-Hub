import { createFileRoute } from "@tanstack/react-router";

/**
 * Builds the report and broadcasts it to every subscriber.
 *
 * `?once=1` sends at most one report per Cairo day. Use it for an external
 * scheduler (Railway Cron, an uptime pinger) covering for a container that
 * sleeps and so never runs the in-process timer — with `once` set, whichever
 * trigger fires first wins and the other is a no-op rather than a duplicate.
 * A manual "send now" omits it and always sends.
 */
export const Route = createFileRoute("/api/telegram/send-daily")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { sendDaily } = await import("@/lib/telegram.server");
        const { subscriberCount, lastSentDay } = await import("@/lib/subscribers.server");
        const { json } = await import("@/lib/api.server");

        const p = new URL(request.url).searchParams;
        const days = Math.min(31, Math.max(1, Number(p.get("days") ?? 1) || 1));
        const once = p.get("once") === "1";

        const result = await sendDaily(days, { once });

        return json({
          ok: result.ok,
          skipped: result.skipped ?? false,
          error: result.error,
          sent: result.sent,
          failed: result.failed,
          removed: result.removed.length,
          subscribers: await subscriberCount(),
          lastSentDay: await lastSentDay(),
          text: result.text || undefined,
        });
      },
    },
  },
});
