import { createFileRoute } from "@tanstack/react-router";

/**
 * One course, everything an agent needs to reason about it, nothing it does not.
 *
 * WHY THIS EXISTS. ENGO Nexus was answering course questions from
 * `/api/overview?course=PMP` — flat totals, no campaigns. Asked which PMP
 * campaign performed best it had nothing to work with, while `/courses` was
 * showing seven real campaigns for the same month. The alternative to this
 * endpoint was the agent pulling the full `/api/courses?detail=PMP` payload,
 * which carries the whole course table, per-salesperson and per-team
 * breakdowns and the raw campaign lead groups the dashboard needs for its
 * charts and the agent never reads.
 *
 * Every figure here comes from `buildCourseDrill` — the same function
 * `/api/courses` calls — so this endpoint cannot drift from the dashboard
 * without the dashboard changing too.
 *
 * Failure semantics are explicit and distinct. "No campaigns ran" is not the
 * same fact as "the course does not exist", and neither is "the Hub was
 * unreachable"; collapsing all three into "unavailable" is what made the agent
 * report missing data that was on the screen.
 */
export const Route = createFileRoute("/api/agent-course-intelligence")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered } = await import("@/lib/metrics.server");
        const { parseFilters, json } = await import("@/lib/api.server");
        const { buildCourseDrill, buildCourseVariants, buildCampaignProductMix } =
          await import("@/lib/course-intelligence.server");
        const { normalizeName } = await import("@/lib/sheet-cache.server");

        const url = new URL(request.url);
        const course = (url.searchParams.get("course") ?? "").trim();
        if (!course) {
          return Response.json(
            {
              status: "BAD_REQUEST",
              error: "`course` is required, e.g. ?course=PMP.",
            },
            { status: 400 },
          );
        }

        const includeVariants = url.searchParams.get("variants") !== "false";
        const includeMix = url.searchParams.get("productMix") !== "false";

        const filters = await parseFilters(request);
        const organicScope = filters.channel === "organic";
        const data = await getFiltered(filters);

        // The course vocabulary is the Hub's own, never the agent's. An unknown
        // course is a distinct answer from a course that simply had no activity
        // in the window, and the two must not collapse into one.
        const knownNames = new Set<string>();
        for (const row of data.snapshot.crm) {
          if (row.course) knownNames.add(row.course);
        }
        for (const row of data.snapshot.accounting) {
          if (row.course) knownNames.add(row.course);
        }
        const known = new Set([...knownNames].map((n) => normalizeName(n)));
        const drill = buildCourseDrill(data, course, filters, organicScope);
        const summaryRows = [...drill.activeCampaigns, ...drill.previousCampaigns];

        if (summaryRows.length === 0 && known.size > 0 && !known.has(normalizeName(course))) {
          return json({
            status: "UNKNOWN_COURSE",
            course,
            period: { from: filters.from, to: filters.to },
            knownCourses: [...knownNames].sort().slice(0, 40),
          });
        }

        const sum = (pick: (row: (typeof summaryRows)[number]) => number) =>
          summaryRows.reduce((total, row) => total + pick(row), 0);
        const spend = sum((row) => row.spend);
        const revenue = sum((row) => row.revenue);
        const crmLeads = sum((row) => row.crmLeads);
        const won = sum((row) => row.won);
        const platformLeads = summaryRows.some((row) => row.platformLeads !== null)
          ? sum((row) => row.platformLeads ?? 0)
          : null;

        const variants = includeVariants ? buildCourseVariants(data, course) : [];
        const productMix = includeMix ? buildCampaignProductMix(data, course) : [];

        return json({
          status: summaryRows.length === 0 ? "NO_ACTIVITY" : "OK",
          course,
          period: { from: filters.from, to: filters.to },
          summary: {
            spend,
            platformLeads,
            crmLeads,
            lost: sum((row) => row.lost),
            won,
            salesOrders: sum((row) => row.salesOrders),
            invoices: sum((row) => row.invoices),
            revenue,
            // Null, not zero, when the denominator is missing — a rate over no
            // leads is not "0%".
            conversionRate: crmLeads > 0 ? (won / crmLeads) * 100 : null,
            cpl: crmLeads > 0 ? spend / crmLeads : null,
            roas: spend > 0 ? revenue / spend : null,
          },
          activeCampaigns: drill.activeCampaigns,
          previousCampaigns: drill.previousCampaigns,
          monthly: drill.monthly,
          variants,
          campaignProductMix: productMix,
          dataQuality: {
            attribution: drill.attribution,
            // Which campaigns carry a weak course match, named individually.
            lowConfidenceCampaigns: summaryRows
              .filter((row) => row.attributionConfidence < 1)
              .map((row) => ({
                name: row.name,
                confidence: row.attributionConfidence,
                sources: row.attributionSources,
              })),
            unresolvedVariants: variants.filter((variant) => variant.resolutionStatus === "raw")
              .length,
            variantRoas: "NOT_MEASURABLE",
            latestWindow: drill.latestWindow,
            health: data.snapshot.health,
            appliedFilters: filters,
          },
        });
      },
    },
  },
});
