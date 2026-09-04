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
        const { getFiltered, computeCourses } = await import("@/lib/metrics.server");
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

        /**
         * The summary is the COURSE, not the sum of its campaigns.
         *
         * These are different numbers and both are real. For PMP in August the
         * course card reads $24,189 collected across 130 invoices; its
         * campaigns account for $11,117 of that. The rest is revenue no
         * campaign can claim — organic, direct, repeat. Reporting the campaign
         * sum as "PMP revenue" would have the agent contradicting the figure on
         * the user's screen, which is the whole class of failure this endpoint
         * exists to end. So the card is `summary`, the campaign sum is
         * `attributed`, and the gap between them is stated rather than hidden.
         */
        const courseRow = computeCourses(data).find(
          (row: { course?: string }) => normalizeName(row.course ?? "") === normalizeName(course),
        ) as Record<string, unknown> | undefined;

        const numberOf = (key: string): number =>
          typeof courseRow?.[key] === "number" ? (courseRow[key] as number) : 0;
        const nullableOf = (key: string): number | null =>
          typeof courseRow?.[key] === "number" ? (courseRow[key] as number) : null;

        const sum = (pick: (row: (typeof summaryRows)[number]) => number) =>
          summaryRows.reduce((total, row) => total + pick(row), 0);
        const attributedSpend = sum((row) => row.spend);
        const attributedRevenue = sum((row) => row.revenue);

        const spend = numberOf("spend");
        const revenue = numberOf("revenue");
        const crmLeads = numberOf("crmLeads");
        const won = numberOf("won");
        const platformLeads = nullableOf("platformLeads");

        const variants = includeVariants ? buildCourseVariants(data, course) : [];
        const productMix = includeMix ? buildCampaignProductMix(data, course) : [];

        return json({
          status: summaryRows.length === 0 ? "NO_ACTIVITY" : "OK",
          course,
          period: { from: filters.from, to: filters.to },
          /** The course as the /courses table shows it. Quote these figures. */
          summary: {
            spend,
            platformLeads,
            crmLeads,
            lost: numberOf("lost"),
            won,
            salesOrders: numberOf("salesOrders"),
            invoices: numberOf("invoices"),
            revenue,
            // Null, not zero, when the denominator is missing — a rate over no
            // leads is not "0%".
            conversionRate: crmLeads > 0 ? (won / crmLeads) * 100 : null,
            cpl: crmLeads > 0 ? spend / crmLeads : null,
            roas: spend > 0 ? revenue / spend : null,
          },
          /**
           * Only the part the campaigns explain. Use this — never `summary` —
           * when judging advertising return, and say so when the two differ.
           */
          attributed: {
            spend: attributedSpend,
            revenue: attributedRevenue,
            crmLeads: sum((row) => row.crmLeads),
            won: sum((row) => row.won),
            invoices: sum((row) => row.invoices),
            salesOrders: sum((row) => row.salesOrders),
            roas: attributedSpend > 0 ? attributedRevenue / attributedSpend : null,
            /** Revenue the campaigns cannot account for. */
            unattributedRevenue: revenue - attributedRevenue,
            unattributedRevenueShare: revenue > 0 ? (revenue - attributedRevenue) / revenue : null,
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
