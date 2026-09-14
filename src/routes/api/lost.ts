import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/lost")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const {
          getFiltered,
          archivedLostReportingDate,
          computeLost,
          computeTotals,
          authoritativeLostLeads,
        } = await import("@/lib/metrics.server");
        const { parseFilters, json, capped } = await import("@/lib/api.server");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        const closedData = await getFiltered({ ...filters, lostDateBasis: "closed" });
        const labels = data.snapshot.sourceLabels;

        const lostRows = authoritativeLostLeads(data);
        const canonicalRows = authoritativeLostLeads(data);
        const closedLostRows = authoritativeLostLeads(closedData);
        const createdInsideWindow = (createdAt: string) => {
          if (!createdAt) return false;
          if (filters.from && createdAt < filters.from) return false;
          if (filters.to && createdAt > filters.to) return false;
          return true;
        };
        const hasCampaign = (row: (typeof closedLostRows)[number]) =>
          Boolean(row.campaignId || row.campaignName.trim());
        const closedCreatedInPeriod = closedLostRows.filter((row) =>
          createdInsideWindow(row.createdAt),
        );

        // Each team's denominator is its active non-Lost population plus that
        // team's canonical 1.26 losses. The two arrays are disjoint by design.
        const leadsByTeam = new Map<string, number>();
        const lostByTeam = new Map<string, number>();
        for (const c of data.crm) {
          const k = c.salesTeam || "—";
          leadsByTeam.set(k, (leadsByTeam.get(k) ?? 0) + 1);
        }
        for (const lost of canonicalRows) {
          const k = lost.salesTeam || "—";
          leadsByTeam.set(k, (leadsByTeam.get(k) ?? 0) + 1);
        }
        for (const lost of lostRows) {
          const k = lost.salesTeam || "—";
          lostByTeam.set(k, (lostByTeam.get(k) ?? 0) + 1);
        }
        const teamLostRates = [...leadsByTeam.entries()]
          .map(([team, leads]) => {
            const lost = lostByTeam.get(team) ?? 0;
            return { team, leads, lost, rate: leads > 0 ? (lost / leads) * 100 : null };
          })
          .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));

        return json({
          breakdown: computeLost(data),
          teamLostRates,
          totals: computeTotals(data),
          closureMovement: {
            closedLost: closedLostRows.length,
            fromCampaign: closedLostRows.filter(hasCampaign).length,
            createdInPeriod: closedCreatedInPeriod.length,
            campaignCreatedInPeriod: closedCreatedInPeriod.filter(hasCampaign).length,
            fromOlderCohorts: closedLostRows.length - closedCreatedInPeriod.length,
            lostLeads: closedLostRows.filter((row) => row.recordType === "lead").length,
            lostOpportunities: closedLostRows.filter((row) => row.recordType === "opportunity")
              .length,
            currentOpportunities: closedLostRows.filter(
              (row) => row.recordType === "opportunity" && row.active,
            ).length,
            historicalOpportunities: closedLostRows.filter(
              (row) => row.recordType === "opportunity" && !row.active,
            ).length,
          },
          detail: capped(
            lostRows.map((l) => ({
              createdAt: l.createdAt,
              closeDate: l.lostDate || l.closeDate,
              recordType: l.recordType,
              active: l.active,
              category: l.lostCategory,
              reportingDate: archivedLostReportingDate(l, data.snapshot),
              campaign: l.campaignName,
              adName: l.adName,
              reason: l.lossReason,
              course: l.course,
              mainCategory: l.mainCategory,
              salesTeam: l.salesTeam,
              salesperson: l.salesperson,
              source: labels.get(l.sourceKey) ?? l.source,
              stage: l.stage,
            })),
          ),
          health: data.snapshot.health,
          appliedFilters: filters,
        });
      },
    },
  },
});
