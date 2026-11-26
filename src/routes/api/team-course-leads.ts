import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/team-course-leads")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { parseFilters, json } = await import("@/lib/api.server");
        const { getFiltered, authoritativeLostLeads } = await import("@/lib/metrics.server");
        const { teamCourseLeadRecords, teamCourseLeadPage } =
          await import("@/lib/team-course-leads");
        const { odooConfig } = await import("@/lib/odoo.server");
        const params = new URL(request.url).searchParams;
        const ownerKey = params.get("ownerKey");
        const course = params.get("matrixCourse");
        const offset = params.get("offset") || "0";
        const limit = params.get("limit") || "50";
        if (
          !ownerKey ||
          !course ||
          !/^\d{1,7}$/.test(offset) ||
          !/^\d{1,3}$/.test(limit) ||
          Number(limit) < 1 ||
          Number(limit) > 100
        ) {
          return json(
            { error: "Select a salesperson/course cell and a valid page (limit 1–100)." },
            400,
          );
        }
        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        if (data.snapshot.health.lostAuthority === "unavailable") {
          return json(
            { error: "CRM Lost coverage is unavailable; a partial cell is not shown as complete." },
            503,
          );
        }
        const records = teamCourseLeadRecords(
          data.crm,
          authoritativeLostLeads(data),
          filters.company,
        );
        return json({
          ...teamCourseLeadPage(
            records,
            ownerKey,
            course,
            Number(offset),
            Number(limit),
            odooConfig().url,
          ),
          appliedFilters: filters,
          syncedAt: data.snapshot.syncedAt,
          basis:
            "Odoo creation date in the selected period, current owner and primary course. Includes Lead/Opportunity and all current statuses; counts records, not calls or unique phone numbers.",
        });
      },
    },
  },
});
