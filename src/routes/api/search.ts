import { createFileRoute } from "@tanstack/react-router";

/**
 * Entity search: real campaigns, creatives and courses by name.
 *
 * It reads the same cached snapshot every report reads, scores names with the
 * same matcher the client uses on report titles, and returns a bounded handful
 * per group — never the catalogue. Nothing here is a new source of truth: every
 * row points back at a screen that already exists.
 */
export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { json } = await import("@/lib/api.server");
        const { loadAllData } = await import("@/lib/sheet-cache.server");
        const { searchNamed, normalizeTerm } = await import("@/lib/global-search");

        const url = new URL(request.url);
        const query = (url.searchParams.get("q") ?? "").slice(0, 80);
        if (normalizeTerm(query).length < 2)
          return json({ campaigns: [], creatives: [], courses: [] });

        const data = await loadAllData();

        // One entry per campaign, with the key the Campaigns screen opens by.
        const campaigns = new Map<
          string,
          { key: string; name: string; platform: string; course: string; spend: number }
        >();
        for (const row of data.ads) {
          if (!row.campaign) continue;
          const key = row.campaignKey || row.campaign;
          const entry = campaigns.get(key) ?? {
            key,
            name: row.campaign,
            platform: row.platform,
            course: "",
            spend: 0,
          };
          entry.spend += row.spend ?? 0;
          campaigns.set(key, entry);
        }
        for (const [key, entry] of campaigns) {
          const meta = data.campaigns.get(key);
          if (meta?.course) entry.course = meta.course;
        }

        const creatives = new Map<
          string,
          { id: string; name: string; campaign: string; platform: string; thumbnailUrl?: string }
        >();
        for (const creative of data.creatives) {
          const id = creative.creativeId;
          if (!id || creatives.has(id)) continue;
          creatives.set(id, {
            id,
            name: creative.creativeName || creative.ad || id,
            campaign: creative.campaign,
            platform: creative.platform,
            thumbnailUrl: creative.thumbnailUrl,
          });
        }

        const courses = new Set<string>();
        for (const row of data.crm) if (row.course) courses.add(row.course);
        for (const row of data.accounting) if (row.course) courses.add(row.course);

        return json({
          campaigns: searchNamed(
            query,
            [...campaigns.values()].map((entry) => ({
              ...entry,
              name: entry.name,
              extra: [entry.course, entry.platform],
            })),
            6,
          ).map(({ item }) => ({
            key: item.key,
            name: item.name,
            platform: item.platform,
            course: item.course,
            spend: Math.round(item.spend),
          })),
          creatives: searchNamed(
            query,
            [...creatives.values()].map((entry) => ({ ...entry, extra: [entry.campaign] })),
            6,
          ).map(({ item }) => ({
            id: item.id,
            name: item.name,
            campaign: item.campaign,
            platform: item.platform,
            thumbnailUrl: item.thumbnailUrl,
          })),
          courses: searchNamed(
            query,
            [...courses].map((name) => ({ name })),
            5,
          ).map(({ item }) => ({ name: item.name })),
        });
      },
    },
  },
});
