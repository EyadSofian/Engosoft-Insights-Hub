import { createFileRoute } from "@tanstack/react-router";
import type { LeadLifecycleBucket } from "@/lib/lead-course-distribution";

export const Route = createFileRoute("/api/lead-course-distribution")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { parseFilters, json } = await import("@/lib/api.server");
        const { leadCourseDistribution } = await import("@/lib/lead-course-distribution.server");
        const params = new URL(request.url).searchParams;
        const dimension = params.get("dimension");
        const validDimension =
          dimension === "course" || dimension === "specialty" ? dimension : null;
        const label = params.get("label") || "";
        const page = Number(params.get("page") || 1);
        const bucket = params.get("bucket");
        const validBuckets: LeadLifecycleBucket[] = [
          "lead_active",
          "lead_lost",
          "lead_other",
          "opportunity",
        ];
        if (dimension && dimension !== "course" && dimension !== "specialty")
          return json({ error: "Invalid dimension." }, 400);
        if (dimension && (!label || label.length > 200))
          return json({ error: "Invalid group." }, 400);
        if (!Number.isInteger(page) || page < 1 || page > 10000)
          return json({ error: "Invalid page." }, 400);
        if (bucket && !validBuckets.includes(bucket as LeadLifecycleBucket))
          return json({ error: "Invalid lifecycle bucket." }, 400);
        if (params.has("stage") && bucket !== "opportunity")
          return json({ error: "A stage must belong to an opportunity." }, 400);
        const filters = await parseFilters(request);
        try {
          return json(
            await leadCourseDistribution(
              filters,
              validDimension && label
                ? {
                    dimension: validDimension,
                    label,
                    bucket: (bucket as LeadLifecycleBucket) || undefined,
                    stage: params.get("stage") || undefined,
                    page,
                  }
                : undefined,
            ),
          );
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
