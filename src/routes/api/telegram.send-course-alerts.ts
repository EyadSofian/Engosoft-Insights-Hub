import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/telegram/send-course-alerts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { json } = await import("@/lib/api.server");
        const { sendCourseAlerts } = await import("@/lib/telegram.server");
        const { lastCourseAlertDay, subscriberCount } = await import("@/lib/subscribers.server");
        const once = new URL(request.url).searchParams.get("once") === "1";
        const result = await sendCourseAlerts({ once });
        return json({
          ok: result.ok,
          skipped: result.skipped ?? false,
          noAlerts: result.noAlerts ?? false,
          error: result.error,
          sent: result.sent,
          failed: result.failed,
          removed: result.removed.length,
          subscribers: await subscriberCount(),
          lastCourseAlertDay: await lastCourseAlertDay(),
          anchorDate: result.report.anchorDate,
          alertCount: result.report.summary.alertCount,
        });
      },
    },
  },
});
