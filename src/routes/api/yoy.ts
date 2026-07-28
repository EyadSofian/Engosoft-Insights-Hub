import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/yoy")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { computeYoy } = await import("@/lib/metrics.server");
        const { loadAllData } = await import("@/lib/sheet-cache.server");
        const { json } = await import("@/lib/api.server");

        const yearParam = new URL(request.url).searchParams.get("year");
        const year = yearParam ? Number(yearParam) : undefined;
        const [result, all] = await Promise.all([
          computeYoy(Number.isFinite(year) ? year : undefined),
          loadAllData(),
        ]);

        return json({
          ...result,
          years: all.years,
          rowsPerYear: all.years.map((y) => ({
            year: y,
            ads: all.ads.filter((a) => a.date.startsWith(String(y))).length,
            crm: all.crm.filter((c) => c.createdAt.startsWith(String(y))).length,
            accounting: all.accounting.filter((row) =>
              row.paymentDate.startsWith(String(y)),
            ).length,
          })),
          health: all.health,
        });
      },
    },
  },
});
