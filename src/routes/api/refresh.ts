import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/refresh")({
  server: {
    handlers: {
      POST: async () => {
        const { invalidateCache, loadAllData } = await import("@/lib/sheet-cache.server");

        const before = await loadAllData().catch(() => null);
        invalidateCache();
        const data = await loadAllData(true);

        // Report what actually landed rather than a bare ok:true. A refresh that
        // silently returned the cached copy used to be indistinguishable from a
        // real one, which is how stale numbers went unnoticed.
        return Response.json(
          {
            ok: true,
            fetchedAt: new Date(data.fetchedAt).toISOString(),
            syncedAt: data.syncedAt,
            reloaded: !before || data.fetchedAt > before.fetchedAt,
            counts: {
              ads: data.ads.length,
              crm: data.crm.length,
              invoiced: data.invoiced.length,
              sales: data.sales.length,
              lost: data.lost.length,
            },
            fetchErrors: data.fetchErrors,
          },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
