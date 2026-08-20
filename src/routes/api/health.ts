import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { databaseConfigured, readDashboardDatasetStates } =
          await import("@/lib/dashboard-db.server");
        const includeDetails = new URL(request.url).searchParams.get("details") === "1";
        const names = [
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
          "sales_targets",
          "sales_summary",
        ] as const;
        // Railway calls this path as a liveness probe. The default response must
        // not download every reporting row merely to prove the HTTP process is
        // alive. Operators can request the small sync-state table explicitly.
        const states =
          includeDetails && databaseConfigured()
            ? await readDashboardDatasetStates(names).catch(() => [])
            : [];
        const datasets = states.map((state) => ({
          dataset: state.dataset,
          status: state.status,
          rows: state.rowCount,
          syncedAt: state.syncedAt,
          hasError: Boolean(state.error),
        }));
        const rowsFor = (dataset: (typeof datasets)[number]["dataset"]) =>
          datasets.find((state) => state.dataset === dataset)?.rows ?? 0;
        return Response.json(
          {
            ok: true,
            service: "engosoft-insights-hub",
            checkedAt: new Date().toISOString(),
            storage: {
              configured: databaseConfigured(),
              detailsIncluded: includeDetails,
              datasets,
              ...(includeDetails
                ? {
                    merged: {
                      accounting: {
                        currentRows: rowsFor("accounting"),
                        legacyRows: rowsFor("accounting_legacy"),
                        inputRows: rowsFor("accounting") + rowsFor("accounting_legacy"),
                      },
                      ads: {
                        currentRows: rowsFor("meta_ads") + rowsFor("snap_ads"),
                        legacyRows: rowsFor("ads_legacy"),
                        inputRows:
                          rowsFor("meta_ads") + rowsFor("snap_ads") + rowsFor("ads_legacy"),
                      },
                    },
                  }
                : {}),
            },
          },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
