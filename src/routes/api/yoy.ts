import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/yoy")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { attributedAdCourse } = await import("@/lib/metrics.server");
        const { loadAllData } = await import("@/lib/sheet-cache.server");
        const { annualAsYoyResult, buildAnnualComparison } = await import("@/lib/yearly-analysis");
        const { json } = await import("@/lib/api.server");
        const { accountingReportingDate } = await import("@/lib/accounting-policy");
        const { isExcludedFromSalesRevenue } = await import("@/lib/sales-revenue-policy");
        const { historicalCrm } = await import("@/lib/yearly-crm-history.server");

        const query = new URL(request.url).searchParams;
        const yearParam = Number(query.get("year"));
        const monthParam = Number(query.get("month"));
        const todayParts = Object.fromEntries(
          new Intl.DateTimeFormat("en-CA", {
            timeZone: "Africa/Cairo",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          })
            .formatToParts(new Date())
            .map((part) => [part.type, part.value]),
        );
        const today = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
        const all = await loadAllData();
        const years = [...new Set([...all.years, 2024, 2025])].sort((a, b) => a - b);
        const latestYear = years.at(-1) ?? Number(todayParts.year);
        const year = years.includes(yearParam) ? yearParam : latestYear;
        const month =
          Number.isInteger(monthParam) && monthParam >= 1 && monthParam <= 12
            ? monthParam
            : year === Number(todayParts.year)
              ? Number(todayParts.month)
              : 12;
        const safeMonth =
          year === Number(todayParts.year) ? Math.min(month, Number(todayParts.month)) : month;
        const historicalYears = [year, year - 1].filter(
          (candidate): candidate is 2024 | 2025 => candidate === 2024 || candidate === 2025,
        );
        const history = await Promise.all(historicalYears.map(historicalCrm));
        const annual = buildAnnualComparison(
          {
            ...all,
            historicalCrm: history.flatMap((source) => source.rows),
            historicalReadyYears: history
              .filter((source) => source.status === "ready")
              .map((source) => source.year),
          },
          year,
          safeMonth,
          today,
          (ad) => attributedAdCourse(ad, all).course,
        );

        return json({
          ...annualAsYoyResult(annual),
          annual,
          sourceDates: {
            ads: all.adsDateMax,
            crm: all.crmDateMax,
            revenue: all.revenueDateMax,
          },
          today,
          years,
          history: history.map(({ year: historyYear, status, syncedAt, error, rows }) => ({
            year: historyYear,
            status,
            syncedAt,
            error,
            leads: rows.reduce((total, row) => total + row.leads, 0),
            inventoryLeads: rows.reduce((total, row) => total + row.inventoryLeads, 0),
          })),
          rowsPerYear: years.map((y) => ({
            year: y,
            ads: all.ads.filter((a) => a.date.startsWith(String(y))).length,
            crm: history.some((source) => source.year === y && source.status === "ready")
              ? history
                  .filter((source) => source.year === y)
                  .flatMap((source) => source.rows)
                  .reduce((total, row) => total + row.leads, 0)
              : all.crm.filter((c) => c.createdAt.startsWith(String(y))).length,
            accounting: all.accounting.filter(
              (row) =>
                !isExcludedFromSalesRevenue(row) &&
                accountingReportingDate(row, "payment").startsWith(String(y)),
            ).length,
          })),
          health: all.health,
        });
      },
    },
  },
});
