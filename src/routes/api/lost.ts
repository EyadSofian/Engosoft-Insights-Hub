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
        const { auditDuplicateReasons } = await import("@/lib/lost-duplicate-audit");
        const { loadLostRegistrationAudit } =
          await import("@/lib/crm-lost-registration-audit.server");
        const { odooConfig } = await import("@/lib/odoo.server");
        const { METRIC_CONTRACTS } = await import("@/lib/metric-contracts");

        const filters = await parseFilters(request);
        const requestParams = new URL(request.url).searchParams;
        const detailReasonKey = requestParams.get("detailReason")?.trim() || "";
        const detailOffset = Math.max(0, Number(requestParams.get("detailOffset")) || 0);
        const detailLimit = Math.min(
          200,
          Math.max(1, Number(requestParams.get("detailLimit")) || 50),
        );
        const [data, closedData, registrationAudit] = await Promise.all([
          getFiltered(filters),
          getFiltered({ ...filters, lostDateBasis: "closed" }),
          loadLostRegistrationAudit(),
        ]);
        const labels = data.snapshot.sourceLabels;
        const window = { from: filters.from, to: filters.to };

        // Both reads apply every dimension filter identically; only the date
        // column differs. The canonical classification splits them.
        const lostRows = authoritativeLostLeads(data);
        const closedLostRows = authoritativeLostLeads(closedData);
        const populations = lostPopulations({
          cohortRows: lostRows,
          closedRows: closedLostRows,
          window,
        });
        const counts = lostPopulationCounts(populations);
        const duplicateAudit = auditDuplicateReasons(lostRows, [
          ...data.snapshot.crm,
          ...data.snapshot.lost,
        ]);
        const duplicateEvidence = new Map(duplicateAudit.records.map((row) => [row.id, row]));
        const odooBaseUrl = odooConfig().url;
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

        const detailSource = detailReasonKey
          ? lostRows.filter(
              (row) => canonicalLossReason(row.lossReason).canonicalReasonKey === detailReasonKey,
            )
          : lostRows;
        const detailRows = detailSource
          .map((l) => {
            const reason = canonicalLossReason(l.lossReason);
            const evidence = duplicateEvidence.get(l.id);
            return {
              id: l.id,
              contact: l.contact,
              phone: l.phone,
              mobile: l.mobile,
              email: l.email,
              odooUrl: l.id
                ? `${odooBaseUrl}/web#id=${encodeURIComponent(l.id)}&model=crm.lead&view_type=form`
                : "",
              createdAt: l.createdAt,
              closeDate: l.lostDate || l.closeDate,
              lostDateBasis: l.lostDateBasis,
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
              duplicateEvidence: evidence
                ? {
                    supported: evidence.supported,
                    matchedRecordCount: evidence.matchedRecordCount,
                    sources: evidence.sources,
                  }
                : null,
              course: l.course,
              mainCategory: l.mainCategory,
              salesTeam: l.salesTeam,
              salesperson: l.salesperson,
              source: labels.get(l.sourceKey) ?? l.source,
              stage: l.stage,
            };
          })
          .sort(
            (a, b) =>
              String(b.reportingDate || b.closeDate).localeCompare(
                String(a.reportingDate || a.closeDate),
              ) || Number(b.id) - Number(a.id),
          );
        const detail = detailReasonKey
          ? {
              rows: detailRows.slice(detailOffset, detailOffset + detailLimit),
              total: detailRows.length,
              truncated: detailOffset + detailLimit < detailRows.length,
              offset: detailOffset,
              limit: detailLimit,
              reasonKey: detailReasonKey,
            }
          : { ...capped(detailRows), offset: 0, limit: Math.min(detailRows.length, 3000) };

        return json({
          breakdown: computeLost(data),
          duplicateAudit: {
            declaredCount: duplicateAudit.declaredCount,
            declaredShare: duplicateAudit.declaredShare,
            supportedCount: duplicateAudit.supportedCount,
            unsupportedCount: duplicateAudit.unsupportedCount,
            supportRate: duplicateAudit.supportRate,
            identityGroups: duplicateAudit.identityGroups,
            universeRecords: duplicateAudit.universeRecords,
          },
          registrationAudit,
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
            dateBasisCounts: Object.fromEntries(
              [...new Set(closedLostRows.map((row) => row.lostDateBasis || "unknown"))].map(
                (basis) => [
                  basis,
                  closedLostRows.filter((row) => (row.lostDateBasis || "unknown") === basis).length,
                ],
              ),
            ),
            dateFieldAudit: {
              closeDateInPeriod: data.snapshot.lost.filter(
                (row) => classifyLostRow(row, window).closedLostInPeriod,
              ).length,
              lostDateInPeriod: data.snapshot.lost.filter((row) => {
                const value = String(row.lostDate || "").slice(0, 10);
                return (
                  Boolean(value) &&
                  (!window.from || value >= window.from) &&
                  (!window.to || value <= window.to)
                );
              }).length,
            },
          },
          contracts: {
            cohortLost: METRIC_CONTRACTS.cohortLost,
            closedLostInPeriod: METRIC_CONTRACTS.closedLostInPeriod,
            olderCohortClosedLostInPeriod: METRIC_CONTRACTS.olderCohortClosedLostInPeriod,
          },
          detail,
          health: data.snapshot.health,
          appliedFilters: filters,
        });
      },
    },
  },
});
