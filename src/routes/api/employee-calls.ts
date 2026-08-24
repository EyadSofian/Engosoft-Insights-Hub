import { createFileRoute } from "@tanstack/react-router";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const Route = createFileRoute("/api/employee-calls")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { parseFilters, json } = await import("@/lib/api.server");
        const { getCallsHubEmployeeCalls } = await import("@/lib/calls-hub.server");
        const url = new URL(request.url);
        const extension = (url.searchParams.get("extension") || "").trim();
        if (!/^\d{1,16}$/.test(extension)) {
          return Response.json({ error: "A valid employee extension is required" }, { status: 400 });
        }
        const filters = await parseFilters(request);
        if (!filters.from || !filters.to || !datePattern.test(filters.from) || !datePattern.test(filters.to)) {
          return Response.json({ error: "A valid date range is required" }, { status: 400 });
        }
        const page = Math.max(1, Number(url.searchParams.get("page") || 1));
        const pageSize = Math.max(1, Math.min(50, Number(url.searchParams.get("page_size") || 20)));
        try {
          return json(
            await getCallsHubEmployeeCalls({
              extension,
              from: filters.from,
              to: filters.to,
              page,
              pageSize,
              playableFirst: true,
            }),
          );
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Employee call records are temporarily unavailable",
            },
            { status: 503 },
          );
        }
      },
    },
  },
});
