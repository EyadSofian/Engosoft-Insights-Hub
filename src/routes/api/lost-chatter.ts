import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/lost-chatter")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { parseFilters, json } = await import("@/lib/api.server");
        const { getFiltered, authoritativeLostLeads } = await import("@/lib/metrics.server");
        const { readLostChatter } = await import("@/lib/lost-chatter.server");
        const id = Number(new URL(request.url).searchParams.get("id"));
        if (!Number.isSafeInteger(id) || id <= 0) return json({ error: "Invalid CRM ID" }, 400);
        const filters = await parseFilters(request);
        const [data, closedData] = await Promise.all([
          getFiltered(filters),
          getFiltered({ ...filters, lostDateBasis: "closed" }),
        ]);
        // A caller cannot enumerate arbitrary Odoo chatter: the CRM ID must
        // already belong to the Lost records visible under these filters.
        const savedVisible = [
          ...authoritativeLostLeads(data),
          ...authoritativeLostLeads(closedData),
        ].some((row) => Number(row.id) === id);
        if (!savedVisible) {
          const { loadFreshLostPipeline, loadArchivedLostLeads } =
            await import("@/lib/crm-fresh-lost.server");
          const [pipeline, archived] = await Promise.all([
            loadFreshLostPipeline(filters, data.snapshot),
            loadArchivedLostLeads(filters, data.snapshot),
          ]);
          const liveVisible =
            pipeline.availability === "available" &&
            archived.availability === "available" &&
            [...pipeline.records, ...archived.records].some((row) => Number(row.id) === id);
          if (!liveVisible)
            return json({ error: "Lost record not found in the selected scope" }, 404);
        }
        try {
          const result = await readLostChatter(id);
          return result ? json(result) : json({ error: "Odoo record not found" }, 404);
        } catch {
          return json({ error: "Odoo chatter is temporarily unavailable" }, 503);
        }
      },
    },
  },
});
