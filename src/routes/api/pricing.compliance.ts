import { createFileRoute } from "@tanstack/react-router";

/**
 * KPI cards and the detail table for the compliance tab.
 *
 * Everything is aggregated in PostgreSQL and the detail rows are paginated, so
 * opening the tab costs a handful of indexed queries rather than a download of
 * every audited line. It reads stored verdicts only; nothing here runs an audit
 * or calls Odoo.
 */
export const Route = createFileRoute("/api/pricing/compliance")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { json, authState, auditQuery } = await import("@/lib/pricing/pricing-api.server");
        const { complianceSnapshot, complianceRows } =
          await import("@/lib/pricing/compliance.server");

        const query = auditQuery(request);
        const includeRows = new URL(request.url).searchParams.get("rows") !== "0";
        const [snapshot, detail] = await Promise.all([
          complianceSnapshot({ ...query, limit: undefined, offset: undefined }),
          includeRows ? complianceRows(query) : Promise.resolve({ rows: [], total: 0, error: "" }),
        ]);

        const totals = snapshot.totals;
        const ratio = (top?: number, bottom?: number): number | null =>
          bottom && bottom > 0 ? (top ?? 0) / bottom : null;

        return json({
          configured: snapshot.configured,
          book: snapshot.book,
          auth: authState(request),
          kpis: {
            auditedLines: totals.audited ?? 0,
            eligibleLines: totals.eligible ?? 0,
            matchedLines: totals.matched ?? 0,
            coverage: ratio(totals.matched, totals.eligible),
            // Judged lines only. A line nobody could match is neither kept nor
            // broken, and counting it as a failure would punish a data gap.
            complianceRate: ratio(totals.compliant, totals.matched),
            belowMinimumLines: totals.below_minimum ?? 0,
            belowMinimumValue: totals.leakage ?? 0,
            unmatchedLines: totals.unmatched ?? 0,
            unknownPaymentLines: totals.unknown_payment ?? 0,
            mixedPaymentLines: totals.mixed_payment ?? 0,
            aboveListLines: totals.above_list ?? 0,
            needsReviewLines: totals.needs_review ?? 0,
            criticalLines: totals.critical ?? 0,
            excludedLines: totals.excluded ?? 0,
          },
          byStatus: snapshot.byStatus,
          bySalesperson: snapshot.bySalesperson,
          byCurrency: snapshot.byCurrency,
          rows: detail.rows,
          total: detail.total,
          page: { limit: query.limit, offset: query.offset },
          freshness: snapshot.freshness,
          state: snapshot.state,
          error: snapshot.error || detail.error,
        });
      },
    },
  },
});
