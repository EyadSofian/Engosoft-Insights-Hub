import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/media-plan-leads")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { json } = await import("@/lib/api.server");
        const { loadMediaPlanSource } = await import("@/lib/media-plans.server");
        const { loadLeadCourseRecords } = await import("@/lib/lead-course-distribution.server");
        const { mediaPlanLeadMatch, linkedMediaPlanLeads } =
          await import("@/lib/media-plan-lead-link");
        const params = new URL(request.url).searchParams;
        const month = params.get("month") || "";
        const key = params.get("key") || "";
        const stage = params.get("stage") || "";
        const page = Number(params.get("page") || "1");
        if (
          !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
          !key ||
          key.length > 100 ||
          !Number.isInteger(page) ||
          page < 1 ||
          page > 10000 ||
          stage.length > 100
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
          for (const row of linked) stages[row.stage] = (stages[row.stage] ?? 0) + 1;
          const filtered = (stage ? linked.filter((row) => row.stage === stage) : linked).sort(
            (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
          );
          const pageSize = 50;
          return json({
            match,
            total: linked.length,
            filteredTotal: filtered.length,
            stages,
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
