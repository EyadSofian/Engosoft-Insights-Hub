import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const { databaseConfigured, readDashboardDataset } =
          await import("@/lib/dashboard-db.server");
        const datasets = databaseConfigured()
          ? await Promise.all(
              (["meta_ads", "snap_ads", "accounting"] as const).map(async (dataset) => {
                try {
                  const state = await readDashboardDataset(dataset);
                  return {
                    dataset,
                    status: state.status,
                    rows: state.rowCount,
                    syncedAt: state.syncedAt,
                    hasError: Boolean(state.error),
                  };
                } catch {
                  return { dataset, status: "failed", rows: 0, syncedAt: "", hasError: true };
                }
              }),
            )
          : [];
        return Response.json(
          {
            ok: true,
            service: "engosoft-insights-hub",
            checkedAt: new Date().toISOString(),
            storage: { configured: databaseConfigured(), datasets },
          },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
