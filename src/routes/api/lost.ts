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
        const { lostPopulations, lostPopulationCounts, classifyLostRow } =
          await import("@/lib/lost-classification");
        const { canonicalLossReason } = await import("@/lib/loss-reason-taxonomy");
        const { METRIC_CONTRACTS } = await import("@/lib/metric-contracts");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        const closedData = await getFiltered({ ...filters, lostDateBasis: "closed" });
        const labels = data.snapshot.sourceLabels;
        const window = { from: filters.from, to: filters.to };

        // Both reads apply every dimension filter identically; only the date
        // column differs. The canonical classification splits them.
        const lostRows = authoritativeLostLeads(data);
        const closedLostRows = authoritativeLostLeads(closedData);
        const populations = lostPopulations({ cohortRows: lostRows, closedRows: closedLostRows, window });
        const counts = lostPopulationCounts(populations);
        const hasCampaign = (row: (typeof closedLostRows)[number]) =>
          Boolean(row.campaignId || row.campaignName.trim());

        // Each team's denominator is its active non-Lost population plus that
        // team's canonical 1.26 losses. The two arrays are disjoint by design.
        const leadsByTeam = new Map<string, number>();
        const lostByTeam = new Map<string, number>();
        for (const c of data.crm) {
          const k = c.salesTeam || "—";
          leadsByTeam.set(k, (leadsByTeam.get(k) ?? 0) + 1);
        }
        for (const lost of populations.cohortLost) {
          const k = lost.salesTeam || "—";
          leadsByTeam.set(k, (leadsByTeam.get(k) ?? 0) + 1);
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
          /**
           * The three canonical Lost populations. `closedLostInPeriod` always
           * equals created-and-lost + older-cohort + undated-cohort.
           */
          populations: counts,
          closureMovement: {
            closedLost: counts.closedLostInPeriod,
            fromCampaign: populations.closedLostInPeriod.filter(hasCampaign).length,
            createdInPeriod: counts.createdAndLostInPeriod,
            campaignCreatedInPeriod: populations.createdAndLostInPeriod.filter(hasCampaign).length,
            // Kept for existing readers: everything closed in the window that
            // was not also created in it.
            fromOlderCohorts:
              counts.olderCohortClosedLostInPeriod + counts.undatedCohortClosedLostInPeriod,
            olderCohortClosedLostInPeriod: counts.olderCohortClosedLostInPeriod,
            undatedCohortClosedLostInPeriod: counts.undatedCohortClosedLostInPeriod,
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
          contracts: {
            cohortLost: METRIC_CONTRACTS.cohortLost,
            closedLostInPeriod: METRIC_CONTRACTS.closedLostInPeriod,
            olderCohortClosedLostInPeriod: METRIC_CONTRACTS.olderCohortClosedLostInPeriod,
          },
          detail: capped(
            lostRows.map((l) => {
              const reason = canonicalLossReason(l.lossReason);
              return {
                createdAt: l.createdAt,
                closeDate: l.lostDate || l.closeDate,
                recordType: l.recordType,
                active: l.active,
                category: l.lostCategory,
                reportingDate: archivedLostReportingDate(l, data.snapshot),
                closedInPeriod: classifyLostRow(l, window).closedLostInPeriod,
                campaign: l.campaignName,
                adName: l.adName,
                reason: l.lossReason,
                rawReason: reason.rawReason,
                canonicalReasonKey: reason.canonicalReasonKey,
                canonicalReasonLabelAr: reason.canonicalReasonLabelAr,
                canonicalReasonLabelEn: reason.canonicalReasonLabelEn,
                course: l.course,
                mainCategory: l.mainCategory,
                salesTeam: l.salesTeam,
                salesperson: l.salesperson,
                source: labels.get(l.sourceKey) ?? l.source,
                stage: l.stage,
              };
            }),
          ),
          health: data.snapshot.health,
          appliedFilters: filters,
        });
      },
    },
  },
});
