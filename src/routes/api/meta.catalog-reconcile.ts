import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/api.server";

/**
 * Meta catalog reconciliation: recover creatives, lead-form settings and image
 * URLs for every ad by its exact Ad ID. GET reads progress (counts only); POST
 * (admin) starts a bounded run in the background and returns at once, because
 * Railway's proxy cuts requests at about 50 seconds.
 */
export const Route = createFileRoute("/api/meta/catalog-reconcile")({
  server: {
    handlers: {
      GET: async () => {
        const { metaCatalogReconcileState, metaCatalogReconcileRunning } =
          await import("@/lib/meta-catalog-reconcile.server");
        return json({
          running: metaCatalogReconcileRunning(),
          ...(await metaCatalogReconcileState()),
        });
      },
      POST: async ({ request }) => {
        const { authorizeWrite } = await import("@/lib/admin-auth.server");
        const guard = authorizeWrite(request);
        if (!guard.ok) return json({ error: guard.error }, guard.status);
        const body = (await request.json().catch(() => ({}))) as {
          maxAds?: unknown;
          force?: unknown;
        };
        const maxAds = Math.min(Math.max(Number(body.maxAds) || 2_000, 1), 5_000);
        const { runMetaCatalogReconcile, metaCatalogReconcileRunning } =
          await import("@/lib/meta-catalog-reconcile.server");
        const { refreshClosedLoop } = await import("@/lib/closed-loop.server");
        const alreadyRunning = metaCatalogReconcileRunning();
        void runMetaCatalogReconcile({ maxAds, force: body.force === true })
          .then((summary) => (summary.fetched > 0 ? refreshClosedLoop() : undefined))
          .catch((error) =>
            console.error(
              "[catalog-reconcile] run failed:",
              error instanceof Error ? error.message : error,
            ),
          );
        return json({ started: !alreadyRunning, alreadyRunning, maxAds }, 202);
      },
    },
  },
});
