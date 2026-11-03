import { createFileRoute } from "@tanstack/react-router";

/**
 * Registers the Telegram webhook, and reports whether it is currently working.
 *
 * Until this runs once, Telegram has nowhere to deliver messages: /start reaches
 * nobody and the sender is never subscribed, with no error shown anywhere.
 *
 *   GET  /api/telegram/setup  → current webhook state, changes nothing
 *   POST /api/telegram/setup  → point Telegram at this deployment
 */

/**
 * Railway (and most PaaS front doors) terminate TLS at the edge and forward to
 * the container over plain HTTP, so `new URL(request.url).origin` reports
 * `http://` even though the public address is always `https://`. Telegram
 * rejects non-HTTPS webhook URLs, so registering that origin verbatim would
 * fail or silently save a URL nothing can reach. `PUBLIC_APP_URL` wins when
 * set; otherwise the host is taken from the forwarded header (falling back to
 * the request's own Host) and the scheme is always https.
 */
function publicOrigin(request: Request): string {
  const configured = process.env.PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;

  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || new URL(request.url).host;
  return `https://${host}`;
}

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

        const expected = new URL("/api/telegram/webhook", publicOrigin(request)).toString();
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

        const url = new URL("/api/telegram/webhook", publicOrigin(request)).toString();

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
