import { createFileRoute } from "@tanstack/react-router";
import { matchMediaPlanActivity, matchMediaPlanCourse } from "@/lib/media-plan";

function monthWindow(month: string): { from: string; to: string } {
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(days).padStart(2, "0")}` };
}

export const Route = createFileRoute("/api/media-plan-activity")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { computeRecentCampaignActivity, getFiltered } = await import("@/lib/metrics.server");
        const { parseFilters, json } = await import("@/lib/api.server");
        const { loadMediaPlanSource } = await import("@/lib/media-plans.server");

        const requestedMonth = new URL(request.url).searchParams.get("month") ?? "";
        const source = await loadMediaPlanSource();
        const months = Object.keys(source.plans).sort((a, b) => b.localeCompare(a));
        const month = source.plans[requestedMonth] ? requestedMonth : months[0];
        const plan = source.plans[month];
        const window = monthWindow(month);
        const filters = await parseFilters(request);
        const scopedFilters = {
          ...filters,
          range: undefined,
          from: window.from,
          to: window.to,
          platform: undefined,
          channel: undefined,
          account: undefined,
          campaign: undefined,
          campaignKey: undefined,
          adset: undefined,
          adsetKey: undefined,
          ad: undefined,
          adKey: undefined,
          source: undefined,
          course: undefined,
          mainCategory: undefined,
          salesTeam: undefined,
          salesperson: undefined,
        } as const;

        const current = await getFiltered(scopedFilters);
        const activity = await computeRecentCampaignActivity(scopedFilters, current);
        const campaigns = activity.rows.map((row) => {
          const state = activity.delivery[row.key];
          const period = activity.period[row.key];
          // Current platform campaign name wins over stale historical course
          // attribution. A TikTok campaign called BIM must not inherit PMP from
          // a previously reused campaign id/name join.
          const target = matchMediaPlanCourse(plan.courses, state?.name, row.name, row.course);
          const planActivity = target
            ? null
            : matchMediaPlanActivity(plan.additionalActivities, state?.name, row.name);
          return {
            key: row.key,
            name: state?.name || row.name,
            platform: state?.platform || row.platforms[0],
            account: state?.account || "",
            courseKey: target?.key ?? (planActivity ? `activity:${planActivity.key}` : null),
            course: target?.label ?? planActivity?.label ?? row.course ?? "",
            owners: target?.owners ?? [],
            linked: !!target || !!planActivity,
            planItemType: target ? "course" : planActivity ? "activity" : "unlinked",
            configuredStatus: state?.configuredStatus || "",
            effectiveStatus: state?.effectiveStatus || "",
            servingStatus: state?.servingStatus || "",
            activeAdsets: state?.activeAdsets ?? 0,
            activeAds: state?.activeAds ?? 0,
            checkedAt: state?.checkedAt || "",
            spend: period?.spend ?? 0,
            platformLeads: row.platformLeads,
            crmLeads: period?.crmLeads ?? 0,
            won: period?.won ?? 0,
            revenueUsd: period?.revenue ?? 0,
          };
        });

        return json({
          month,
          window,
          definition: activity.definition,
          source: activity.source,
          generatedAt: activity.generatedAt,
          platformHealth: activity.platformHealth,
          campaigns,
          linkedCount: campaigns.filter((row) => row.linked).length,
          unlinkedCount: campaigns.filter((row) => !row.linked).length,
          courses: [
            ...plan.courses.map((target) => ({ ...target, summaryKey: target.key })),
            ...plan.additionalActivities.map((target) => ({
              ...target,
              owners: [] as string[],
              summaryKey: `activity:${target.key}`,
            })),
          ].map((target) => {
            const rows = campaigns.filter((row) => row.courseKey === target.summaryKey);
            return {
              key: target.summaryKey,
              label: target.label,
              owners: target.owners,
              activeCampaigns: rows.length,
              platforms: [...new Set(rows.map((row) => row.platform))],
              periodSpend: rows.reduce((sum, row) => sum + row.spend, 0),
              periodLeads: rows.reduce((sum, row) => sum + (row.platformLeads ?? row.crmLeads), 0),
            };
          }),
        });
      },
    },
  },
});
