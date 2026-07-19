import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/filters")({
  server: {
    handlers: {
      GET: async () => {
        const { loadAllData } = await import("@/lib/sheet-cache.server");
        const { json } = await import("@/lib/api.server");
        const data = await loadAllData();

        const accounts = new Set<string>();
        const campaigns = new Set<string>();
        const sources = new Set<string>();
        const mainCategories = new Set<string>();
        const salesTeams = new Set<string>();
        const courses = new Set<string>();

        for (const m of data.meta) {
          if (m.account) accounts.add(m.account);
          if (m.campaign) campaigns.add(m.campaign);
        }
        for (const c of data.crm) {
          if (c.campaignName) campaigns.add(c.campaignName);
          if (c.cleanedSource) sources.add(c.cleanedSource);
          if (c.mainCategory) mainCategories.add(c.mainCategory);
          if (c.salesTeam) salesTeams.add(c.salesTeam);
          if (c.course) courses.add(c.course);
        }
        for (const i of data.invoiced) {
          if (i.mainCategory) mainCategories.add(i.mainCategory);
          if (i.salesTeam) salesTeams.add(i.salesTeam);
          if (i.course) courses.add(i.course);
        }

        const sorted = (s: Set<string>) => Array.from(s).sort((a, b) => a.localeCompare(b));

        return json({
          accounts: sorted(accounts),
          campaigns: sorted(campaigns),
          sources: sorted(sources),
          mainCategories: sorted(mainCategories),
          salesTeams: sorted(salesTeams),
          courses: sorted(courses),
          metaDateMin: data.metaDateMin,
          metaDateMax: data.metaDateMax,
          revenueDateMin: data.revenueDateMin,
          revenueDateMax: data.revenueDateMax,
          syncedAt: data.syncedAt,
          fetchedAt: new Date(data.fetchedAt).toISOString(),
          matchRate: data.matchRate,
          dataQuality: data.dataQuality,
          fetchErrors: data.fetchErrors,
          counts: {
            meta: data.meta.length,
            crm: data.crm.length,
            invoiced: data.invoiced.length,
            sales: data.sales.length,
            lost: data.lost.length,
          },
        });
      },
    },
  },
});
