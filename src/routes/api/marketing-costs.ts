import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/marketing-costs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { parseFilters, json } = await import("@/lib/api.server");
        const { marketingCostsReport } = await import("@/lib/marketing-costs.server");
        try {
          const report = await marketingCostsReport(await parseFilters(request));
          const detailed = new URL(request.url).searchParams.get("compact") !== "1";
          return json({
            ...report,
            whatsapp: {
              ...report.whatsapp,
              records: detailed ? report.whatsapp.records : [],
              campaigns: detailed ? report.whatsapp.campaigns : [],
            },
          });
        } catch {
          return json(
            { error: "Marketing and WhatsApp source reads could not be completed. Please retry." },
            503,
          );
        }
      },
    },
  },
});
