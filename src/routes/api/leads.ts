import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/leads")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered, authoritativeLostLeads, groupBy } =
          await import("@/lib/metrics.server");
        const { CRM_CONTRACT_VERSION } = await import("@/lib/crm-contract");
        const { odooConfig } = await import("@/lib/odoo.server");
        const { parseFilters, json, capped } = await import("@/lib/api.server");

        const filters = await parseFilters(request);
        const data = await getFiltered(filters);
        const labels = data.snapshot.sourceLabels;
        const canonicalLost = authoritativeLostLeads(data);
        const odooBaseUrl = odooConfig().url;

        const activeRows = data.crm.map((row) => ({
          id: row.id,
          odooUrl: row.id
            ? `${odooBaseUrl}/web#id=${encodeURIComponent(row.id)}&model=crm.lead&view_type=form`
            : "",
          createdAt: row.createdAt,
          contact: row.contact,
          phone: row.phone,
          mobile: row.mobile,
          email: row.email,
          recordType: row.recordType,
          active: row.active,
          status: row.businessStatus,
          stageKey: row.stageKey,
          displayStageKey: row.businessStatus === "won" ? "won" : row.stageKey,
          stage: row.cleanedStage || row.stage,
          source: labels.get(row.sourceKey) ?? row.source,
          medium: row.medium,
          communicationLanguage: row.communicationLanguage,
          campaign: row.campaignName,
          campaignId: row.campaignId,
          adName: row.adName,
          adId: row.adId,
          adset: row.adset,
          course: row.course,
          courses: row.courses,
          salesperson: row.salesperson,
          salesTeam: row.salesTeam,
          probability: row.probability,
          automatedProbability: row.automatedProbability,
          closingDurationDays: row.closingDurationDays,
          priority: row.priority,
          readyToConvert: row.readyToConvert,
          leadSegment: row.leadSegment,
          openStatus: row.openStatus,
          closingChannel: row.closingChannel,
          lostCategory: row.lostCategory,
          lossReason: row.lossReason,
          inventoryBucket: row.inventoryBucket,
          courseLanguage: row.courseLanguage,
          courseType: row.courseType,
          customerType: row.customerType,
          callingReply: row.callingReply,
          jobType: row.jobType,
          howFoundUs: row.howFoundUs,
          company: row.company,
          tags: row.tags,
          targetName: row.targetName,
          resignTarget: row.resignTarget,
          facebookLeadId: row.facebookLeadId,
          validateClosedReason: row.validateClosedReason,
          lastStageUpdate: row.lastStageUpdate,
          wonDate: row.wonDate || row.closedAt,
          lostDate: row.lostDate,
          conversionDate: row.conversionDate,
          closedAt: row.closedAt,
          daysToClose: row.daysToClose,
        }));

        const lostRows = canonicalLost.map((row) => ({
          id: row.id,
          odooUrl: row.id
            ? `${odooBaseUrl}/web#id=${encodeURIComponent(row.id)}&model=crm.lead&view_type=form`
            : "",
          createdAt: row.createdAt,
          contact: row.contact,
          phone: row.phone,
          mobile: row.mobile,
          email: row.email,
          recordType: row.recordType,
          active: row.active,
          status: "lost" as const,
          // A Lost Lead keeps its real stage in Odoo. `displayStageKey` is the
          // lifecycle lane, while `stageKey` and `stage` preserve its actual stage.
          stageKey: row.stageKey,
          displayStageKey: "lost" as const,
          stage: row.stage,
          source: labels.get(row.sourceKey) ?? row.source,
          medium: row.medium,
          communicationLanguage: row.communicationLanguage,
          campaign: row.campaignName,
          campaignId: row.campaignId,
          adName: row.adName,
          adId: row.adId,
          adset: row.adset,
          course: row.course,
          courses: row.courses,
          salesperson: row.salesperson,
          salesTeam: row.salesTeam,
          probability: row.probability,
          automatedProbability: row.automatedProbability,
          closingDurationDays: row.closingDurationDays,
          priority: row.priority,
          readyToConvert: row.readyToConvert,
          leadSegment: row.leadSegment,
          openStatus: row.openStatus,
          closingChannel: row.closingChannel,
          lostCategory: row.lostCategory,
          lossReason: row.lossReason,
          inventoryBucket: row.inventoryBucket,
          courseLanguage: row.courseLanguage,
          courseType: row.courseType,
          customerType: row.customerType,
          callingReply: row.callingReply,
          jobType: row.jobType,
          howFoundUs: row.howFoundUs,
          company: row.company,
          tags: row.tags,
          targetName: row.targetName,
          resignTarget: row.resignTarget,
          facebookLeadId: row.facebookLeadId,
          validateClosedReason: row.validateClosedReason,
          lastStageUpdate: row.lastStageUpdate,
          wonDate: row.wonDate,
          lostDate: row.lostDate || row.closeDate,
          conversionDate: row.conversionDate,
          closedAt: row.closeDate,
          daysToClose: null,
        }));

        const workspaceRows = [...activeRows, ...lostRows];
        const stageKeys = ["preparation", "new", "open", "quotation", "won", "lost"] as const;
        const inStage = (key: (typeof stageKeys)[number]) =>
          workspaceRows.filter((row) => row.displayStageKey === key);
        const top = <T>(rows: T[], pick: (row: T) => string) =>
          groupBy(rows, (row) => pick(row) || "—").slice(0, 8);
        const facets = (rows: typeof workspaceRows) => ({
          byType: top(rows, (row) => (row.recordType === "lead" ? "Lead" : "Opportunity")),
          bySource: top(rows, (row) => row.source),
          byTeam: top(rows, (row) => row.salesTeam),
          byCourse: top(rows, (row) => row.course),
          byPriority: top(rows, (row) => row.priority),
          byLeadSegment: top(rows, (row) => row.leadSegment),
          byOpenStatus: top(rows, (row) => row.openStatus),
          byCallingReply: top(rows, (row) => row.callingReply),
          byClosingChannel: top(rows, (row) => row.closingChannel),
          byLostCategory: top(rows, (row) => row.lostCategory),
          byLostReason: top(rows, (row) => row.lossReason),
          byPreviousStage: top(rows, (row) => row.stage),
          byCourseLanguage: top(rows, (row) => row.courseLanguage),
          byCourseType: top(rows, (row) => row.courseType),
          byCustomerType: top(rows, (row) => row.customerType),
        });

        const stages = stageKeys.map((key) => {
          const rows = inStage(key);
          return {
            key,
            count: rows.length,
            leads: rows.filter((row) => row.recordType === "lead").length,
            opportunities: rows.filter((row) => row.recordType === "opportunity").length,
            active: rows.filter((row) => row.active).length,
          };
        });

        return json({
          contractVersion: CRM_CONTRACT_VERSION,
          summary: {
            total: workspaceRows.length,
            activeLeads: activeRows.filter((row) => row.recordType === "lead").length,
            openOpportunities: activeRows.filter((row) => row.status === "open").length,
            won: activeRows.filter((row) => row.status === "won").length,
            lost: lostRows.length,
            lostLeads: lostRows.filter((row) => row.recordType === "lead").length,
            lostOpportunities: lostRows.filter((row) => row.recordType === "opportunity").length,
            currentLostOpportunities: lostRows.filter(
              (row) => row.recordType === "opportunity" && row.active,
            ).length,
            historicalLostOpportunities: lostRows.filter(
              (row) => row.recordType === "opportunity" && !row.active,
            ).length,
            // Never infer a canonical Odoo stage from a legacy translated
            // label. Keeping this count visible prevents an old snapshot from
            // making New/Open/Quotation look like real business zeroes.
            unmappedOperationalStages: activeRows.filter(
              (row) => (row.status === "lead" || row.status === "open") && row.stageKey === "other",
            ).length,
            readyToConvert: activeRows.filter(
              (row) => row.recordType === "lead" && row.readyToConvert,
            ).length,
            unsourced: workspaceRows.filter((row) => !row.source).length,
          },
          stages,
          facets: facets(workspaceRows),
          stageFacets: Object.fromEntries(stageKeys.map((key) => [key, facets(inStage(key))])),
          statusFacets: {
            all: facets(workspaceRows),
            leads: facets(workspaceRows.filter((row) => row.recordType === "lead")),
            activeLeads: facets(
              workspaceRows.filter((row) => row.recordType === "lead" && row.active),
            ),
            ready: facets(
              workspaceRows.filter(
                (row) => row.recordType === "lead" && row.active && row.readyToConvert,
              ),
            ),
            pipeline: facets(
              workspaceRows.filter((row) => row.status === "lead" || row.status === "open"),
            ),
            open: facets(workspaceRows.filter((row) => row.status === "open")),
            won: facets(workspaceRows.filter((row) => row.status === "won")),
            lost: facets(workspaceRows.filter((row) => row.status === "lost")),
          },
          lostTypeFacets: {
            leads: facets(lostRows.filter((row) => row.recordType === "lead")),
            opportunities: facets(lostRows.filter((row) => row.recordType === "opportunity")),
          },
          detail: capped(
            workspaceRows.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          ),
          health: data.snapshot.health,
          appliedFilters: filters,
        });
      },
    },
  },
});
