import { createFileRoute } from "@tanstack/react-router";

/**
 * The alerts tab, and the list of rows waiting to be linked.
 *
 * Alerts are ordered by what somebody can act on: a large discount below a
 * published floor first, then a small one, then the cases where the data itself
 * needs attention, then sales above list, which are informational only.
 */
export const Route = createFileRoute("/api/pricing/exceptions")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { json, authState, auditQuery } = await import("@/lib/pricing/pricing-api.server");
        const { pricingAlerts } = await import("@/lib/pricing/compliance.server");
        const { currentPublishedBook, queryPriceItems, pricingDatabaseConfigured } =
          await import("@/lib/pricing/pricing-db.server");

        const query = auditQuery(request);
        const alerts = await pricingAlerts(query);

        let unlinked: { total: number; items: unknown[] } = { total: 0, items: [] };
        if (pricingDatabaseConfigured()) {
          try {
            const book = await currentPublishedBook();
            if (book) {
              const result = await queryPriceItems({
                bookId: book.id,
                unmappedOnly: true,
                limit: 100,
              });
              unlinked = { total: result.total, items: result.items };
            }
          } catch {
            // The alert list is the point of this endpoint; a failure to also
            // list unlinked rows must not empty it.
          }
        }

        const bySeverity = alerts.rows.reduce<Record<string, number>>((counts, row) => {
          counts[row.severity] = (counts[row.severity] ?? 0) + 1;
          return counts;
        }, {});

        return json({
          configured: pricingDatabaseConfigured(),
          auth: authState(request),
          alerts: alerts.rows,
          total: alerts.total,
          bySeverity,
          unlinked,
          error: alerts.error,
        });
      },
    },
  },
});
