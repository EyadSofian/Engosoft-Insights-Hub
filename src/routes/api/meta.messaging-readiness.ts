import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/api.server";

/**
 * WhatsApp / Messenger / Instagram attribution readiness. GET returns the
 * checklist (statuses and plain details, no credentials). POST (admin):
 *   { action: "self_test" }                         signed end-to-end webhook proof
 *   { action: "ensure_app_subscriptions", dryRun }  add this app's webhook fields
 *   { action: "recompute" }                         refresh the checklist now
 */
export const Route = createFileRoute("/api/meta/messaging-readiness")({
  server: {
    handlers: {
      GET: async () => {
        const { computeMessagingReadiness } = await import("@/lib/meta-messaging-readiness.server");
        return json(await computeMessagingReadiness());
      },
      POST: async ({ request }) => {
        const { authorizeWrite } = await import("@/lib/admin-auth.server");
        const guard = authorizeWrite(request);
        if (!guard.ok) return json({ error: guard.error }, guard.status);
        const body = (await request.json().catch(() => ({}))) as {
          action?: unknown;
          dryRun?: unknown;
        };
        const server = await import("@/lib/meta-messaging-readiness.server");
        switch (body.action) {
          case "self_test": {
            const results = await server.runMessagingSelfTest();
            await server.computeMessagingReadiness({ force: true });
            return json({ results });
          }
          case "ensure_app_subscriptions":
            return json(
              await server.ensureAppWebhookSubscriptions({ dryRun: body.dryRun !== false }),
            );
          case "recompute":
            return json(await server.computeMessagingReadiness({ force: true }));
          default:
            return json({ error: "Unknown action" }, 400);
        }
      },
    },
  },
});
