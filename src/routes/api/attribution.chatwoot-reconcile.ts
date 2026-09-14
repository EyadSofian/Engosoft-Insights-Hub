import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/api.server";

/**
 * Chatwoot conversations vs attribution rows. GET: pipeline health and the
 * last reconciliation (counts only). POST (admin): start a bounded run in the
 * background — dryRun defaults to true; a real run rebuilds missing rows in the
 * database only and never writes to Chatwoot.
 */
export const Route = createFileRoute("/api/attribution/chatwoot-reconcile")({
  server: {
    handlers: {
      GET: async () => {
        const { chatwootAttributionHealth } =
          await import("@/lib/chatwoot-attribution-reconcile.server");
        return json(await chatwootAttributionHealth());
      },
      POST: async ({ request }) => {
        const { authorizeWrite } = await import("@/lib/admin-auth.server");
        const guard = authorizeWrite(request);
        if (!guard.ok) return json({ error: guard.error }, guard.status);
        const body = (await request.json().catch(() => ({}))) as {
          days?: unknown;
          dryRun?: unknown;
          maxConversations?: unknown;
        };
        const { runChatwootAttributionReconcile, chatwootReconcileRunning } =
          await import("@/lib/chatwoot-attribution-reconcile.server");
        const alreadyRunning = chatwootReconcileRunning();
        void runChatwootAttributionReconcile({
          days: Number(body.days) || undefined,
          dryRun: body.dryRun !== false,
          maxConversations: Number(body.maxConversations) || undefined,
        }).catch((error) =>
          console.error(
            "[chatwoot-reconcile] run failed:",
            error instanceof Error ? error.message : error,
          ),
        );
        return json(
          { started: !alreadyRunning, alreadyRunning, dryRun: body.dryRun !== false },
          202,
        );
      },
    },
  },
});
