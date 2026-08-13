import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const { databaseConfigured, readDashboardDataset } =
          await import("@/lib/dashboard-db.server");
        const datasets = databaseConfigured()
          ? await Promise.all(
              (
                [
                  "meta_ads",
                  "snap_ads",
                  "accounting",
                  "accounting_legacy",
                  "ads_legacy",
                  "crm",
                  "lost",
                  "invoiced",
                  "website_sales",
                  "pbx_extensions",
                  "sla_calls",
                ] as const
              ).map(async (dataset) => {
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
        const rowsFor = (dataset: (typeof datasets)[number]["dataset"]) =>
          datasets.find((state) => state.dataset === dataset)?.rows ?? 0;
        return Response.json(
          {
            ok: true,
            service: "engosoft-insights-hub",
            checkedAt: new Date().toISOString(),
            storage: {
              configured: databaseConfigured(),
              datasets,
              merged: {
                accounting: {
                  currentRows: rowsFor("accounting"),
                  legacyRows: rowsFor("accounting_legacy"),
                  inputRows: rowsFor("accounting") + rowsFor("accounting_legacy"),
                },
                ads: {
                  currentRows: rowsFor("meta_ads") + rowsFor("snap_ads"),
                  legacyRows: rowsFor("ads_legacy"),
                  inputRows: rowsFor("meta_ads") + rowsFor("snap_ads") + rowsFor("ads_legacy"),
                },
              },
            },
          },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
