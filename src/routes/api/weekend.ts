import { createFileRoute } from "@tanstack/react-router";
import type { FilteredData } from "@/lib/metrics.server";
import type { Maybe, Platform } from "@/lib/types";

export const Route = createFileRoute("/api/weekend")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const {
          archivedCrmLeads,
          archivedWinCounter,
          authoritativeLostLeads,
          getDefaultRange,
          getFiltered,
        } = await import("@/lib/metrics.server");
        const { parseFilters, json } = await import("@/lib/api.server");
        const { PLATFORMS } = await import("@/lib/constants");
        const { hasReportableLost } = await import("@/lib/lost-authority");
        const {
          completedWeekendWindow,
          isWeekendDate,
          pointDelta,
          ratioDelta,
          shiftIsoDate,
          utcWeekday,
          weekendBudgetDecision,
          weekStart,
        } = await import("@/lib/weekend-analysis");

        const requested = await parseFilters(request);
        const defaultRange = await getDefaultRange();
        const latest = defaultRange.to || requested.to || new Date().toISOString().slice(0, 10);
        // A custom "to" date can move the eight-week study backwards, but it
        // can never move past the freshest date the dashboard actually owns.
        const anchor = requested.to && requested.to < latest ? requested.to : latest;
        const window = completedWeekendWindow(anchor, 8);
        const scope = {
          from: window.from,
          to: window.to,
          dateBasis: requested.dateBasis,
          fxEgp: requested.fxEgp,
          fxSar: requested.fxSar,
        };

        const platformData = await Promise.all(
          PLATFORMS.map(async (platform) => ({
            platform,
            data: await getFiltered({ ...scope, platform }),
          })),
        );
        const lostAvailable = hasReportableLost(
          platformData[0]?.data.snapshot.health.lostAuthority ?? "unavailable",
        );

        interface Facts {
          data: FilteredData;
          archived: ReturnType<typeof archivedCrmLeads>;
          lost: ReturnType<typeof authoritativeLostLeads>;
          archivedWon: ReturnType<typeof archivedWinCounter>;
        }
        interface Metrics {
          spend: number;
          avgDailySpend: number;
          avgActiveDaySpend: Maybe;
          leads: number;
          leadsPerDay: number;
          won: number;
          lost: number;
          open: number;
          cpl: Maybe;
          salesRate: Maybe;
          lostRate: Maybe;
          platformLeads: Maybe;
          platformCpl: Maybe;
          reportedDays: number;
          spendDays: number;
          calendarDays: number;
        }

        const div = (a: number, b: number): Maybe =>
          b > 0 && Number.isFinite(a / b) ? a / b : null;
        const pct = (a: number, b: number): Maybe => {
          const value = div(a, b);
          return value === null ? null : value * 100;
        };
        const factsFor = (data: FilteredData): Facts => ({
          data,
          archived: archivedCrmLeads(data),
          lost: authoritativeLostLeads(data),
          archivedWon: archivedWinCounter(data),
        });
        const aggregate = (
          facts: Facts,
          include: (date: string) => boolean,
          calendarDays: number,
        ): Metrics => {
          const ads = facts.data.ads.filter((row) => row.date && include(row.date));
          const crm = facts.data.crm.filter((row) => row.createdAt && include(row.createdAt));
          const archived = facts.archived.filter((row) => row.createdAt && include(row.createdAt));
          const lost = facts.lost.filter((row) => row.createdAt && include(row.createdAt));
          const spend = ads.reduce((total, row) => total + row.spend, 0);
          const leads = crm.length + archived.length;
          const won =
            crm.filter((row) => row.isWon).length +
            archived.filter((row) => facts.archivedWon(row)).length;
          const reportsPlatformLeads = ads.some((row) => row.platformLeads !== null);
          const reportsSpend = ads.length > 0;
          const platformLeads = reportsPlatformLeads
            ? ads.reduce((total, row) => total + (row.platformLeads ?? 0), 0)
            : null;
          const reportedDays = new Set(ads.map((row) => row.date)).size;
          const spendDays = new Set(ads.filter((row) => row.spend > 0).map((row) => row.date)).size;
          return {
            spend,
            avgDailySpend: spend / calendarDays,
            avgActiveDaySpend: div(spend, spendDays),
            leads,
            leadsPerDay: leads / calendarDays,
            won,
            lost: lost.length,
            open: Math.max(0, leads - won - lost.length),
            cpl: reportsSpend ? div(spend, leads) : null,
            salesRate: pct(won, leads),
            lostRate: lostAvailable ? pct(lost.length, leads) : null,
            platformLeads,
            platformCpl: platformLeads === null ? null : div(spend, platformLeads),
            reportedDays,
            spendDays,
            calendarDays,
          };
        };

        const mergeMetrics = (rows: Metrics[], calendarDays: number): Metrics => {
          const spend = rows.reduce((sum, row) => sum + row.spend, 0);
          const leads = rows.reduce((sum, row) => sum + row.leads, 0);
          const won = rows.reduce((sum, row) => sum + row.won, 0);
          const lost = rows.reduce((sum, row) => sum + row.lost, 0);
          const platformRows = rows.filter((row) => row.platformLeads !== null);
          const platformLeads = platformRows.length
            ? platformRows.reduce((sum, row) => sum + (row.platformLeads ?? 0), 0)
            : null;
          const spendDays = Math.max(0, ...rows.map((row) => row.spendDays));
          return {
            spend,
            avgDailySpend: spend / calendarDays,
            avgActiveDaySpend: div(spend, spendDays),
            leads,
            leadsPerDay: leads / calendarDays,
            won,
            lost,
            open: Math.max(0, leads - won - lost),
            cpl: div(spend, leads),
            salesRate: pct(won, leads),
            lostRate: lostAvailable ? pct(lost, leads) : null,
            platformLeads,
            platformCpl: platformLeads === null ? null : div(spend, platformLeads),
            reportedDays: Math.max(0, ...rows.map((row) => row.reportedDays)),
            spendDays,
            calendarDays,
          };
        };

        const rows = platformData.map(({ platform, data }) => {
          const facts = factsFor(data);
          const weekend = aggregate(facts, isWeekendDate, window.weekendDays);
          const comparison = aggregate(
            facts,
            (date) => utcWeekday(date) >= 0 && utcWeekday(date) <= 3,
            window.comparisonDays,
          );
          const hasSpendData = data.ads.length > 0;
          const decision = weekendBudgetDecision(weekend, comparison, {
            lostAvailable,
            hasSpendData,
          });
          const adDates = data.ads
            .map((row) => row.date)
            .filter(Boolean)
            .sort();
          return {
            platform,
            weekend,
            comparison,
            decision,
            cplDelta: ratioDelta(weekend.cpl, comparison.cpl),
            salesRateDelta: pointDelta(weekend.salesRate, comparison.salesRate),
            lostRateDelta: pointDelta(weekend.lostRate, comparison.lostRate),
            dailySpendDelta: ratioDelta(weekend.avgDailySpend, comparison.avgDailySpend),
            hasSpendData,
            dataFrom: adDates[0] ?? "",
            dataTo: adDates.at(-1) ?? "",
          };
        });

        const rank = <T extends { platform: Platform }>(
          values: T[],
          compare: (a: T, b: T) => number,
        ) =>
          new Map(
            [...values].sort(compare).map((row, index) => [row.platform, index + 1] as const),
          );
        const eligible = rows.filter(
          (row) =>
            row.weekend.leads >= 30 &&
            row.weekend.cpl !== null &&
            row.weekend.salesRate !== null &&
            row.weekend.lostRate !== null &&
            row.hasSpendData,
        );
        const efficiencyRanks = rank(
          eligible,
          (a, b) => (a.weekend.cpl ?? Infinity) - (b.weekend.cpl ?? Infinity),
        );
        const qualityRanks = rank(
          eligible,
          (a, b) =>
            (b.weekend.salesRate ?? -Infinity) - (a.weekend.salesRate ?? -Infinity) ||
            (a.weekend.lostRate ?? Infinity) - (b.weekend.lostRate ?? Infinity),
        );
        const ranked = rows
          .map((row) => ({
            ...row,
            efficiencyRank: efficiencyRanks.get(row.platform) ?? null,
            qualityRank: qualityRanks.get(row.platform) ?? null,
          }))
          .sort((a, b) => {
            const scoreA = (a.efficiencyRank ?? 99) + (a.qualityRank ?? 99);
            const scoreB = (b.efficiencyRank ?? 99) + (b.qualityRank ?? 99);
            return scoreA - scoreB;
          })
          .map((row, index) => ({
            ...row,
            overallRank: row.efficiencyRank === null ? null : index + 1,
          }));

        const dayRows = platformData.flatMap(({ platform, data }) => {
          const facts = factsFor(data);
          const dayKeys = {
            4: "thursday",
            5: "friday",
            6: "saturday",
          } as const;
          return ([4, 5, 6] as const).map((weekday) => ({
            platform,
            day: dayKeys[weekday],
            ...aggregate(facts, (date) => utcWeekday(date) === weekday, window.weeks),
          }));
        });

        const weekKeys = Array.from({ length: window.weeks }, (_, index) =>
          shiftIsoDate(window.from, index * 7),
        );
        const weekly = weekKeys.map((start) => {
          const point: Record<string, string | number | null> = { date: start };
          for (const { platform, data } of platformData) {
            const facts = factsFor(data);
            const metrics = aggregate(
              facts,
              (date) => isWeekendDate(date) && weekStart(date) === start,
              3,
            );
            point[`${platform}Cpl`] = metrics.cpl;
            point[`${platform}Leads`] = metrics.leads;
            point[`${platform}Spend`] = metrics.spend;
          }
          return point;
        });

        const portfolioWeekend = mergeMetrics(
          rows.map((row) => row.weekend),
          window.weekendDays,
        );
        const portfolioComparison = mergeMetrics(
          rows.map((row) => row.comparison),
          window.comparisonDays,
        );
        const bestPlatform = ranked.find((row) => row.overallRank !== null)?.platform ?? null;
        const reducePlatforms = ranked
          .filter((row) => row.decision === "reduce")
          .map((row) => row.platform);
        const selectivePlatforms = ranked
          .filter((row) => row.decision === "reallocate")
          .map((row) => row.platform);
        const insufficientPlatforms = ranked
          .filter((row) => row.decision === "insufficient")
          .map((row) => row.platform);
        const portfolioDecision = !lostAvailable
          ? "insufficient"
          : reducePlatforms.length > 0
            ? "reallocate"
            : selectivePlatforms.length > 0 || insufficientPlatforms.length > 0
              ? "selective"
              : "full";

        return json({
          window,
          platforms: ranked,
          dayRows,
          weekly,
          portfolio: {
            weekend: portfolioWeekend,
            comparison: portfolioComparison,
            cplDelta: ratioDelta(portfolioWeekend.cpl, portfolioComparison.cpl),
            salesRateDelta: pointDelta(portfolioWeekend.salesRate, portfolioComparison.salesRate),
            lostRateDelta: pointDelta(portfolioWeekend.lostRate, portfolioComparison.lostRate),
          },
          budgetPlan: {
            decision: portfolioDecision,
            bestPlatform,
            reducePlatforms,
            selectivePlatforms,
            insufficientPlatforms,
          },
          methodology: {
            weekendDays: ["thursday", "friday", "saturday"],
            comparisonDays: ["sunday", "monday", "tuesday", "wednesday"],
            leadDateBasis: "odoo_creation_date",
            lostSource: platformData[0]?.data.snapshot.health.lostAuthority ?? "unavailable",
            salesDefinition: "won_leads_divided_by_total_leads",
          },
          health: platformData[0]?.data.snapshot.health,
          appliedFilters: scope,
        });
      },
    },
  },
});
