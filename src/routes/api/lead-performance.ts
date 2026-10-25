import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/lead-performance")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { json } = await import("@/lib/api.server");
        const { loadLeadPerformanceReport, LEAD_PERFORMANCE_SOURCES } =
          await import("@/lib/lead-performance.server");

        const url = new URL(request.url);
        const report = await loadLeadPerformanceReport({
          month: url.searchParams.get("month") ?? undefined,
          course: url.searchParams.get("course") ?? undefined,
        });
        if ("error" in report) {
          const { status, ...body } = report;
          return json(body, status);
        }
        return json({
          ...report.result,
          collectionsByMonth: report.collectionsByMonth,
          callCoverage: report.callCoverage,
          source: LEAD_PERFORMANCE_SOURCES,
          availability: report.availability,
          linksRefreshedAt: report.linksRefreshedAt,
          syncedAt: report.syncedAt,
          health: report.health,
        });
      },
    },
  },
});
