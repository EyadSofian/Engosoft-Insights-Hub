import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/media-plan-leads")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { json } = await import("@/lib/api.server");
        const { loadMediaPlanSource } = await import("@/lib/media-plans.server");
        const { loadLeadCourseRecords } = await import("@/lib/lead-course-distribution.server");
        const { mediaPlanLeadMatch, linkedMediaPlanLeads, mediaPlanRecordMatches } =
          await import("@/lib/media-plan-lead-link");
        const { isLostOpportunity } = await import("@/lib/lead-course-distribution");
        const { emptyMediaPlanLifecycle } = await import("@/lib/media-plan-lifecycle");
        const params = new URL(request.url).searchParams;
        const month = params.get("month") || "";
        const key = params.get("key") || "";
        const stage = params.get("stage") || "";
        const bucket = params.get("bucket") || "";
        const opportunityLost = params.get("opportunityLost") === "1";
        const page = Number(params.get("page") || "1");
        if (
          !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
          !key ||
          key.length > 100 ||
          !Number.isInteger(page) ||
          page < 1 ||
          page > 10000 ||
          stage.length > 100 ||
          (stage !== "" && bucket !== "opportunity") ||
          (bucket !== "" && bucket !== "lead_active" && bucket !== "lead_lost" && bucket !== "lead_other" && bucket !== "opportunity") ||
          (opportunityLost && bucket !== "opportunity") ||
          (params.has("opportunityLost") && params.get("opportunityLost") !== "1")
        )
          return json({ error: "Invalid media plan lead request." }, 400);

        const source = await loadMediaPlanSource();
        const plan = source.plans[month];
        if (
          !plan ||
          !(
            plan.courses.some((row) => row.key === key) ||
            plan.additionalActivities.some((row) => row.key === key) ||
            key === "paid-media-leads"
          )
        )
          return json({ error: "Plan item not found." }, 404);

        const days = new Date(
          Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
        ).getUTCDate();
        const period = { from: `${month}-01`, to: `${month}-${String(days).padStart(2, "0")}` };
        const match = mediaPlanLeadMatch(plan, key);
        if (match === "unavailable")
          return json({
            match,
            total: 0,
            filteredTotal: 0,
            stages: {},
            lifecycle: emptyMediaPlanLifecycle(),
            rows: [],
            page,
            pageSize: 50,
            period,
          });

        try {
          const records = await loadLeadCourseRecords({
            from: period.from,
            to: period.to,
            company: params.get("company") || undefined,
          });
          const linked = linkedMediaPlanLeads(plan, key, records);
          const stages: Record<string, number> = {};
          for (const row of linked) {
            if (row.recordType === "opportunity") stages[row.stage] = (stages[row.stage] ?? 0) + 1;
          }
          const lifecycle = emptyMediaPlanLifecycle();
          for (const row of linked) {
            if (row.recordType === "opportunity") {
              lifecycle.opportunities++;
              if (isLostOpportunity(row.recordType, row.stage)) lifecycle.opportunityLost++;
            } else if (row.stage === "Lost") lifecycle.leadLost++;
            else if (row.stage === "Archived") lifecycle.leadOther++;
            else lifecycle.leadActive++;
          }
          const filtered = linked.filter((row) =>
            (!stage || row.stage === stage) &&
            mediaPlanRecordMatches(row, bucket || undefined, opportunityLost),
          ).sort(
            (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
          );
          const pageSize = 50;
          return json({
            match,
            total: linked.length,
            filteredTotal: filtered.length,
            stages,
            lifecycle,
            rows: filtered.slice((page - 1) * pageSize, page * pageSize),
            page,
            pageSize,
            period,
          });
        } catch (error) {
          return json(
            { error: error instanceof Error ? error.message : "Odoo CRM is unavailable." },
            503,
          );
        }
      },
    },
  },
});
