import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/refresh")({
  server: {
    handlers: {
      POST: async () => {
        const { invalidateCache, loadAllData } = await import("@/lib/sheet-cache.server");
        invalidateCache();
        const data = await loadAllData(true);
        return Response.json({ ok: true, syncedAt: data.syncedAt });
      },
    },
  },
});
