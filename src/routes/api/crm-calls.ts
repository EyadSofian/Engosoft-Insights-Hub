import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/crm-calls")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { parseFilters, json } = await import("@/lib/api.server");
        const { getCallsHubSummary } = await import("@/lib/calls-hub.server");
        const filters = await parseFilters(request);
        if (!filters.from || !filters.to) {
          return Response.json({ error: "A valid date range is required" }, { status: 400 });
        }

        try {
          const summary = await getCallsHubSummary(filters.from, filters.to);
          const totals = summary.employees.reduce(
            (acc, employee) => {
              acc.calls += employee.totalCalls;
              acc.answered += employee.answeredCalls;
              acc.analyzed += employee.analyzedCalls;
              acc.needsReview += employee.needsReview;
              acc.talkSeconds += employee.periodTalkSeconds;
              if (employee.averageScore !== null && employee.analyzedCalls > 0) {
                acc.scoreTotal += employee.averageScore * employee.analyzedCalls;
                acc.scoreSample += employee.analyzedCalls;
              }
              return acc;
            },
            {
              calls: 0,
              answered: 0,
              analyzed: 0,
              needsReview: 0,
              talkSeconds: 0,
              scoreTotal: 0,
              scoreSample: 0,
            },
          );

          return json({
            available: true,
            source: summary.source,
            fetchedAt: summary.fetchedAt,
            totals: {
              calls: totals.calls,
              answered: totals.answered,
              answerRate: totals.calls > 0 ? (totals.answered / totals.calls) * 100 : null,
              analyzed: totals.analyzed,
              needsReview: totals.needsReview,
              talkSeconds: totals.talkSeconds,
              averageScore: totals.scoreSample > 0 ? totals.scoreTotal / totals.scoreSample : null,
            },
            topEmployees: [...summary.employees]
              .sort((a, b) => b.totalCalls - a.totalCalls)
              .slice(0, 5),
          });
        } catch (error) {
          return json({
            available: false,
            error: error instanceof Error ? error.message : "Calls Hub is unavailable",
          });
        }
      },
    },
  },
});
