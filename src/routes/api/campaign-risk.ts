import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/campaign-risk")({
  server: {
    handlers: {
      GET: async () => {
        const { getDefaultRange, getFiltered, computeRecentCampaignActivity } = await import(
          "@/lib/metrics.server"
        );
        const { json } = await import("@/lib/api.server");
        const range = await getDefaultRange();
        const current = await getFiltered(range);
        const activity = await computeRecentCampaignActivity(range, current);
        return json({
          activity,
          generatedAt: new Date().toISOString(),
          scope: "all_platforms",
        });
      },
    },
  },
});
