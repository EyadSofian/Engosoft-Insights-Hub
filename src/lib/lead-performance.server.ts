/**
 * Loading the six-month lead-to-paid report, in one place.
 *
 * The page endpoint and the workbook export both need the same report, and the
 * evidence behind it is assembled from five systems — Odoo CRM and Lost, the
 * paid Accounting lines, the exact `sale.order.opportunity_id` links, Yeastar
 * CDRs and the manual lead-QA verdicts. Building that twice is how a report
 * and its own export end up disagreeing about a conversion rate in a meeting,
 * so both call this.
 *
 * Staleness is decided here too, and it refuses rather than degrades: a
 * month-to-date zero out of a stale CRM snapshot is not a business result, and
 * a missing Lost population understates the denominator of every rate on the
 * page, not just one card.
 */
import type { PerformanceLead, PerformanceResult } from "./lead-performance";

export interface LeadPerformanceAvailability {
  crm: boolean;
  lost: boolean;
  accounting: boolean;
  callRefreshSucceeded: boolean;
  crmSyncedAt: string;
  lostSyncedAt: string;
  accountingSyncedAt: string;
}

export interface LeadPerformanceReport {
  result: PerformanceResult;
  collectionsByMonth: { month: string; paidInvoices: number; paidUsd: number }[];
  callCoverage: { expectedDays: number; coveredDays: number; newestSync: string | null } | null;
  availability: LeadPerformanceAvailability;
  linksRefreshedAt: Date | string | null;
  syncedAt: string;
  health: unknown;
  asOf: string;
}

export interface LeadPerformanceRefusal {
  error: "CRM_STALE" | "LOST_STALE";
  crmSyncedAt?: string;
  lostSyncedAt?: string;
  status: 503;
}

/** Older than this and a snapshot is not describing today's pipeline. */
const FRESH_WINDOW_MS = 48 * 60 * 60 * 1000;

export async function loadLeadPerformanceReport(input: {
  month?: string;
  course?: string;
}): Promise<LeadPerformanceReport | LeadPerformanceRefusal> {
  const { loadAllData } = await import("./sheet-cache.server");
  const { readVerifiedYeastarLeadCalls, refreshRecentYeastarCdr, yeastarCdrCoverage } =
    await import("./yeastar-cdr.server");
  const { leadQaConfigured, readLeadQaVerifications } = await import("./lead-qa.server");
  const { acquisitionDatabaseConfigured, getPool, BUSINESS_TIME_ZONE } =
    await import("./acquisition-attribution.server");
  const { accountingUsdPaid, DEFAULT_FX_RATES } = await import("./fx-rates");
  const { isExcludedFromSalesRevenue } = await import("./sales-revenue-policy");
  const { buildLeadPerformance, sixCalendarMonths } = await import("./lead-performance");

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
    return Number.isFinite(age) && age >= 0 && age <= FRESH_WINDOW_MS;
  };
  const crmSyncedAt = sourceSync("crm");
  // A month-to-date zero from a stale snapshot is not a business result.
  if (!isFresh(crmSyncedAt)) return { error: "CRM_STALE", crmSyncedAt, status: 503 };
  const lostSyncedAt = sourceSync("lost");
  const accountingSyncedAt = sourceSync("accounting");
  const lostAvailable = snapshot.health.lostAuthority !== "unavailable" && isFresh(lostSyncedAt);
  const accountingAvailable = isFresh(accountingSyncedAt);
  // Lost rows are a disjoint part of the acquisition denominator; omitting
  // them would understate both entries and loss rate, not merely one card.
  if (!lostAvailable) return { error: "LOST_STALE", lostSyncedAt, status: 503 };

  const asPerformanceLead = (row: {
    id: string;
    createdAt: string;
    createdAtUtc?: string;
    recordType: "lead" | "opportunity";
    businessStatus: "lead" | "open" | "won" | "lost";
    source: string;
    leadSegment: string;
    course: string;
    campaignName: string;
    salesperson: string;
    closingChannel?: string;
    phone: string;
    mobile: string;
    email: string;
    lossReason: string;
    lostAt?: string;
    lostAtBasis?: string;
  }): PerformanceLead => ({
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
    closingChannel: row.closingChannel,
    phone: row.phone,
    mobile: row.mobile,
    email: row.email,
    lossReason: row.lossReason,
    lostAt: row.lostAt,
    lostAtBasis: row.lostAtBasis,
  });
  const leads: PerformanceLead[] = [
    ...snapshot.crm.map(asPerformanceLead),
    ...snapshot.lost.map((row) =>
      asPerformanceLead({ ...row, lostAt: row.lostDate, lostAtBasis: row.lostDateBasis }),
    ),
  ];

  const emptyLinks = {
    available: false,
    refreshedAt: null as Date | string | null,
    rows: [] as { orderName: string; opportunityId: string }[],
  };
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
          available: result.rows.length > 0 && isFresh(String(result.rows[0]?.refreshed_at ?? "")),
          refreshedAt: result.rows[0]?.refreshed_at ?? null,
          rows: result.rows.map((row) => ({
            orderName: row.sale_order_name,
            opportunityId: String(row.opportunity_id),
          })),
        }))
        .catch(() => emptyLinks)
    : Promise.resolve(emptyLinks);
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
    ? readLeadQaVerifications(leads.filter((row) => row.createdAt >= firstDay).map((row) => row.id))
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
      movement: row.movement,
      company: row.company,
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
    selectedMonth: input.month,
    course: input.course,
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
          paidLines.reduce((sum, row) => sum + accountingUsdPaid(row, DEFAULT_FX_RATES), 0) * 100,
        ) / 100,
    };
  });

  return {
    result,
    collectionsByMonth,
    callCoverage,
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
    asOf,
  };
}

/** Where each figure in this report actually comes from, shown on the page. */
export const LEAD_PERFORMANCE_SOURCES = {
  crm: "Odoo CRM (creation date; current status)",
  payments: "Paid Accounting lines + exact sale.order.opportunity_id link",
  calls: "Yeastar PBX direct CDR API (unique outbound call ID; full-day coverage required)",
  qa: "Manual lead QA + canonical Odoo loss reason",
} as const;
