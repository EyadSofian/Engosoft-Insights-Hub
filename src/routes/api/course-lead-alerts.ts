import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/course-lead-alerts")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { parseFilters, json } = await import("@/lib/api.server");
        const { buildCurrentCourseLeadAlertReport } =
          await import("@/lib/course-lead-alerts.server");
        const filters = await parseFilters(request);
        return json(await buildCurrentCourseLeadAlertReport(filters));
      },
    },
  },
});
