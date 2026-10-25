import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/profitability-ledger")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { json, parseFilters } = await import("@/lib/api.server");
        const { getProfitabilityLedger } = await import("@/lib/profitability-ledger.server");
        const query = new URL(request.url).searchParams;
        const filters = await parseFilters(request);
        const accountCode = query.get("ledgerCode") || "";
        const from = query.get("periodFrom") || filters.from || "";
        const to = query.get("periodTo") || filters.to || "";
        const page = Number(query.get("page") || 1);
        try {
          const result = await getProfitabilityLedger(accountCode, from, to, filters.company, page);
          return json(result);
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : String(error) }, 502);
        }
      },
    },
  },
});
