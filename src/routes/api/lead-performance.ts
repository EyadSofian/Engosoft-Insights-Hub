import { createFileRoute } from "@tanstack/react-router";
import type { PerformanceLead } from "@/lib/lead-performance";

export const Route = createFileRoute("/api/lead-performance")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { json } = await import("@/lib/api.server");
        const { loadAllData } = await import("@/lib/sheet-cache.server");
        const { readVerifiedYeastarLeadCalls, refreshRecentYeastarCdr, yeastarCdrCoverage } =
          await import("@/lib/yeastar-cdr.server");
        const { leadQaConfigured, readLeadQaVerifications } = await import("@/lib/lead-qa.server");
        const { acquisitionDatabaseConfigured, getPool, BUSINESS_TIME_ZONE } =
          await import("@/lib/acquisition-attribution.server");
        const { accountingUsdPaid, DEFAULT_FX_RATES } = await import("@/lib/fx-rates");
        const { isExcludedFromSalesRevenue } = await import("@/lib/sales-revenue-policy");
        const { buildLeadPerformance, sixCalendarMonths } = await import("@/lib/lead-performance");

        const url = new URL(request.url);
        const asOf = new Intl.DateTimeFormat("en-CA", {
          timeZone: BUSINESS_TIME_ZONE,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date());
        const months = sixCalendarMonths(asOf);
        const firstDay = `${months[0]}-01`;
        const snapshot = await loadAllData();
        const sourceSync = (key: string) =>
          snapshot.tabSyncs.find((item) => item.key === key)?.syncedAt ?? "";
        const isFresh = (syncedAt: string) => {
          const age = Date.now() - Date.parse(syncedAt);
          return Number.isFinite(age) && age >= 0 && age <= 48 * 60 * 60 * 1000;
        };
        const crmSyncedAt = sourceSync("crm");
        // A month-to-date zero from a stale snapshot is not a business result.
        if (!isFresh(crmSyncedAt)) return json({ error: "CRM_STALE", crmSyncedAt }, 503);
        const lostSyncedAt = sourceSync("lost");
        const accountingSyncedAt = sourceSync("accounting");
        const lostAvailable =
          snapshot.health.lostAuthority !== "unavailable" && isFresh(lostSyncedAt);
        const accountingAvailable = isFresh(accountingSyncedAt);
        // Lost rows are a disjoint part of the acquisition denominator; omitting
        // them would understate both entries and loss rate, not merely one card.
        if (!lostAvailable) return json({ error: "LOST_STALE", lostSyncedAt }, 503);
        const leads: PerformanceLead[] = [
          ...snapshot.crm.map((row) => ({
            id: row.id,
            createdAt: row.createdAt,
            createdAtUtc: row.createdAtUtc,
            recordType: row.recordType,
            status: row.businessStatus,
            source: row.source,
            leadSegment: row.leadSegment,
            course: row.course,
            campaign: row.campaignName,
            salesperson: row.salesperson,
            phone: row.phone,
            mobile: row.mobile,
            email: row.email,
            lossReason: row.lossReason,
          })),
          ...snapshot.lost.map((row) => ({
            id: row.id,
            createdAt: row.createdAt,
            createdAtUtc: row.createdAtUtc,
            recordType: row.recordType,
            status: row.businessStatus,
            source: row.source,
            leadSegment: row.leadSegment,
            course: row.course,
            campaign: row.campaignName,
            salesperson: row.salesperson,
            phone: row.phone,
            mobile: row.mobile,
            email: row.email,
            lossReason: row.lossReason,
          })),
        ];

        const linksPromise = acquisitionDatabaseConfigured()
          ? getPool()
              .query<{
                sale_order_name: string;
                opportunity_id: string;
                refreshed_at: Date | string | null;
              }>(
                `SELECT sale_order_name, opportunity_id, max(refreshed_at) OVER () AS refreshed_at
                 FROM crm_sale_order_links`,
              )
              .then((result) => ({
                available:
                  result.rows.length > 0 && isFresh(String(result.rows[0]?.refreshed_at ?? "")),
                refreshedAt: result.rows[0]?.refreshed_at ?? null,
                rows: result.rows.map((row) => ({
                  orderName: row.sale_order_name,
                  opportunityId: String(row.opportunity_id),
                })),
              }))
              .catch(() => ({
                available: false,
                refreshedAt: null,
                rows: [] as { orderName: string; opportunityId: string }[],
              }))
          : Promise.resolve({
              available: false,
              refreshedAt: null,
              rows: [] as { orderName: string; opportunityId: string }[],
            });
        const callRefreshPromise = refreshRecentYeastarCdr(asOf)
          .then(() => true)
          .catch(() => false);
        const callsPromise = callRefreshPromise
          .then(() => readVerifiedYeastarLeadCalls(firstDay, asOf))
          .then((rows) =>
            rows.map((row) => ({
              phone: row.phone,
              day: row.callDate,
              totalCalls: row.totalCalls,
              firstCallAt: row.firstCallAt,
            })),
          )
          .catch(() => null);
        const callCoveragePromise = callRefreshPromise
          .then(() => yeastarCdrCoverage(firstDay, asOf))
          .catch(() => null);
        const qaPromise = leadQaConfigured()
          ? readLeadQaVerifications(
              leads.filter((row) => row.createdAt >= firstDay).map((row) => row.id),
            )
              .then((map) =>
                [...map.values()].map((row) => ({
                  id: row.crmLeadId,
                  verdict: row.leadQualityVerdict,
                  reason: row.reason,
                })),
              )
              .catch(() => null)
          : Promise.resolve(null);
        const [links, calls, qa, callCoverage, callRefreshSucceeded] = await Promise.all([
          linksPromise,
          callsPromise,
          qaPromise,
          callCoveragePromise,
          callRefreshPromise,
        ]);

        const invoices = snapshot.accounting
          .filter((row) => !isExcludedFromSalesRevenue(row))
          .map((row) => ({
            orderRef: row.orderRef,
            // Credit-note reversals belong to their invoice date, not the original payment date.
            date: row.isCreditNote ? row.invoiceDate || row.paymentDate : row.paymentDate,
            usdPaid: accountingUsdPaid(row, DEFAULT_FX_RATES),
            salesperson: row.salesperson,
          }));
        const result = buildLeadPerformance({
          leads,
          invoices,
          links: links.rows,
          calls,
          qa,
          asOf,
          selectedMonth: url.searchParams.get("month") ?? undefined,
          course: url.searchParams.get("course") ?? undefined,
          linksAvailable: links.available,
        });
        // This is a separate payment-month view, not an entry-cohort conversion
        // numerator. A paid invoice can belong to an older lead or lack an
        // opportunity link altogether; never silently make it disappear.
        const collectionsByMonth = months.map((month) => {
          const paidLines = snapshot.accounting.filter(
            (row) =>
              !row.isCreditNote &&
              !isExcludedFromSalesRevenue(row) &&
              row.paymentDate.slice(0, 7) === month &&
              row.paymentDate.slice(0, 10) <= asOf,
          );
          return {
            month,
            paidInvoices: new Set(paidLines.map((row) => row.movement).filter(Boolean)).size,
            paidUsd:
              Math.round(
                paidLines.reduce((sum, row) => sum + accountingUsdPaid(row, DEFAULT_FX_RATES), 0) *
                  100,
              ) / 100,
          };
        });
        return json({
          ...result,
          collectionsByMonth,
          callCoverage,
          source: {
            crm: "Odoo CRM (creation date; current status)",
            payments: "Paid Accounting lines + exact sale.order.opportunity_id link",
            calls:
              "Yeastar PBX direct CDR API (unique outbound call ID; full-day coverage required)",
            qa: "Manual lead QA + canonical Odoo loss reason",
          },
          availability: {
            crm: true,
            lost: lostAvailable,
            accounting: accountingAvailable,
            callRefreshSucceeded,
            crmSyncedAt,
            lostSyncedAt,
            accountingSyncedAt,
          },
          linksRefreshedAt: links.refreshedAt,
          syncedAt: snapshot.syncedAt,
          health: snapshot.health,
        });
      },
    },
  },
});
