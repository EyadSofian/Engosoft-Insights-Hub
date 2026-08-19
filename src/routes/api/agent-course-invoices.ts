import { createFileRoute } from "@tanstack/react-router";

/**
 * The paid invoices behind one employee's figure for one course.
 *
 * Read on click rather than shipped with the page. Carrying every invoice of
 * every course for all 53 employees inside `/api/teams` cost 551 KB of an
 * 864 KB response — to fill a dialog that shows one course at a time and is
 * usually never opened at all.
 *
 * Takes the same global filters as the page, so the list always reconciles with
 * the figure that was clicked instead of quietly answering for a different
 * period.
 */
export const Route = createFileRoute("/api/agent-course-invoices")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered } = await import("@/lib/metrics.server");
        const { courseInvoicesFor } = await import("@/lib/agent-analytics.server");
        const { parseFilters, json } = await import("@/lib/api.server");

        const url = new URL(request.url);
        const agent = (url.searchParams.get("agent") ?? "").trim();
        const course = (url.searchParams.get("course") ?? "").trim();
        if (!agent || !course) {
          return Response.json(
            { error: "Both `agent` and `course` are required." },
            { status: 400 },
          );
        }

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        const invoices = courseInvoicesFor(data, agent, course);

        return json({
          agent,
          course,
          invoices,
          total: invoices.reduce((sum, invoice) => sum + invoice.usdPaid, 0),
        });
      },
    },
  },
});
