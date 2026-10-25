import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/source-reconciliation")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { parseFilters, json } = await import("@/lib/api.server");
        const { sourceReconciliation } = await import("@/lib/source-reconciliation.server");
        const filters = await parseFilters(request);
        // This asks Odoo, Meta, TikTok and Google Ads directly, so the result
        // is cached for ten minutes. `?force=1` is for someone standing in
        // front of the page who has just fixed something.
        const force = new URL(request.url).searchParams.get("force") === "1";
        return json(await sourceReconciliation({ from: filters.from, to: filters.to }, { force }));
      },
    },
  },
});
