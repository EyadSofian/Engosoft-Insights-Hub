import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/courses")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const {
          authoritativeLostLeads,
          computeCourses,
          computeTotals,
          getFiltered,
          isPreviousComparable,
          previousPeriod,
        } = await import("@/lib/metrics.server");
        const { parseFilters, json } = await import("@/lib/api.server");
        const { buildCourseDrill } = await import("@/lib/course-intelligence.server");
        const { buildCourseLeadLossReport } = await import("@/lib/course-lead-loss");

        const filters = await parseFilters(request);
        const organicScope = filters.channel === "organic";
        const data = await getFiltered(filters);
        const prevRange = previousPeriod(filters.from, filters.to);
        // No prior-period revenue delta when that window predates the data.
        const prevComparable = await isPreviousComparable(prevRange);
        // CRM cohort comparison remains useful even when the accounting source
        // predates the comparison window. Only revenue delta is gated by the
        // accounting comparability check.
        const prevData = prevRange ? await getFiltered({ ...filters, ...prevRange }) : null;

        const courses = computeCourses(data, prevComparable ? (prevData ?? undefined) : undefined);
        const courseLeadLoss = buildCourseLeadLossReport({
          active: data.crm,
          lost: data.lost,
          previousActive: prevData?.crm,
          previousLost: prevData?.lost,
          currentRange: { from: filters.from ?? "", to: filters.to ?? "" },
          previousRange: prevRange,
        });
        const params = new URL(request.url).searchParams;
        const detail = params.get("detail")?.trim() ?? "";

        // The drill-down lives in src/lib/course-intelligence.server.ts so the
        // agent contract and this page compute it with the same code. See the
        // module header for why.
        const drill = detail ? buildCourseDrill(data, detail, filters, organicScope) : null;
        const sellerRanking =
          detail && params.get("sellerRanking") === "1"
            ? await (async () => {
                const { buildCourseSellerRanking } = await import("@/lib/course-seller-ranking");
                const fresh = (key: string) => {
                  const age =
                    Date.now() -
                    Date.parse(
                      data.snapshot.tabSyncs.find((item) => item.key === key)?.syncedAt ?? "",
                    );
                  return age >= 0 && age < 48 * 60 * 60 * 1000;
                };
                return buildCourseSellerRanking({
                  course: detail,
                  crm: data.crm,
                  lost: authoritativeLostLeads(data),
                  orders: data.invoiced,
                  collections: data.accounting,
                  availability: {
                    // The company dimension only exists on the collections feed here.
                    crm:
                      !filters.company &&
                      fresh("crm") &&
                      fresh("lost") &&
                      data.snapshot.health.lostAuthority !== "unavailable",
                    orders: !filters.company && fresh("invoiced"),
                    collections: fresh("accounting"),
                  },
                });
              })()
            : null;

        return json({
          courses,
          courseLeadLoss,
          totals: computeTotals(data),
          drill,
          sellerRanking,
          prevRange,
          prevComparable,
          health: data.snapshot.health,
          appliedFilters: filters,
        });
      },
    },
  },
});
