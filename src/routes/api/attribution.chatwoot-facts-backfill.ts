import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/api.server";

/**
 * Admin-only historical backfill of Chatwoot inbox facts (channel, branch) and
 * unknown-attribution markers. A dry run unless `dryRun: false` is sent; page
 * through with `offset` using the returned `nextOffset`.
 */
export const Route = createFileRoute("/api/attribution/chatwoot-facts-backfill")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeWrite } = await import("@/lib/admin-auth.server");
        const guard = authorizeWrite(request);
        if (!guard.ok) return json({ error: guard.error }, guard.status);

        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return json({ error: "Body must be JSON" }, 400);
        }
        const { backfillChatwootAttributionFacts } =
          await import("@/lib/chatwoot-attribution-backfill.server");
        return json(
          await backfillChatwootAttributionFacts({
            dryRun: body.dryRun !== false,
            offset: Number(body.offset) || 0,
            limit: Number(body.limit) || 100,
            syncChatwoot: body.syncChatwoot !== false,
          }),
        );
      },
    },
  },
});
