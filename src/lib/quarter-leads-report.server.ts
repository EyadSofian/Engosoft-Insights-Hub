import { getFiltered, attributedAdCourse, authoritativeLostLeads } from "./metrics.server";
import { fetchTikTokAds } from "./tiktok.server";
import { getSharedDatabasePool } from "./database-pool.server";
import { getAdSpendCoverage } from "./ad-delivery-coverage.server";
import { accountingReportingDate } from "./accounting-policy";
import {
  buildQuarterLeadReview,
  REVIEW_MONTHS,
  platformForReview,
  type ReviewLead,
} from "./quarter-leads-report";
import type { GlobalFilters } from "./types";
const cache = new Map<string, { until: number; promise: ReturnType<typeof read> }>();
export function quarterLeadReview(filters: GlobalFilters = {}) {
  // Fixed temporary review window; the page explicitly supports course/platform, not seller allocation.
  const scope = {
    course: filters.course,
    platform: filters.platform,
    fxEgp: filters.fxEgp,
    fxSar: filters.fxSar,
  };
  const key = JSON.stringify(scope),
    prior = cache.get(key);
  if (prior && prior.until > Date.now()) return prior.promise;
  if (cache.size >= 8) cache.delete(cache.keys().next().value!);
  const promise = read(scope);
  const entry = { until: Infinity, promise };
  cache.set(key, entry);
  promise.then(
    () => (entry.until = Date.now() + 300000),
    () => cache.delete(key),
  );
  return promise;
}
async function read(scope: GlobalFilters) {
  const asOf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [data, revenue] = await Promise.all([
    getFiltered({ ...scope, from: "2026-08-01", to: "2026-10-31" }),
    getFiltered({ fxEgp: scope.fxEgp, fxSar: scope.fxSar, from: "2026-08-01", to: asOf }),
  ]);
  const sync = (key: string) => data.snapshot.tabSyncs.find((s) => s.key === key)?.syncedAt || "";
  const fresh = (key: string) => {
    const age = Date.now() - Date.parse(sync(key));
    return age >= 0 && age < 48 * 3600000;
  };
  const [tik, links, coverages] = await Promise.all([
    fetchTikTokAds().catch(() => ({ configured: false, errors: ["unavailable"], rows: [] })),
    getSharedDatabasePool()
      .query<{ sale_order_name: string; opportunity_id: string; refreshed_at: string }>(
        "SELECT sale_order_name, opportunity_id, max(refreshed_at) OVER () AS refreshed_at FROM crm_sale_order_links",
      )
      .then((r) => ({
        rows: r.rows,
        ready:
          r.rows.length > 0 &&
          Date.now() - Date.parse(String(r.rows[0]?.refreshed_at)) < 48 * 3600000,
      }))
      .catch(() => ({ rows: [], ready: false })),
    Promise.all(
      REVIEW_MONTHS.map((month) =>
        getAdSpendCoverage({
          from: month + "-01",
          to:
            month === "2026-08" ? "2026-08-31" : month === "2026-09" ? "2026-09-30" : "2026-10-31",
          platform: scope.platform,
        }),
      ),
    ),
  ]);
  const tikNative = new Map(
    tik.rows.map((r) => [r.date + "\0" + r.adId + "\0" + r.accountId, r.formLeads]),
  );
  const ads = data.ads.map((a) => ({
    month: a.date.slice(0, 7),
    course: attributedAdCourse(a, data.snapshot).course,
    platform: a.platform,
    campaign: a.campaign,
    campaignKey: a.campaignKey,
    account: a.account,
    objective: a.objective,
    spend: a.spend,
    clicks: a.clicksAll,
    nativeLeads:
      a.platform === "tiktok"
        ? tik.configured && tik.errors.length === 0
          ? (tikNative.get(a.date + "\0" + a.adId + "\0" + a.accountId) ?? null)
          : null
        : ["meta", "snapchat"].includes(a.platform)
          ? a.platformLeads
          : null,
  }));
  const leads: ReviewLead[] = [
    ...data.crm.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      course: r.course,
      platform: platformForReview(r.source),
      campaign: r.campaignName,
      campaignKey: r.campaignKey,
      source: r.source,
      segment: r.leadSegment,
      status: r.isWon ? "won" : r.businessStatus,
      recordType: r.recordType,
      closeDate: r.isWon ? r.wonDate || r.closedAt : "",
      dateBasis: r.wonDate ? "won_date" : r.closedAt ? "date_closed" : "",
      nativeEvidence: Boolean(r.facebookLeadId),
    })),
    ...authoritativeLostLeads(data).map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      course: r.course,
      platform: platformForReview(r.source),
      campaign: r.campaignName,
      campaignKey: r.campaignKey,
      source: r.source,
      segment: r.leadSegment,
      status: "lost",
      recordType: r.recordType,
      closeDate: r.lostDate || r.closeDate,
      dateBasis: r.lostDateBasis,
      nativeEvidence: Boolean(r.facebookLeadId),
    })),
  ];
  const orderLinks = new Map<string, Set<string>>();
  for (const row of links.rows) {
    const ids = orderLinks.get(row.sale_order_name) || new Set<string>();
    ids.add(String(row.opportunity_id));
    orderLinks.set(row.sale_order_name, ids);
  }
  const spendCoverage = Object.fromEntries(REVIEW_MONTHS.map((m, i) => [m, coverages[i].complete]));
  const result = buildQuarterLeadReview({
    ads,
    leads,
    payments: revenue.accounting.map((p) => ({
      company: p.company,
      invoice: p.movement,
      order: p.orderRef,
      leadId: orderLinks.get(p.orderRef)?.size === 1 ? [...orderLinks.get(p.orderRef)!][0] : "",
      date: accountingReportingDate(p, "payment"),
      course: p.course,
      amount: p.usdPaid,
    })),
    asOf,
    spendCoverage,
    crmReady: fresh("crm") && fresh("lost") && data.snapshot.health.lostAuthority !== "unavailable",
    revenueReady: fresh("accounting"),
    linksReady: links.ready,
  });
  return {
    ...result,
    asOf,
    generatedAt: new Date().toISOString(),
    appliedFilters: scope,
    sourceSyncs: data.snapshot.tabSyncs,
    spendCoverage: coverages,
    linksReady: links.ready,
    availability: {
      crm: fresh("crm") && fresh("lost") && data.snapshot.health.lostAuthority !== "unavailable",
      revenue: fresh("accounting"),
      links: links.ready,
    },
    tiktokNativeReady: tik.configured && tik.errors.length === 0,
    sources: {
      crm: "Odoo current state by creation month",
      native:
        "Meta native forms; Snapchat native leads; TikTok form metric only; Google not asserted as native",
      payments: "Accounting paid lines + exact sale.order.opportunity_id",
      lifecycle: "Creation to recorded Won/Lost date; dated samples only",
    },
  };
}
export type QuarterLeadReviewReport = Awaited<ReturnType<typeof quarterLeadReview>>;
