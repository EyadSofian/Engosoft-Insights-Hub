import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/quarter-leads-review")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { parseFilters, json } = await import("@/lib/api.server");
        const { quarterLeadReview } = await import("@/lib/quarter-leads-report.server");
        try {
          return json(await quarterLeadReview(await parseFilters(request)));
        } catch {
          return json({ error: "The August–October review sources could not be completed." }, 503);
        }
      },
    },
  },
});
