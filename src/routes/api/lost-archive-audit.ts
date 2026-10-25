import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/lost-archive-audit")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { readDashboardDataset } = await import("@/lib/dashboard-db.server");
        const { buildLostArchiveAudit } = await import("@/lib/lost-archive-audit");
        const snapshot = await readDashboardDataset("lost_archive_audit");
        const params = new URL(request.url).searchParams;
        const report = buildLostArchiveAudit(snapshot.rows, {
          month: params.get("month") ?? undefined,
          course: params.get("course") ?? undefined,
          salesperson: params.get("salesperson") ?? undefined,
          status: snapshot.status,
          syncedAt: snapshot.syncedAt,
        });
        return Response.json(report, { headers: { "cache-control": "private, no-store" } });
      },
    },
  },
});
