import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/lead-intelligence")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { parseFilters, json } = await import("@/lib/api.server");
        const { getFiltered } = await import("@/lib/metrics.server");
        const { loadMediaPlanSource } = await import("@/lib/media-plans.server");
        const { buildLeadIntelligence } = await import("@/lib/lead-intelligence.server");
        const { odooConfig } = await import("@/lib/odoo.server");
        const query = new URL(request.url).searchParams;
        const filters = await parseFilters(request);
        const [data, lifetimeData, mediaPlans] = await Promise.all([
          getFiltered(filters),
          getFiltered({ ...filters, from: undefined, to: undefined, range: "all" }),
          loadMediaPlanSource(),
        ]);
        const page = Number(query.get("page") || 1);
        return json(
          buildLeadIntelligence(
            data,
            mediaPlans.plans,
            (query.get("focusCourse") || filters.course || "").slice(0, 120),
            (query.get("focusOwner") || filters.salesperson || "").slice(0, 120),
            Number.isFinite(page) ? page : 1,
            odooConfig().url,
            lifetimeData,
          ),
        );
      },
    },
  },
});
