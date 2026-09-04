import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/courses")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { computeCourses, computeTotals, getFiltered, isPreviousComparable, previousPeriod } =
          await import("@/lib/metrics.server");
        const { parseFilters, json } = await import("@/lib/api.server");
        const { buildCourseDrill } = await import("@/lib/course-intelligence.server");

        const filters = await parseFilters(request);
        const organicScope = filters.channel === "organic";
        const data = await getFiltered(filters);
        const prevRange = previousPeriod(filters.from, filters.to);
        // No prior-period revenue delta when that window predates the data.
        const prevComparable = await isPreviousComparable(prevRange);
        const prevData =
          prevComparable && prevRange ? await getFiltered({ ...filters, ...prevRange }) : null;

        const courses = computeCourses(data, prevData ?? undefined);
        const detail = new URL(request.url).searchParams.get("detail")?.trim() ?? "";

        // The drill-down lives in src/lib/course-intelligence.server.ts so the
        // agent contract and this page compute it with the same code. See the
        // module header for why.
        const drill = detail ? buildCourseDrill(data, detail, filters, organicScope) : null;

        return json({
          courses,
          totals: computeTotals(data),
          drill,
          prevRange,
          prevComparable,
          health: data.snapshot.health,
          appliedFilters: filters,
        });
      },
    },
  },
});
