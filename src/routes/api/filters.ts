import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/filters")({
  server: {
    handlers: {
      GET: async () => {
        const { loadAllData } = await import("@/lib/sheet-cache.server");
        const { getDefaultRange } = await import("@/lib/metrics.server");
        const { json } = await import("@/lib/api.server");

        const data = await loadAllData();
        const defaultRange = await getDefaultRange();

        const accounts = new Set<string>();
        const campaigns = new Set<string>();
        const adsets = new Set<string>();
        const ads = new Set<string>();
        const sources = new Set<string>();
        const mainCategories = new Set<string>();
        const salesTeams = new Set<string>();
        const salespeople = new Set<string>();
        const courses = new Set<string>();

        for (const a of data.ads) {
          if (a.account) accounts.add(a.account);
          if (a.campaign) campaigns.add(a.campaign);
          if (a.adset) adsets.add(a.adset);
          if (a.ad) ads.add(a.ad);
        }
        for (const c of data.crm) {
          if (c.campaignName) campaigns.add(c.campaignName);
          if (c.adset) adsets.add(c.adset);
          if (c.mainCategory) mainCategories.add(c.mainCategory);
          if (c.salesTeam) salesTeams.add(c.salesTeam);
          if (c.salesperson) salespeople.add(c.salesperson);
          if (c.course) courses.add(c.course);
        }
        for (const i of data.invoiced) {
          if (i.mainCategory) mainCategories.add(i.mainCategory);
          if (i.course) courses.add(i.course);
          if (i.salesperson) salespeople.add(i.salesperson);
        }
        // One entry per normalized source key, labelled with its dominant
        // casing, so "uchat" and "UChat" appear once rather than twice.
        for (const label of data.sourceLabels.values()) if (label) sources.add(label);

        const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));

        return json({
          accounts: data.accounts.map((a) => ({
            name: a.name,
            platform: a.platform,
            objective: a.objective,
            spend: a.spend,
            platformLeads: a.platformLeads,
          })),
          accountNames: sorted(accounts),
          campaigns: sorted(campaigns),
          adsets: sorted(adsets),
          ads: sorted(ads),
          sources: sorted(sources),
          mainCategories: sorted(mainCategories),
          salesTeams: sorted(salesTeams),
          salespeople: sorted(salespeople),
          courses: sorted(courses),
          defaultRange,
          years: data.years,
          coverage: {
            adsDateMin: data.adsDateMin,
            adsDateMax: data.adsDateMax,
            crmDateMin: data.crmDateMin,
            crmDateMax: data.crmDateMax,
            revenueDateMin: data.revenueDateMin,
            revenueDateMax: data.revenueDateMax,
          },
          syncedAt: data.syncedAt,
          oldestSyncedAt: data.oldestSyncedAt,
          tabSyncs: data.tabSyncs,
          // When this app last pulled the sheet — the only one Refresh moves.
          fetchedAt: new Date(data.fetchedAt).toISOString(),
          health: data.health,
          fetchErrors: data.fetchErrors,
          counts: {
            ads: data.ads.length,
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
