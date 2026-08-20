import { createFileRoute } from "@tanstack/react-router";
import type { Snapshot } from "@/lib/sheet-cache.server";

const REMOTE_REFRESH_COOLDOWN_MS = 2 * 60 * 1000;
let refreshJob: Promise<Snapshot> | null = null;
let lastRemoteRefreshStartedAt = 0;

export const Route = createFileRoute("/api/refresh")({
  server: {
    handlers: {
      POST: async () => {
        const { loadAllData } = await import("@/lib/sheet-cache.server");

        const now = Date.now();
        let reloaded = true;
        let data: Snapshot;
        if (refreshJob) {
          data = await refreshJob;
        } else if (now - lastRemoteRefreshStartedAt < REMOTE_REFRESH_COOLDOWN_MS) {
          // The button is intentionally open to the dashboard, so protect the
          // expensive Odoo/ads refresh from double-clicks and scripted retries.
          // The in-memory/database snapshot is still returned successfully.
          reloaded = false;
          data = await loadAllData();
        } else {
          lastRemoteRefreshStartedAt = now;
          refreshJob = loadAllData(true);
          try {
            data = await refreshJob;
          } finally {
            refreshJob = null;
          }
        }

        // Report what actually landed rather than a bare ok:true. A refresh that
        // silently returned the cached copy used to be indistinguishable from a
        // real one, which is how stale numbers went unnoticed.
        return Response.json(
          {
            ok: true,
            fetchedAt: new Date(data.fetchedAt).toISOString(),
            syncedAt: data.syncedAt,
            // Reaching this response means the forced refresh (or the healthy
            // rebuild it joined) completed. The old implementation performed a
            // full ordinary load first just to compare timestamps, which made a
            // cold Refresh button rebuild every dataset twice.
            reloaded,
            counts: {
              ads: data.ads.length,
              crm: data.crm.length,
              accounting: data.accounting.length,
              invoiced: data.invoiced.length,
              sales: data.accounting.length,
              lost: data.lost.length,
            },
            fetchErrors: data.fetchErrors,
            staleTabs: data.staleTabs,
            accounting: {
              authority: data.health.accountingAuthority,
              direct: data.health.accountingDirect,
              syncedAt: data.tabSyncs.find((source) => source.key === "accounting")?.syncedAt ?? "",
            },
          },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
