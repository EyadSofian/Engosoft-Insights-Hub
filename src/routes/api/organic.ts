import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/organic")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const {
          archivedCrmLeads,
          archivedLostReportingDate,
          archivedWinCounter,
          computeCourses,
          computeTeams,
          computeTotals,
          div,
          getFiltered,
        } = await import("@/lib/metrics.server");
        const { parseFilters, json } = await import("@/lib/api.server");
        const { accountingReportingDate } = await import("@/lib/accounting-policy");
        const { normalizeName } = await import("@/lib/sheet-cache.server");

        const requested = await parseFilters(request);
        // Organic is the invariant of this report. A stale paid-media hierarchy
        // must not make the dedicated page look empty when somebody opens it
        // after inspecting a Meta/Google campaign.
        const filters = {
          ...requested,
          platform: undefined,
          channel: "organic" as const,
          account: undefined,
          campaign: requested.channel === "organic" ? requested.campaign : undefined,
          campaignKey: requested.channel === "organic" ? requested.campaignKey : undefined,
          adset: undefined,
          adsetKey: undefined,
          ad: undefined,
          adKey: undefined,
        };
        const data = await getFiltered(filters);
        const totals = computeTotals(data);
        const courses = computeCourses(data);
        const teams = computeTeams(data);
        const people = teams.flatMap((team) => team.people ?? []);
        const archivedWon = archivedWinCounter(data);
        const rate = (part: number, total: number) => {
          const value = div(part, total);
          return value === null ? null : value * 100;
        };
        const sourceLabel = (key: string, fallback: string) =>
          (data.snapshot.sourceLabels.get(key) ?? fallback) || "—";

        interface SourceAcc {
          key: string;
          name: string;
          leads: number;
          won: number;
          lost: number;
          revenue: number;
          invoiceRefs: Set<string>;
          salesOrderRefs: Set<string>;
        }
        const sourceMap = new Map<string, SourceAcc>();
        const sourceAt = (key: string, fallback: string) => {
          const sourceKey = key || normalizeName(fallback) || "—";
          let value = sourceMap.get(sourceKey);
          if (!value) {
            value = {
              key: sourceKey,
              name: sourceLabel(sourceKey, fallback),
              leads: 0,
              won: 0,
              lost: 0,
              revenue: 0,
              invoiceRefs: new Set(),
              salesOrderRefs: new Set(),
            };
            sourceMap.set(sourceKey, value);
          }
          return value;
        };

        for (const row of data.crm) {
          const source = sourceAt(row.sourceKey, row.source);
          source.leads += 1;
          if (row.isWon) source.won += 1;
        }
        for (const row of archivedCrmLeads(data)) {
          const source = sourceAt(row.sourceKey, row.source);
          source.leads += 1;
          if (archivedWon(row)) source.won += 1;
          else source.lost += 1;
        }
        for (const row of data.accounting) {
          const source = sourceAt(row.sourceKey, row.source);
          source.revenue += row.usdPaid;
          if (row.movement && !row.isCreditNote) source.invoiceRefs.add(row.movement);
        }
        for (const row of data.invoiced) {
          const source = sourceAt(row.sourceKey, row.source);
          if (row.orderRef) source.salesOrderRefs.add(row.orderRef);
        }

        const sources = [...sourceMap.values()]
          .map((source) => ({
            key: source.key,
            name: source.name,
            leads: source.leads,
            won: source.won,
            lost: source.lost,
            open: Math.max(0, source.leads - source.won - source.lost),
            conversionRate: rate(source.won, source.leads),
            lostRate: rate(source.lost, source.leads),
            revenue: source.revenue,
            invoices: source.invoiceRefs.size,
            salesOrders: source.salesOrderRefs.size,
            revenuePerLead: div(source.revenue, source.leads),
            leadShare: rate(source.leads, totals.totalLeads) ?? 0,
            revenueShare: rate(source.revenue, totals.revenue) ?? 0,
          }))
          .sort((a, b) => b.leads - a.leads || b.revenue - a.revenue);

        interface CampaignAcc {
          key: string;
          name: string;
          sources: Set<string>;
          courses: Set<string>;
          leads: number;
          won: number;
          lost: number;
          revenue: number;
          invoiceRefs: Set<string>;
          salesOrderRefs: Set<string>;
        }
        const campaignMap = new Map<string, CampaignAcc>();
        const campaignAt = (key: string, name: string) => {
          const campaignKey = key || normalizeName(name);
          if (!campaignKey) return null;
          let value = campaignMap.get(campaignKey);
          if (!value) {
            value = {
              key: campaignKey,
              name: name || campaignKey,
              sources: new Set(),
              courses: new Set(),
              leads: 0,
              won: 0,
              lost: 0,
              revenue: 0,
              invoiceRefs: new Set(),
              salesOrderRefs: new Set(),
            };
            campaignMap.set(campaignKey, value);
          }
          return value;
        };
        const addDimensions = (
          campaign: CampaignAcc,
          sourceKey: string,
          source: string,
          course: string,
        ) => {
          if (sourceKey || source) campaign.sources.add(sourceLabel(sourceKey, source));
          if (course) campaign.courses.add(course);
        };

        for (const row of data.crm) {
          if (!row.fromCampaign) continue;
          const campaign = campaignAt(row.campaignKey || row.campaignId, row.campaignName);
          if (!campaign) continue;
          campaign.leads += 1;
          if (row.isWon) campaign.won += 1;
          addDimensions(campaign, row.sourceKey, row.source, row.course);
        }
        for (const row of archivedCrmLeads(data)) {
          const campaign = campaignAt(row.campaignKey || row.campaignId, row.campaignName);
          if (!campaign) continue;
          campaign.leads += 1;
          if (archivedWon(row)) campaign.won += 1;
          else campaign.lost += 1;
          addDimensions(campaign, row.sourceKey, row.source, row.course);
        }
        for (const row of data.accounting) {
          const campaign = campaignAt(row.campaignKey || row.campaignId, row.campaignName);
          if (!campaign) continue;
          campaign.revenue += row.usdPaid;
          if (row.movement && !row.isCreditNote) campaign.invoiceRefs.add(row.movement);
          addDimensions(campaign, row.sourceKey, row.source, row.course);
        }
        for (const row of data.invoiced) {
          const campaign = campaignAt(row.campaignKey || row.campaignId, row.campaignName);
          if (!campaign) continue;
          if (row.orderRef) campaign.salesOrderRefs.add(row.orderRef);
          addDimensions(campaign, row.sourceKey, row.source, row.course);
        }

        const campaigns = [...campaignMap.values()]
          .map((campaign) => ({
            key: campaign.key,
            name: campaign.name,
            sources: [...campaign.sources].sort(),
            courses: [...campaign.courses].sort(),
            leads: campaign.leads,
            won: campaign.won,
            lost: campaign.lost,
            open: Math.max(0, campaign.leads - campaign.won - campaign.lost),
            conversionRate: rate(campaign.won, campaign.leads),
            revenue: campaign.revenue,
            invoices: campaign.invoiceRefs.size,
            salesOrders: campaign.salesOrderRefs.size,
            revenuePerLead: div(campaign.revenue, campaign.leads),
          }))
          .sort((a, b) => b.revenue - a.revenue || b.leads - a.leads);

        interface MonthAcc {
          month: string;
          leads: number;
          won: number;
          lost: number;
          revenue: number;
          invoiceRefs: Set<string>;
          salesOrderRefs: Set<string>;
        }
        const monthMap = new Map<string, MonthAcc>();
        const monthAt = (date: string) => {
          const month = date.slice(0, 7);
          if (!/^\d{4}-\d{2}$/.test(month)) return null;
          let value = monthMap.get(month);
          if (!value) {
            value = {
              month,
              leads: 0,
              won: 0,
              lost: 0,
              revenue: 0,
              invoiceRefs: new Set(),
              salesOrderRefs: new Set(),
            };
            monthMap.set(month, value);
          }
          return value;
        };

        for (const row of data.crm) {
          const month = monthAt(row.createdAt);
          if (!month) continue;
          month.leads += 1;
          if (row.isWon) month.won += 1;
        }
        for (const row of archivedCrmLeads(data)) {
          const month = monthAt(archivedLostReportingDate(row, data.snapshot));
          if (!month) continue;
          month.leads += 1;
          if (archivedWon(row)) month.won += 1;
          else month.lost += 1;
        }
        for (const row of data.accounting) {
          const month = monthAt(
            accountingReportingDate(row, filters.dateBasis === "invoice" ? "invoice" : "payment"),
          );
          if (!month) continue;
          month.revenue += row.usdPaid;
          if (row.movement && !row.isCreditNote) month.invoiceRefs.add(row.movement);
        }
        for (const row of data.invoiced) {
          const month = monthAt(row.revenueDate);
          if (month && row.orderRef) month.salesOrderRefs.add(row.orderRef);
        }

        const monthly = [...monthMap.values()]
          .sort((a, b) => a.month.localeCompare(b.month))
          .map((month) => ({
            month: month.month,
            leads: month.leads,
            won: month.won,
            lost: month.lost,
            conversionRate: rate(month.won, month.leads),
            revenue: month.revenue,
            invoices: month.invoiceRefs.size,
            salesOrders: month.salesOrderRefs.size,
          }));

        const topLeadSource = sources[0] ?? null;
        const topRevenueSource = [...sources].sort((a, b) => b.revenue - a.revenue)[0] ?? null;
        const topRevenueCourse = courses[0] ?? null;
        const bestConversionCourse =
          [...courses]
            .filter((course) => course.crmLeads >= 20 && course.conversionRate !== null)
            .sort(
              (a, b) =>
                (b.conversionRate ?? 0) - (a.conversionRate ?? 0) || b.crmLeads - a.crmLeads,
            )[0] ?? null;
        const topTeam = teams[0] ?? null;
        const topSalesperson =
          [...people]
            .filter((person) => person.name !== "—")
            .sort((a, b) => b.revenue - a.revenue || b.crmLeads - a.crmLeads)[0] ?? null;

        return json({
          totals,
          sources,
          courses,
          campaigns,
          monthly,
          teams,
          people,
          insights: {
            topLeadSource,
            topRevenueSource,
            topRevenueCourse,
            bestConversionCourse,
            topTeam,
            topSalesperson,
          },
          counts: {
            sources: sources.length,
            courses: courses.length,
            campaigns: campaigns.length,
            teams: teams.length,
            people: people.length,
          },
          health: data.snapshot.health,
          appliedFilters: filters,
        });
      },
    },
  },
});
