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
        const companies = new Set<string>();
        const adDimensions = new Map<
          string,
          { platform: string; account: string; campaign: string; adset: string; ad: string }
        >();

        for (const a of data.ads) {
          if (a.account) accounts.add(a.account);
          if (a.campaign) campaigns.add(a.campaign);
          if (a.adset) adsets.add(a.adset);
          if (a.ad) ads.add(a.ad);
          const dimension = {
            platform: a.platform,
            account: a.account,
            campaign: a.campaign,
            adset: a.adset,
            ad: a.ad,
          };
          const dimensionKey = Object.values(dimension).join("\u0000");
          if (!adDimensions.has(dimensionKey)) adDimensions.set(dimensionKey, dimension);
        }
        for (const c of data.crm) {
          if (c.campaignName) campaigns.add(c.campaignName);
          if (c.adset) adsets.add(c.adset);
          if (c.mainCategory) mainCategories.add(c.mainCategory);
          if (c.salesTeam) salesTeams.add(c.salesTeam);
          if (c.salesperson) salespeople.add(c.salesperson);
          if (c.course) courses.add(c.course);
        }
        for (const row of data.accounting) {
          if (row.company) companies.add(row.company);
          if (row.mainCategory) mainCategories.add(row.mainCategory);
          if (row.course) courses.add(row.course);
          if (row.salesTeam) salesTeams.add(row.salesTeam);
          if (row.salesperson) salespeople.add(row.salesperson);
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
          adDimensions: [...adDimensions.values()],
          campaigns: sorted(campaigns),
          adsets: sorted(adsets),
          ads: sorted(ads),
          sources: sorted(sources),
          mainCategories: sorted(mainCategories),
          salesTeams: sorted(salesTeams),
          salespeople: sorted(salespeople),
          courses: sorted(courses),
          companies: sorted(companies),
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
          staleTabs: data.staleTabs,
          counts: {
            ads: data.ads.length,
            crm: data.crm.length,
            accounting: data.accounting.length,
            // Compatibility counters for older clients.
            invoiced: data.invoiced.length,
            sales: data.accounting.length,
            lost: data.lost.length,
          },
        });
      },
    },
  },
});
