import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/daily-updates")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { parseFilters, json } = await import("@/lib/api.server");
        const { dailyUpdatesReport } = await import("@/lib/daily-updates.server");
        try {
          return json(
            await dailyUpdatesReport(
              await parseFilters(request),
              new URL(request.url).searchParams.get("day") || undefined,
            ),
          );
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error && error.message === "INVALID_DAY"
                  ? "Invalid day; choose a past or current Cairo date."
                  : "Daily source reads could not be completed.",
            },
            error instanceof Error && error.message === "INVALID_DAY" ? 400 : 503,
          );
        }
      },
    },
  },
});
