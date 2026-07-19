import { createFileRoute } from "@tanstack/react-router";

/**
 * Registers the Telegram webhook, and reports whether it is currently working.
 *
 * Until this runs once, Telegram has nowhere to deliver messages: /start reaches
 * nobody and the sender is never subscribed, with no error shown anywhere. This
 * endpoint derives the URL from the incoming request, so the deployment does not
 * need to know its own public address.
 *
 *   GET  /api/telegram/setup  → current webhook state, changes nothing
 *   POST /api/telegram/setup  → point Telegram at this deployment
 */
export const Route = createFileRoute("/api/telegram/setup")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { json } = await import("@/lib/api.server");
        const { botToken } = await import("@/lib/telegram.server");
        const { subscriberCount } = await import("@/lib/subscribers.server");
        const { schedulerStatus } = await import("@/lib/scheduler.server");

        const token = botToken();
        if (!token) return json({ ok: false, error: "TELEGRAM_BOT_TOKEN is not set" });

        const expected = new URL("/api/telegram/webhook", new URL(request.url).origin).toString();
        const info = await getWebhookInfo(token);

        return json({
          ok: info.ok,
          registered: !!info.url,
          matchesThisDeployment: info.url === expected,
          expectedUrl: expected,
          currentUrl: info.url || null,
          pendingUpdates: info.pending_update_count ?? null,
          lastError: info.last_error_message ?? null,
          subscribers: await subscriberCount(),
          scheduler: schedulerStatus(),
          hint: info.url
            ? info.url === expected
              ? "Webhook is registered for this deployment. Send /start to the bot to subscribe."
              : "A webhook is registered, but for a different URL. POST here to repoint it."
            : "No webhook registered — /start currently reaches nothing. POST to this endpoint to register it.",
        });
      },

      POST: async ({ request }) => {
        const { json } = await import("@/lib/api.server");
        const { botToken } = await import("@/lib/telegram.server");

        const token = botToken();
        if (!token) return json({ ok: false, error: "TELEGRAM_BOT_TOKEN is not set" });

        const url = new URL("/api/telegram/webhook", new URL(request.url).origin).toString();

        try {
          const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              url,
              allowed_updates: ["message"],
              // Messages sent while no webhook existed are not worth replaying.
              drop_pending_updates: true,
            }),
          });
          const body = (await res.json()) as { ok?: boolean; description?: string };
          if (!res.ok || !body.ok) {
            // Only the description is surfaced; the request URL carries the token.
            return json({ ok: false, error: body.description ?? `Telegram returned ${res.status}`, url });
          }
          return json({
            ok: true,
            url,
            message: "Webhook registered. Send /start to the bot to subscribe.",
          });
        } catch (e) {
          return json({ ok: false, error: e instanceof Error ? e.message : "network error", url });
        }
      },
    },
  },
});

interface WebhookInfo {
  ok: boolean;
  url?: string;
  pending_update_count?: number;
  last_error_message?: string;
}

async function getWebhookInfo(token: string): Promise<WebhookInfo> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const body = (await res.json()) as { ok?: boolean; result?: WebhookInfo };
    if (!body.ok || !body.result) return { ok: false };
    return { ...body.result, ok: true };
  } catch {
    return { ok: false };
  }
}
