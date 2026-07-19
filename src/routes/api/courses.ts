import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/courses")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered, computeCourses, previousPeriod } = await import("@/lib/metrics.server");
        const { parseFilters, json } = await import("@/lib/api.server");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);

        // Previous equal window powers the ▲/▼ trend on each course.
        const prevRange = previousPeriod(filters.from, filters.to);
        const prevData = prevRange ? await getFiltered({ ...filters, ...prevRange }) : undefined;

        const courses = computeCourses(data, prevData);

        // "Underperforming" = spent money and got little back, or revenue is
        // falling versus the previous window.
        const underperforming = [...courses]
          .filter((c) => (c.spend > 0 && c.roas < 1) || c.revenueDelta < 0 || (c.leads > 10 && c.winRate < 2))
          .sort((a, b) => {
            const aBad = a.spend - a.revenue;
            const bBad = b.spend - b.revenue;
            if (bBad !== aBad) return bBad - aBad;
            return a.revenueDelta - b.revenueDelta;
          })
          .slice(0, 10);

        return json({
          courses,
          top: courses.slice(0, 10),
          underperforming,
          prevRange,
          appliedFilters: filters,
        });
      },
    },
  },
});
