import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/lead-source-matrix")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { parseFilters, json } = await import("@/lib/api.server");
        const { loadLeadSourceMatrix } = await import("@/lib/lead-source-matrix.server");
        const params = new URL(request.url).searchParams;
        const source = params.get("matrixSource") || "";
        const course = params.get("matrixCourse") || "";
        const page = Number(params.get("page") || 1);
        if (
          (params.has("matrixSource") && (!source || source.length > 200)) ||
          course.length > 200 ||
          (course && !source) ||
          !Number.isInteger(page) ||
          page < 1 ||
          page > 10000
        ) {
          return json({ error: "Invalid matrix selection." }, 400);
        }
        const filters = await parseFilters(request);
        try {
          return json(
            await loadLeadSourceMatrix(
              filters,
              source ? { source, course: course || undefined, page } : undefined,
            ),
          );
        } catch (error) {
          return json(
            { error: error instanceof Error ? error.message : "Odoo CRM is unavailable." },
            503,
          );
        }
      },
    },
  },
});
