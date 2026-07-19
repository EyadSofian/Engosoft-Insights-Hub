import { createFileRoute } from "@tanstack/react-router";

const ROW_CAP = 3000;

export const Route = createFileRoute("/api/lost")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered, groupSum } = await import("@/lib/metrics.server");
        const { parseFilters, json } = await import("@/lib/api.server");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        const rows = data.lost;
        const count = <T,>(list: T[], key: (r: T) => string) => groupSum(list, key, () => 1);
        const byReason = count(rows, (r) => r.lossReason);

        return json({
          total: rows.length,
          byReason,
          topReasonShare: rows.length > 0 && byReason[0] ? (byReason[0].value / rows.length) * 100 : 0,
          byCampaign: count(rows, (r) => r.campaignName).slice(0, 20),
          byTeam: count(rows, (r) => r.salesTeam),
          byCourse: count(rows, (r) => r.course).slice(0, 20),
          bySource: count(rows, (r) => r.cleanedSource),
          rows: rows.slice(0, ROW_CAP),
          truncated: rows.length > ROW_CAP,
          appliedFilters: filters,
        });
      },
    },
  },
});
