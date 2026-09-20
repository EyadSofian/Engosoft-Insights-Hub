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
          previousPeriod,
        } = await import("@/lib/metrics.server");
        const { parseFilters, json, capped } = await import("@/lib/api.server");
        const { lostPopulations, lostPopulationCounts, classifyLostRow } =
          await import("@/lib/lost-classification");
        const { canonicalLossReason } = await import("@/lib/loss-reason-taxonomy");
        const { auditDuplicateReasons } = await import("@/lib/lost-duplicate-audit");
        const { odooConfig } = await import("@/lib/odoo.server");
        const { METRIC_CONTRACTS } = await import("@/lib/metric-contracts");
        const { buildCourseLeadLossReport, buildCourseLostMovementReport } =
          await import("@/lib/course-lead-loss");
        const { canonicalCourseValue, normalizeCourseKey } = await import("@/lib/course-taxonomy");
        const { loadFreshLostPipeline, loadArchivedLostLeads } =
          await import("@/lib/crm-fresh-lost.server");

        const filters = await parseFilters(request);
        const requestParams = new URL(request.url).searchParams;
        const detailReasonKey = requestParams.get("detailReason")?.trim() || "";
        const detailCourseKey = requestParams.get("detailCourse")?.trim() || "";
        const requestedDetailScope = requestParams.get("detailScope");
        const detailScope =
          requestedDetailScope === "closed"
            ? "closed"
            : requestedDetailScope === "cohort-live"
              ? "cohort-live"
              : "cohort";
        const detailOffset = Math.max(0, Number(requestParams.get("detailOffset")) || 0);
        const detailLimit = Math.min(
          200,
          Math.max(1, Number(requestParams.get("detailLimit")) || 50),
        );
        const prevRange = previousPeriod(filters.from, filters.to);
        const [data, closedData, prevData] = await Promise.all([
          getFiltered(filters),
          getFiltered({ ...filters, lostDateBasis: "closed" }),
          prevRange ? getFiltered({ ...filters, ...prevRange }) : Promise.resolve(null),
        ]);
        const labels = data.snapshot.sourceLabels;
        const window = { from: filters.from, to: filters.to };
        const [freshPipeline, archivedLeads] = await Promise.all([
          loadFreshLostPipeline(filters, data.snapshot),
          loadArchivedLostLeads(filters, data.snapshot),
        ]);
        const liveCohortAvailable =
          freshPipeline.availability === "available" && archivedLeads.availability === "available";
        const liveCohortRows = liveCohortAvailable
          ? [...freshPipeline.records, ...archivedLeads.records]
          : [];

        // Lost is a live Odoo metric. Never silently replace it with the
        // sheet snapshot: a stale number is more dangerous than an explicit
        // unavailable state while reconciling Odoo.
        if (!liveCohortAvailable) {
          return json(
            {
              error: "Live Odoo Lost cohort is unavailable; no snapshot fallback was used.",
              code: "ODOO_LIVE_UNAVAILABLE",
              cohortAuthority: {
                source: "odoo_unavailable",
                total: null,
                lostLeads: null,
                lostOpportunities: null,
                snapshotTotal: computeTotals(data).lost,
                snapshotDelta: null,
                fetchedAt: new Date().toISOString(),
              },
              details: {
                pipeline: freshPipeline.error ?? null,
                archivedLeads: archivedLeads.error ?? null,
              },
            },
            503,
          );
        }

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
        const courseLeadLoss = buildCourseLeadLossReport({
          active: data.crm,
          lost: liveCohortRows,
          previousActive: prevData?.crm,
          previousLost: prevData ? authoritativeLostLeads(prevData) : [],
          currentRange: { from: filters.from ?? "", to: filters.to ?? "" },
          previousRange: prevRange,
        });
        const courseLostMovement = buildCourseLostMovementReport({
          lost: closedLostRows,
          range: { from: filters.from ?? "", to: filters.to ?? "" },
        });
        const duplicateAudit = auditDuplicateReasons(lostRows, [
          ...data.snapshot.crm,
          ...data.snapshot.lost,
        ]);
        const duplicateEvidence = new Map(duplicateAudit.records.map((row) => [row.id, row]));
        const odooBaseUrl = odooConfig().url;
        const hasCampaign = (row: (typeof closedLostRows)[number]) =>
          Boolean(row.campaignId || row.campaignName.trim());
        const reportCourseKey = (course: string) => {
          const rawCourse = course.trim() || "Unclassified";
          const canonicalCourse =
            rawCourse === "Unclassified" ? rawCourse : canonicalCourseValue(rawCourse) || rawCourse;
          return normalizeCourseKey(canonicalCourse);
        };

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

        const baseDetailRows = detailScope === "closed" ? closedLostRows : lostRows;
        const detailSource = detailCourseKey
          ? baseDetailRows.filter((row) => reportCourseKey(row.course) === detailCourseKey)
          : detailReasonKey
            ? lostRows.filter(
                (row) => canonicalLossReason(row.lossReason).canonicalReasonKey === detailReasonKey,
              )
            : lostRows;
        const snapshotDetailRows = detailSource
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
        const liveCourseDetailRows =
          detailCourseKey && detailScope === "cohort-live"
            ? liveCohortRows
                .filter((row) => reportCourseKey(row.course) === detailCourseKey)
                .map((row) => ({
                  id: row.id,
                  contact: row.contact,
                  phone: "",
                  mobile: "",
                  email: "",
                  odooUrl: row.odooUrl,
                  createdAt: row.createdAt,
                  closeDate: "",
                  lostDateBasis: "creation_cohort_live_odoo",
                  recordType: row.recordType,
                  active: row.active,
                  category: row.lostCategory,
                  reportingDate: row.createdAt,
                  closedInPeriod: false,
                  campaign: "",
                  adName: "",
                  reason: row.lossReason,
                  rawReason: row.lossReason,
                  canonicalReasonKey: canonicalLossReason(row.lossReason).canonicalReasonKey,
                  canonicalReasonLabelAr: canonicalLossReason(row.lossReason)
                    .canonicalReasonLabelAr,
                  canonicalReasonLabelEn: canonicalLossReason(row.lossReason)
                    .canonicalReasonLabelEn,
                  duplicateEvidence: null,
                  course: row.course,
                  mainCategory: "",
                  salesTeam: row.salesTeam,
                  salesperson: row.salesperson,
                  source: row.source,
                  stage: row.stage,
                }))
                .sort(
                  (a, b) =>
                    String(b.createdAt).localeCompare(String(a.createdAt)) ||
                    Number(b.id) - Number(a.id),
                )
            : null;
        const detailRows = liveCourseDetailRows ?? snapshotDetailRows;
        const snapshotTotals = computeTotals(data);
        const authoritativeLost = liveCohortRows.length;
        const totals = {
          ...snapshotTotals,
          lost: authoritativeLost,
          archivedLeads: authoritativeLost,
          totalLeads: data.crm.length + authoritativeLost,
          lostRate:
            data.crm.length + authoritativeLost > 0
              ? (authoritativeLost / (data.crm.length + authoritativeLost)) * 100
              : null,
        };
        const detail =
          detailReasonKey || detailCourseKey
            ? {
                rows: detailRows.slice(detailOffset, detailOffset + detailLimit),
                total: detailRows.length,
                truncated: detailOffset + detailLimit < detailRows.length,
                offset: detailOffset,
                limit: detailLimit,
                reasonKey: detailReasonKey,
                courseKey: detailCourseKey,
                scope: detailScope,
              }
            : { ...capped(detailRows), offset: 0, limit: Math.min(detailRows.length, 3000) };

        return json({
          breakdown: computeLost(data),
          courseLeadLoss,
          courseLostMovement,
          duplicateAudit: {
            declaredCount: duplicateAudit.declaredCount,
            declaredShare: duplicateAudit.declaredShare,
            supportedCount: duplicateAudit.supportedCount,
            unsupportedCount: duplicateAudit.unsupportedCount,
            supportRate: duplicateAudit.supportRate,
            identityGroups: duplicateAudit.identityGroups,
            universeRecords: duplicateAudit.universeRecords,
          },
          teamLostRates,
          totals,
          cohortAuthority: {
            source: "odoo_live",
            total: authoritativeLost,
            lostLeads: archivedLeads.records.length,
            lostOpportunities: freshPipeline.records.length,
            snapshotTotal: snapshotTotals.lost,
            snapshotDelta: authoritativeLost - snapshotTotals.lost,
            fetchedAt: [freshPipeline.fetchedAt, archivedLeads.fetchedAt].sort().at(-1),
          },
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
