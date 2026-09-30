import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/lead-ranking")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { buildLeadRankings, leadRankingWindow, nextDistributionMonth } =
          await import("@/lib/lead-ranking");
        const { json } = await import("@/lib/api.server");
        const month = new URL(request.url).searchParams.get("month") ?? nextDistributionMonth();
        let window;
        try {
          window = leadRankingWindow(month);
        } catch (error) {
          return json({ error: (error as Error).message }, 400);
        }
        const { getFiltered, authoritativeLostLeads } = await import("@/lib/metrics.server");
        const { getEmployeeDirectory } = await import("@/lib/employee-directory.server");
        const { normalizePersonName } = await import("@/lib/person-name");
        const { hasReportableLost } = await import("@/lib/lost-authority");
        const { loadFreshLostPipeline, loadArchivedLostLeads } =
          await import("@/lib/crm-fresh-lost.server");
        // A dedicated month controls the complete six-month peer population.
        // Global date/employee/ad filters must never silently change these ranks.
        const data = await getFiltered({ from: window.from, to: window.to, dateBasis: "payment" });
        const directory = await getEmployeeDirectory();
        const [freshLost, archivedLost] = await Promise.all([
          loadFreshLostPipeline(data.applied, data.snapshot),
          loadArchivedLostLeads(data.applied, data.snapshot),
        ]);
        const liveLostAvailable =
          freshLost.availability === "available" && archivedLost.availability === "available";
        const lost = liveLostAvailable
          ? [...freshLost.records, ...archivedLost.records].map((row) => ({
              ...row,
              courses: row.courses ?? "",
            }))
          : authoritativeLostLeads(data);
        const aliases = new Map<string, { key: string; name: string }>();
        const ambiguous = new Set<string>();
        for (const person of directory.people) {
          const identity = {
            key: `user:${person.userId || normalizePersonName(person.legalName)}`,
            name: person.displayName,
          };
          for (const spelling of person.spellings) {
            const key = normalizePersonName(spelling);
            if (aliases.has(key) && aliases.get(key)!.key !== identity.key) ambiguous.add(key);
            else aliases.set(key, identity);
          }
        }
        const result = buildLeadRankings({
          month,
          crm: data.crm,
          lost,
          accounting: data.accounting,
          conversionAvailable:
            liveLostAvailable || hasReportableLost(data.snapshot.health.lostAuthority),
          identity: (raw) => {
            const key = normalizePersonName(raw);
            return (
              (!ambiguous.has(key) && aliases.get(key)) || {
                key,
                name: directory.displayNameFor(raw),
              }
            );
          },
        });
        return json({
          ...result,
          rankingRows: result.groups.flatMap((group) =>
            group.rows.map((row) => ({
              ...row,
              key: JSON.stringify([group.key, row.key]),
              specialization: group.specialization,
              course: group.course,
            })),
          ),
          health: {
            crm: data.snapshot.health.crmAuthority,
            lost: liveLostAvailable ? "odoo-direct" : data.snapshot.health.lostAuthority,
            accounting: data.snapshot.health.accountingAuthority,
          },
        });
      },
    },
  },
});
