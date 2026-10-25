import { createFileRoute } from "@tanstack/react-router";
import type { ArchiveRow } from "@/lib/lost-archive-audit";

export const Route = createFileRoute("/api/lost-archive-audit")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { buildLostArchiveAudit } = await import("@/lib/lost-archive-audit");
        const { lostArchiveGoogleConfigured, readLostArchiveGoogle } =
          await import("@/lib/lost-archive-google.server");
        const params = new URL(request.url).searchParams;
        let rows: ArchiveRow[] = [];
        let status: "success" | "failed" | "never" = "never";
        let syncedAt = "";
        if (lostArchiveGoogleConfigured()) {
          try {
            const snapshot = await readLostArchiveGoogle();
            rows = snapshot.rows;
            syncedAt = snapshot.readAt;
            status = "success";
          } catch (error) {
            console.error(
              "Lost Archive read-only Google Sheets request failed:",
              error instanceof Error ? error.message : "unknown error",
            );
            status = "failed";
          }
        }
        const report = buildLostArchiveAudit(rows, {
          month: params.get("month") ?? undefined,
          course: params.get("course") ?? undefined,
          salesperson: params.get("salesperson") ?? undefined,
          status,
          syncedAt,
        });
        return Response.json(report, { headers: { "cache-control": "private, no-store" } });
      },
    },
  },
});
