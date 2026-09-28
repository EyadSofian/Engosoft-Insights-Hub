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
        const latestYear = all.years.at(-1) ?? Number(todayParts.year);
        const year = all.years.includes(yearParam) ? yearParam : latestYear;
        const month =
          Number.isInteger(monthParam) && monthParam >= 1 && monthParam <= 12
            ? monthParam
            : year === Number(todayParts.year)
              ? Number(todayParts.month)
              : 12;
        const safeMonth =
          year === Number(todayParts.year) ? Math.min(month, Number(todayParts.month)) : month;
        const annual = buildAnnualComparison(
          all,
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
          years: all.years,
          rowsPerYear: all.years.map((y) => ({
            year: y,
            ads: all.ads.filter((a) => a.date.startsWith(String(y))).length,
            crm: all.crm.filter((c) => c.createdAt.startsWith(String(y))).length,
            accounting: all.accounting.filter((row) =>
              accountingReportingDate(row, "payment").startsWith(String(y)),
            ).length,
          })),
          health: all.health,
        });
      },
    },
  },
});
