import { getFiltered, attributedAdCourse, authoritativeLostLeads } from "./metrics.server";
import { loadCrmDateRows } from "./lead-course-distribution.server";
import { loadLostMovement, matchesLostMovementDimensions } from "./crm-lost-movement.server";
import { loadCrmRawByIds } from "./crm-odoo.server";
import { cairoDate } from "./crm-lost-events";
import { getAdSpendCoverage } from "./ad-delivery-coverage.server";
import { getSharedDatabasePool } from "./database-pool.server";
import { accountingReportingDate } from "./accounting-policy";
import {
  buildDailyUpdates,
  validDailyDate,
  type DailyEntry,
  type DailyLoss,
} from "./daily-updates";
import type { GlobalFilters } from "./types";
import { odooConfig } from "./odoo.server";

export const dailyToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const cache = new Map<string, { until: number; promise: ReturnType<typeof buildReport> }>();
export async function dailyUpdatesReport(filters: GlobalFilters, requestedDay?: string) {
  const day = requestedDay || dailyToday();
  if (!validDailyDate(day, dailyToday())) throw new Error("INVALID_DAY");
  // This workspace intentionally owns its one-day/month-to-date window, not the global period.
  const scope = {
    ...filters,
    from: day.slice(0, 7) + "-01",
    to: day,
    range: undefined,
    dateBasis: undefined,
  } as GlobalFilters;
  const key = JSON.stringify(scope),
    prior = cache.get(key);
  if (prior && prior.until > Date.now()) return prior.promise;
  if (cache.size >= 8) cache.delete(cache.keys().next().value!);
  const promise = buildReport(scope, day);
  cache.set(key, { until: Date.now() + 60000, promise });
  promise.catch(() => cache.delete(key));
  return promise;
}
async function buildReport(scope: GlobalFilters, day: string) {
  const data = await getFiltered(scope);
  const errors: string[] = [];
  const src = (key: string) => data.snapshot.tabSyncs.find((s) => s.key === key)?.syncedAt || "";
  const revenueSyncedAt = src("accounting");
  const fresh = (s: string) =>
    Number.isFinite(Date.parse(s)) &&
    Date.now() - Date.parse(s) >= 0 &&
    Date.now() - Date.parse(s) < 48 * 3600000;
  const revenueReady = fresh(revenueSyncedAt);
  if (!revenueReady) errors.push("revenue_stale");
  const financialOnlyScope = Boolean(
    scope.company || scope.salesperson || scope.salesTeam || scope.source || scope.mainCategory,
  );
  const [rawResult, movement, links, dayCoverage, monthCoverage, closedData] = await Promise.all([
    loadCrmDateRows(scope)
      .then((rows) => ({ ok: true, rows }))
      .catch(() => ({ ok: false, rows: [] })),
    loadLostMovement({ ...scope, from: day, to: day }, data.snapshot).catch(() => null),
    getSharedDatabasePool()
      .query<{ sale_order_name: string; opportunity_id: string; refreshed_at: string }>(
        "SELECT sale_order_name, opportunity_id, max(refreshed_at) OVER () AS refreshed_at FROM crm_sale_order_links",
      )
      .then((r) => ({
        ok: r.rows.length > 0 && fresh(String(r.rows[0]?.refreshed_at || "")),
        rows: r.rows,
      }))
      .catch(() => ({ ok: false, rows: [] })),
    getAdSpendCoverage({ from: day, to: day, platform: scope.platform, account: scope.account }),
    getAdSpendCoverage({
      from: scope.from,
      to: day,
      platform: scope.platform,
      account: scope.account,
    }),
    getFiltered({ ...scope, from: day, to: day, lostDateBasis: "closed" }),
  ]);
  if (!rawResult.ok) errors.push("crm_unavailable");
  if (!links.ok) errors.push("paid_links_unavailable_or_stale");
  const odoo = odooConfig().url;
  const entries: DailyEntry[] = rawResult.rows
    .filter(
      (row) =>
        ["lead", "opportunity"].includes(row["Record Type"]) &&
        ["lead", "open", "won", "lost"].includes(row["Business Status"]) &&
        matchesLostMovementDimensions(row, scope, data.snapshot),
    )
    .map((row) => ({
      id: row.__odoo_id,
      course: row.Course || "",
      createdAt: cairoDate(row.__odoo_create_date_utc || ""),
      status: row["Business Status"],
      recordType: row["Record Type"],
      source: row.Source || "",
      segment: row["Lead Segment"] || "",
      name: row["اسم جهة الاتصال"] || "#" + row.__odoo_id,
      url: odoo + "/web#id=" + encodeURIComponent(row.__odoo_id) + "&model=crm.lead&view_type=form",
      campaign: row["Campaign Name"] || "",
      campaignKey: row["Campaign ID"] ? "id:" + row["Campaign ID"] : undefined,
    }));
  let losses: DailyLoss[] = [];
  let lossBasis: "chatter_events" | "crm_lost_date" | "unavailable" = "chatter_events";
  let lostReady = movement?.availability === "available";
  if (lostReady && movement) {
    // Exclusion must check both source and internal segment, including older-created records.
    try {
      const raw = movement.records.length
        ? await loadCrmRawByIds(movement.records.map((r) => Number(r.id)))
        : [];
      const byId = new Map(raw.map((r) => [r.__odoo_id, r]));
      if (movement.records.some((r) => !byId.has(r.id))) throw Error("partial");
      losses = movement.records.map((r) => ({
        id: r.id,
        course: r.course,
        date: r.lostDate,
        recordType: r.typeAtEvent,
        name: r.contact,
        url: r.odooUrl,
        source: r.source,
        segment: byId.get(r.id)?.["Lead Segment"] || "",
      }));
    } catch {
      lostReady = false;
    }
  }
  const chatterAvailable = lostReady;
  const trackedLostDay = chatterAvailable
    ? buildDailyUpdates({
        day,
        entries: [],
        losses,
        payments: [],
        spend: [],
        availability: {
          crm: false,
          lost: true,
          revenue: false,
          links: false,
          daySpend: false,
          monthSpend: false,
        },
      }).totals.lostDay
    : null;
  // Keep the main measure identical to /lost's close-date workspace, regardless
  // of Chatter permissions. Event history is separate optional evidence.
  lostReady = false;
  losses = [];
  let fallbackDateCount = 0;
  if (
    closedData.snapshot.health?.lostAuthority &&
    closedData.snapshot.health.lostAuthority !== "unavailable" &&
    fresh(src("lost"))
  ) {
    losses = authoritativeLostLeads(closedData).map((r) => ({
      id: r.id,
      course: r.course,
      date: r.closeDate,
      recordType: r.recordType,
      name: r.contact,
      source: r.source,
      segment: r.leadSegment,
      url: odoo + "/web#id=" + encodeURIComponent(r.id) + "&model=crm.lead&view_type=form",
    }));
    fallbackDateCount = authoritativeLostLeads(closedData).filter(
      (r) => !["lost_verification_date", "date_closed"].includes(r.lostDateBasis),
    ).length;
    lostReady = true;
    lossBasis = "crm_lost_date";
  } else if (!lostReady) lossBasis = "unavailable";
  if (!lostReady) errors.push("lost_date_source_unavailable");
  const orderLinks = new Map<string, Set<string>>();
  for (const row of links.rows) {
    const ids = orderLinks.get(row.sale_order_name) || new Set<string>();
    ids.add(String(row.opportunity_id));
    orderLinks.set(row.sale_order_name, ids);
  }
  const ambiguousOrderLinks = [...orderLinks.values()].filter((s) => s.size > 1).length;
  const payments = data.accounting.map((row) => ({
    course: row.course,
    order: row.orderRef,
    company: row.company,
    leadId: orderLinks.get(row.orderRef)?.size === 1 ? [...orderLinks.get(row.orderRef)!][0] : "",
    date: accountingReportingDate(row, "payment"),
    amount: row.usdPaid,
    invoice: row.movement,
  }));
  const spend = data.ads.map((row) => {
    const attribution = attributedAdCourse(row, data.snapshot);
    return {
      course: attribution.course,
      campaign: row.campaign,
      campaignKey: row.campaignKey,
      platform: row.platform,
      date: row.date,
      spend: row.spend,
      attribution: attribution.source,
    };
  });
  // No exact allocation exists for company/salesperson/source-only spend filters.
  const availability = {
    crm: rawResult.ok,
    lost: lostReady,
    revenue: revenueReady,
    links: links.ok,
    daySpend: dayCoverage.complete && !financialOnlyScope,
    monthSpend: monthCoverage.complete && !financialOnlyScope,
  };
  const report = buildDailyUpdates({
    day,
    entries,
    losses,
    payments,
    spend: financialOnlyScope ? [] : spend,
    availability,
    courses: scope.course
      ? [scope.course]
      : !financialOnlyScope
        ? ["CFM", "PMP", "CMRP", "Interior", "Auto", "BIM"]
        : [],
  });
  return {
    ...report,
    generatedAt: new Date().toISOString(),
    today: dailyToday(),
    timezone: "Africa/Cairo",
    errors,
    financialOnlyScope,
    ambiguousOrderLinks,
    lossBasis,
    chatterAvailable,
    trackedLostDay,
    fallbackDateCount,
    lossEvidenceCoverage: {
      ambiguousEvents: movement?.ambiguousEvents ?? null,
      archiveWithoutLostEvidence: movement?.unknownArchiveEvents ?? null,
      repeatedRecords: movement?.repeatedRecords ?? null,
    },
    unlinkedInvoices: new Set(
      payments.filter((p) => p.amount > 0 && !p.leadId).map((p) => p.company + "\0" + p.invoice),
    ).size,
    coverage: { day: dayCoverage, month: monthCoverage },
    sources: {
      crmReadAt: rawResult.ok ? new Date().toISOString() : "",
      lostReadAt: src("lost"),
      revenueSyncedAt,
      linksSyncedAt: String(links.rows[0]?.refreshed_at || ""),
      adsSyncedAt: data.snapshot.syncedAt,
    },
    excludedSources: ["Recommendation", "WhatsApp Broadcast", "AutoDialer Broadcast"],
    appliedFilters: scope,
  };
}
export type DailyUpdatesReport = Awaited<ReturnType<typeof dailyUpdatesReport>>;
