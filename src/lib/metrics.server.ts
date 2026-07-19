// Server-only compute layer: applies filters, produces aggregates.
//
// Division discipline: every ratio goes through `div()`, which returns `null`
// when the denominator is zero. `null` renders as an em dash. A metric must
// never surface as 0, NaN or Infinity because its denominator was empty — those
// read as real results and get acted on.
import { loadAllData, normalizeName, normalizeSource, type Snapshot } from "./sheet-cache.server";
import type {
  AdRow,
  CourseAgg,
  CrmLeadRow,
  DataHealth,
  Deltas,
  ExecSummary,
  FunnelStep,
  GlobalFilters,
  Grouped,
  InvoicedRow,
  LostBreakdown,
  LostRow,
  Matrix,
  Maybe,
  PerfRow,
  Platform,
  SalesRow,
  TeamAgg,
  Totals,
  YoyResult,
} from "./types";

/* --- primitives ----------------------------------------------------------- */

export function div(a: number, b: number): Maybe {
  return b > 0 && isFinite(a / b) ? a / b : null;
}

const pctOf = (a: number, b: number): Maybe => {
  const r = div(a, b);
  return r === null ? null : r * 100;
};

/**
 * A row passes when no date window is active. Once a window IS active, a row
 * with no date must be EXCLUDED — otherwise undated rows leak all-time totals
 * into a filtered window, which is what previously reported ROAS at ~87×.
 */
function inRange(date: string, from?: string, to?: string): boolean {
  if (!from && !to) return true;
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

/** Sums a nullable metric across rows; stays `null` when no row reports it. */
function sumMaybe<T>(rows: T[], pick: (r: T) => number | null): Maybe {
  let total = 0;
  let seen = false;
  for (const r of rows) {
    const v = pick(r);
    if (v === null) continue;
    total += v;
    seen = true;
  }
  return seen ? total : null;
}

const sum = <T>(rows: T[], pick: (r: T) => number) => rows.reduce((s, r) => s + pick(r), 0);

/** Source keys that identify each ad platform inside the CRM. */
const PLATFORM_SOURCES: Record<Platform, string[]> = {
  meta: ["facebook", "instagram"],
  snapchat: ["snapchat"],
};

/* --- filtering ------------------------------------------------------------ */

export interface FilteredData {
  ads: AdRow[];
  crm: CrmLeadRow[];
  invoiced: InvoicedRow[];
  sales: SalesRow[];
  lost: LostRow[];
  snapshot: Snapshot;
  applied: GlobalFilters;
  /** Ad accounts whose objective is not lead generation. */
  nonLeadAccounts: string[];
  includeNonLead: boolean;
  cpaBasis: "won" | "invoices";
}

export async function getFiltered(f: GlobalFilters = {}): Promise<FilteredData> {
  const all = await loadAllData();
  const {
    from,
    to,
    platform,
    account,
    campaign,
    adset,
    ad,
    source,
    course,
    mainCategory,
    salesTeam,
    salesperson,
  } = f;

  const includeNonLead = f.includeNonLead === "1";
  const cpaBasis = f.cpaBasis === "invoices" ? "invoices" : "won";
  const sourceKey = source ? normalizeSource(source) : "";

  // Course lives on CRM/invoice/lost rows but never on an ad row, so a course
  // filter reaches the ads tabs through the campaign → modal-course inference.
  const courseCampaigns = new Set<string>();
  if (course) {
    for (const [key, meta] of all.campaigns) {
      if (meta.course && normalizeName(meta.course) === normalizeName(course)) courseCampaigns.add(key);
    }
  }

  // CRM/invoice rows carry no platform column. A row belongs to a platform when
  // its campaign is one of that platform's campaigns, or when its source names
  // the platform (Snapchat leads exist in CRM well beyond Snap's 7-day spend).
  const platformCampaigns = new Set<string>();
  if (platform) {
    for (const a of all.ads) if (a.platform === platform) platformCampaigns.add(a.campaignKey);
  }
  const matchesPlatform = (campaignKey: string, srcKey: string): boolean => {
    if (!platform) return true;
    if (campaignKey && platformCampaigns.has(campaignKey)) return true;
    return PLATFORM_SOURCES[platform].includes(srcKey);
  };

  const ads = all.ads.filter((r) => {
    if (!inRange(r.date, from, to)) return false;
    if (platform && r.platform !== platform) return false;
    if (account && r.account !== account) return false;
    if (campaign && r.campaign !== campaign) return false;
    if (adset && r.adset !== adset) return false;
    if (ad && r.ad !== ad) return false;
    if (course && !courseCampaigns.has(r.campaignKey)) return false;
    return true;
  });

  const crm = all.crm.filter((r) => {
    if (!inRange(r.createdAt, from, to)) return false;
    if (!matchesPlatform(r.campaignKey, r.sourceKey)) return false;
    if (campaign && r.campaignName !== campaign) return false;
    if (adset && r.adset !== adset) return false;
    if (ad && r.adName !== ad) return false;
    if (sourceKey && r.sourceKey !== sourceKey) return false;
    if (course && normalizeName(r.course) !== normalizeName(course)) return false;
    if (mainCategory && r.mainCategory !== mainCategory) return false;
    if (salesTeam && r.salesTeam !== salesTeam && r.subTeam !== salesTeam) return false;
    if (salesperson && r.salesperson !== salesperson) return false;
    return true;
  });

  const invoiced = all.invoiced.filter((r) => {
    if (!inRange(r.revenueDate, from, to)) return false;
    if (!matchesPlatform(r.campaignKey, r.sourceKey)) return false;
    if (campaign && r.campaignName !== campaign) return false;
    if (adset && r.adset !== adset) return false;
    if (ad && r.adName !== ad) return false;
    if (sourceKey && r.sourceKey !== sourceKey) return false;
    if (course && normalizeName(r.course) !== normalizeName(course)) return false;
    if (mainCategory && r.mainCategory !== mainCategory) return false;
    // `Sales Team` is filled on only ~16% of invoice lines, so a team filter
    // matches on salesperson too rather than discarding 84% of the revenue.
    if (salesTeam && r.salesTeam !== salesTeam && !teamHasPerson(all, salesTeam, r.salesperson))
      return false;
    if (salesperson && r.salesperson !== salesperson) return false;
    return true;
  });

  const sales = all.sales.filter((r) => {
    if (!inRange(r.paymentDate, from, to)) return false;
    if (course && normalizeName(r.course) !== normalizeName(course)) return false;
    if (salesTeam && r.salesTeam !== salesTeam) return false;
    if (salesperson && r.salesperson !== salesperson) return false;
    return true;
  });

  const lost = all.lost.filter((r) => {
    if (!inRange(r.createdAt, from, to)) return false;
    if (!matchesPlatform(r.campaignKey, r.sourceKey)) return false;
    if (campaign && r.campaignName !== campaign) return false;
    if (ad && r.adName !== ad) return false;
    if (sourceKey && r.sourceKey !== sourceKey) return false;
    if (course && normalizeName(r.course) !== normalizeName(course)) return false;
    if (mainCategory && r.mainCategory !== mainCategory) return false;
    if (salesTeam && r.salesTeam !== salesTeam) return false;
    if (salesperson && r.salesperson !== salesperson) return false;
    return true;
  });

  return {
    ads,
    crm,
    invoiced,
    sales,
    lost,
    snapshot: all,
    applied: f,
    nonLeadAccounts: all.accounts.filter((a) => a.objective !== "leads").map((a) => a.name),
    includeNonLead,
    cpaBasis,
  };
}

/** Maps a salesperson back to their team, for tabs that omit the team column. */
let personTeamCache: { snapshot: Snapshot; map: Map<string, string> } | null = null;
function teamHasPerson(all: Snapshot, team: string, person: string): boolean {
  if (!person) return false;
  if (personTeamCache?.snapshot !== all) {
    const map = new Map<string, string>();
    for (const c of all.crm) {
      if (c.salesperson && c.salesTeam && !map.has(c.salesperson)) map.set(c.salesperson, c.salesTeam);
    }
    personTeamCache = { snapshot: all, map };
  }
  return personTeamCache.map.get(person) === team;
}

/** Default window: year to date. Spend now covers the full year, so the old
 *  Meta-window default (and its period-mismatch warning) is gone. */
export async function getDefaultRange(): Promise<{ from: string; to: string }> {
  const all = await loadAllData();
  const latest = [all.adsDateMax, all.crmDateMax, all.revenueDateMax].filter(Boolean).sort().pop() ?? "";
  const year = latest ? latest.slice(0, 4) : String(new Date().getUTCFullYear());
  return { from: `${year}-01-01`, to: latest || `${year}-12-31` };
}

/* --- close time ------------------------------------------------------------ */

/**
 * Mean days from lead creation to close, over leads that actually have a closing
 * date. In this sheet every one of those is a Won lead, so this reads as "time
 * to win". The sample size travels with the number and must always be shown.
 */
function closeStats(rows: CrmLeadRow[]): { avg: Maybe; sample: number } {
  let total = 0;
  let n = 0;
  for (const r of rows) {
    if (r.daysToClose === null || r.daysToClose < 0) continue;
    total += r.daysToClose;
    n++;
  }
  return { avg: div(total, n), sample: n };
}

/* --- totals ---------------------------------------------------------------- */

export function computeTotals(data: FilteredData): Totals {
  const { ads, crm, invoiced, includeNonLead, cpaBasis } = data;

  const spend = sum(ads, (a) => a.spend);
  const spendMeta = sum(ads.filter((a) => a.platform === "meta"), (a) => a.spend);
  const spendSnap = sum(ads.filter((a) => a.platform === "snapchat"), (a) => a.spend);
  const nonLeadSpend = sum(ads.filter((a) => a.objective !== "leads"), (a) => a.spend);
  const efficiencySpend = includeNonLead ? spend : spend - nonLeadSpend;

  const impressions = sum(ads, (a) => a.impressions);
  const clicksAll = sum(ads, (a) => a.clicksAll);
  const linkClicks = sumMaybe(ads, (a) => a.linkClicks);
  const platformLeads = sumMaybe(ads, (a) => a.platformLeads);

  // Link CTR is only defined over impressions from platforms that report link
  // clicks, so Snapchat impressions are excluded from its denominator.
  const linkImpressions = sum(ads.filter((a) => a.linkClicks !== null), (a) => a.impressions);

  const crmLeads = crm.length;
  const leadsFromCampaign = crm.filter((c) => c.fromCampaign).length;
  const won = crm.filter((c) => c.isWon).length;
  const lost = crm.filter((c) => c.isLost).length;
  const { avg: avgCloseDays, sample: closeSample } = closeStats(crm);

  const revenue = sum(invoiced, (r) => r.usdSales);
  const adCampaignKeys = new Set(data.ads.map((a) => a.campaignKey).filter(Boolean));
  const attributedRevenue = sum(
    invoiced.filter((r) => r.campaignKey && adCampaignKeys.has(r.campaignKey)),
    (r) => r.usdSales,
  );
  const orders = new Set(invoiced.map((r) => r.orderRef).filter(Boolean)).size || invoiced.length;

  const cpaWon = div(efficiencySpend, won);
  const cpaInvoices = div(efficiencySpend, orders);

  return {
    spend,
    spendMeta,
    spendSnap,
    nonLeadSpend,
    efficiencySpend,
    impressions,
    clicksAll,
    linkClicks,
    ctrAll: pctOf(clicksAll, impressions),
    ctrLink: linkClicks === null ? null : pctOf(linkClicks, linkImpressions),
    cpm: (() => {
      const r = div(spend, impressions);
      return r === null ? null : r * 1000;
    })(),
    cpc: div(spend, clicksAll),
    platformLeads,

    crmLeads,
    leadsFromCampaign,
    leadsOther: crmLeads - leadsFromCampaign,
    won,
    lost,
    conversionRate: pctOf(won, crmLeads),
    lostRate: pctOf(lost, crmLeads),
    avgCloseDays,
    closeSample,

    revenue,
    attributedRevenue,
    orders,
    avgOrder: div(revenue, orders),
    revenuePerLead: div(revenue, crmLeads),

    // The manager's CPL: all spend ÷ every lead that entered the CRM.
    cpl: div(efficiencySpend, crmLeads),
    // What the platform itself would report.
    platformCpl: platformLeads === null ? null : div(efficiencySpend, platformLeads),
    // The honest paid CPL: only leads that actually carry a campaign.
    attributedCpl: div(efficiencySpend, leadsFromCampaign),
    cpa: cpaBasis === "invoices" ? cpaInvoices : cpaWon,
    cpaWon,
    cpaInvoices,
    roas: div(revenue, efficiencySpend),
    attributedRoas: div(attributedRevenue, efficiencySpend),
    acos: (() => {
      const r = div(efficiencySpend, revenue);
      return r === null ? null : r * 100;
    })(),
    attributedAcos: (() => {
      const r = div(efficiencySpend, attributedRevenue);
      return r === null ? null : r * 100;
    })(),
  };
}

/* --- performance rows (campaign / ad set / ad) ------------------------------ */

export type Grain = "campaign" | "adset" | "ad";

interface Bucket {
  key: string;
  name: string;
  platforms: Set<Platform>;
  objective: import("./types").CampaignObjective;
  course: string;
  courseInferred: boolean;
  adsetOrigin?: import("./types").AdSetOrigin;
  spend: number;
  impressions: number;
  clicksAll: number;
  linkClicks: number | null;
  platformLeads: number | null;
  crmLeads: number;
  won: number;
  lost: number;
  revenue: number;
  closeTotal: number;
  closeSample: number;
  spendDates: Set<string>;
  revenueByDate: Map<string, number>;
}

const UNKNOWN_ADSET = "__unknown_adset__";

/** Above this share of revenue landing outside the spend window, ratios lie. */
const PARTIAL_SPEND_THRESHOLD = 0.3;

export function computePerf(data: FilteredData, grain: Grain): PerfRow[] {
  const buckets = new Map<string, Bucket>();

  const touch = (key: string, name: string): Bucket => {
    let b = buckets.get(key);
    if (!b) {
      b = {
        key,
        name,
        platforms: new Set(),
        objective: "leads",
        course: "",
        courseInferred: false,
        spend: 0,
        impressions: 0,
        clicksAll: 0,
        linkClicks: null,
        platformLeads: null,
        crmLeads: 0,
        won: 0,
        lost: 0,
        revenue: 0,
        closeTotal: 0,
        closeSample: 0,
        spendDates: new Set(),
        revenueByDate: new Map(),
      };
      buckets.set(key, b);
    }
    if (!b.name && name) b.name = name;
    return b;
  };

  const adKey = (a: AdRow) =>
    grain === "campaign" ? a.campaignKey : grain === "adset" ? a.adset || UNKNOWN_ADSET : a.ad || "—";
  const adLabel = (a: AdRow) =>
    grain === "campaign" ? a.campaign : grain === "adset" ? a.adset : a.ad;

  for (const a of data.ads) {
    const key = adKey(a);
    if (!key) continue;
    const b = touch(key, adLabel(a));
    b.platforms.add(a.platform);
    if (a.objective !== "leads") b.objective = a.objective;
    b.spend += a.spend;
    b.impressions += a.impressions;
    b.clicksAll += a.clicksAll;
    if (a.date && a.spend > 0) b.spendDates.add(a.date);
    if (a.linkClicks !== null) b.linkClicks = (b.linkClicks ?? 0) + a.linkClicks;
    if (a.platformLeads !== null) b.platformLeads = (b.platformLeads ?? 0) + a.platformLeads;
    if (grain === "campaign") {
      const meta = data.snapshot.campaigns.get(a.campaignKey);
      if (meta?.course && !b.course) {
        b.course = meta.course;
        b.courseInferred = true;
      }
    }
  }

  // Unresolved ad-set rows go into an explicit bucket with real totals rather
  // than being dropped, which would make the column silently under-count.
  const crmKey = (c: CrmLeadRow) =>
    grain === "campaign" ? c.campaignKey : grain === "adset" ? c.adset || UNKNOWN_ADSET : c.adName || "—";
  const crmLabel = (c: CrmLeadRow) =>
    grain === "campaign" ? c.campaignName : grain === "adset" ? c.adset : c.adName;

  for (const c of data.crm) {
    const key = crmKey(c);
    if (!key || (grain === "campaign" && !c.fromCampaign)) continue;
    if (grain !== "campaign" && !c.adName && !c.adId) continue;
    const b = touch(key, crmLabel(c));
    b.crmLeads++;
    if (c.isWon) b.won++;
    if (c.isLost) b.lost++;
    if (c.daysToClose !== null && c.daysToClose >= 0) {
      b.closeTotal += c.daysToClose;
      b.closeSample++;
    }
    if (grain === "adset" && !b.adsetOrigin) b.adsetOrigin = c.adsetOrigin;
    if (!b.course && c.course) b.course = c.course;
  }

  const invKey = (i: InvoicedRow) =>
    grain === "campaign" ? i.campaignKey : grain === "adset" ? i.adset || UNKNOWN_ADSET : i.adName || "—";
  for (const i of data.invoiced) {
    const key = invKey(i);
    if (!key || (grain === "campaign" && !i.campaignKey)) continue;
    if (grain !== "campaign" && !i.adName && !i.adId) continue;
    const b = touch(key, grain === "campaign" ? i.campaignName : grain === "adset" ? i.adset : i.adName);
    b.revenue += i.usdSales;
    if (i.revenueDate) b.revenueByDate.set(i.revenueDate, (b.revenueByDate.get(i.revenueDate) ?? 0) + i.usdSales);
  }

  const rows: PerfRow[] = [];
  for (const b of buckets.values()) {
    const linkImpressions = b.linkClicks === null ? 0 : b.impressions;

    // A row whose revenue mostly predates its spend data cannot support a ratio.
    const spendDays = [...b.spendDates].sort();
    const spendDateMin = spendDays[0] ?? "";
    const spendDateMax = spendDays[spendDays.length - 1] ?? "";
    let insideRevenue = 0;
    for (const [date, amount] of b.revenueByDate) {
      if (spendDateMin && date >= spendDateMin && date <= spendDateMax) insideRevenue += amount;
    }
    const spendCoverage = b.revenue > 0 && spendDateMin ? insideRevenue / b.revenue : null;
    const partialSpend =
      b.spend > 0 && b.revenue > 0 && spendCoverage !== null && spendCoverage < 1 - PARTIAL_SPEND_THRESHOLD;

    rows.push({
      spendDateMin,
      spendDateMax,
      partialSpend,
      spendCoverage,
      key: b.key,
      name: b.key === UNKNOWN_ADSET ? "" : b.name || "—",
      platforms: [...b.platforms],
      course: b.course,
      courseInferred: b.courseInferred,
      adsetOrigin: b.key === UNKNOWN_ADSET ? "unknown" : b.adsetOrigin,
      objective: b.objective,
      spend: b.spend,
      impressions: b.impressions,
      clicksAll: b.clicksAll,
      linkClicks: b.linkClicks,
      ctrAll: pctOf(b.clicksAll, b.impressions),
      ctrLink: b.linkClicks === null ? null : pctOf(b.linkClicks, linkImpressions),
      cpm: (() => {
        const r = div(b.spend, b.impressions);
        return r === null ? null : r * 1000;
      })(),
      cpc: div(b.spend, b.clicksAll),
      platformLeads: b.platformLeads,
      crmLeads: b.crmLeads,
      won: b.won,
      lost: b.lost,
      conversionRate: pctOf(b.won, b.crmLeads),
      lostRate: pctOf(b.lost, b.crmLeads),
      revenue: b.revenue,
      revenuePerLead: div(b.revenue, b.crmLeads),
      cpl: div(b.spend, b.crmLeads),
      cpa: data.cpaBasis === "invoices" ? null : div(b.spend, b.won),
      roas: div(b.revenue, b.spend),
      acos: (() => {
        const r = div(b.spend, b.revenue);
        return r === null ? null : r * 100;
      })(),
      avgCloseDays: div(b.closeTotal, b.closeSample),
      closeSample: b.closeSample,
    });
  }

  return rows.sort((a, b) => b.spend - a.spend || b.revenue - a.revenue);
}

export const UNKNOWN_ADSET_KEY = UNKNOWN_ADSET;

/* --- spotlights ------------------------------------------------------------ */

/**
 * Spotlights must be decision-grade, so a row qualifies only when its spend is
 * material against the period's total and its spend data actually covers the
 * period its revenue came from. Without the first guard a $125 campaign wins on
 * a rounding error; without the second, a campaign with 5 days of cost and 7
 * months of revenue reports a fictional 18× return.
 */
function materialSpend(rows: PerfRow[], floor: number): number {
  const total = rows.reduce((s, r) => s + r.spend, 0);
  return Math.max(floor, total * 0.01);
}

function decisionGrade(rows: PerfRow[], floor: number): PerfRow[] {
  const min = materialSpend(rows, floor);
  return rows.filter((r) => r.spend >= min && r.objective === "leads" && !r.partialSpend);
}

export function bestCampaign(rows: PerfRow[], minSpend = 100): PerfRow | null {
  let eligible = decisionGrade(rows, minSpend).filter((r) => r.revenue > 0);
  if (!eligible.length) eligible = rows.filter((r) => r.spend > 0 && r.revenue > 0 && !r.partialSpend);
  if (!eligible.length) return null;
  return eligible.reduce((a, b) => ((b.roas ?? 0) > (a.roas ?? 0) ? b : a));
}

/**
 * A leak is money that did not come back, so rows are ranked by unrecovered
 * spend (spend − revenue) and must actually be under water. Ranking by a
 * spend/ROAS blend instead nominates the biggest *profitable* campaign, which
 * is the opposite of the question being asked.
 */
export function moneyLeak(rows: PerfRow[], minSpend = 100): PerfRow | null {
  const graded = decisionGrade(rows, minSpend);
  const underwater = graded.filter((r) => r.roas === null || r.roas < 1);
  const pool = underwater.length ? underwater : graded;
  if (!pool.length) return null;
  const unrecovered = (r: PerfRow) => r.spend - r.revenue;
  return pool.reduce((worst, r) => (unrecovered(r) > unrecovered(worst) ? r : worst));
}

/** Cheapest CPL, gated on real volume so a two-lead campaign can't win. */
export function bestCPL(rows: PerfRow[], minLeads = 20, minSpend = 50): PerfRow | null {
  let eligible = rows.filter(
    (r) =>
      r.cpl !== null &&
      r.spend >= minSpend &&
      r.crmLeads >= minLeads &&
      r.objective === "leads" &&
      !r.partialSpend,
  );
  if (!eligible.length) eligible = rows.filter((r) => r.cpl !== null && r.crmLeads >= 5 && !r.partialSpend);
  if (!eligible.length) return null;
  return eligible.reduce((a, b) => ((b.cpl ?? Infinity) < (a.cpl ?? Infinity) ? b : a));
}

export function topLeaks(rows: PerfRow[], n = 5): PerfRow[] {
  return rows
    .filter((r) => r.spend > 0 && !r.partialSpend && (r.roas === null || r.roas < 1))
    .sort((a, b) => b.spend - b.revenue - (a.spend - a.revenue))
    .slice(0, n);
}

/* --- funnel & trend -------------------------------------------------------- */

export function computeFunnel(t: Totals): FunnelStep[] {
  return [
    { key: "impressions", value: t.impressions },
    { key: "clicks", value: t.clicksAll },
    { key: "platform_leads", value: t.platformLeads, note: "meta_only" },
    // CRM holds leads from TikTok, UChat, WhatsApp and referrals that no ad tab
    // prices, so this stage can legitimately exceed the one above it.
    { key: "crm_leads", value: t.crmLeads, note: "includes_unpaid_sources" },
    { key: "won", value: t.won },
  ];
}

export function dailyTrend(
  data: FilteredData,
): { date: string; spend: number; revenue: number; leads: number; won: number }[] {
  const map = new Map<string, { spend: number; revenue: number; leads: number; won: number }>();
  const at = (d: string) => {
    let e = map.get(d);
    if (!e) {
      e = { spend: 0, revenue: 0, leads: 0, won: 0 };
      map.set(d, e);
    }
    return e;
  };
  for (const a of data.ads) if (a.date) at(a.date).spend += a.spend;
  for (const i of data.invoiced) if (i.revenueDate) at(i.revenueDate).revenue += i.usdSales;
  for (const c of data.crm) {
    if (!c.createdAt) continue;
    const e = at(c.createdAt);
    e.leads++;
    if (c.isWon) e.won++;
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({ date, ...v }));
}

/* --- courses --------------------------------------------------------------- */

export function computeCourses(data: FilteredData, prev?: FilteredData): CourseAgg[] {
  const map = new Map<string, CourseAgg & { closeTotal: number }>();
  const get = (course: string, cat: string) => {
    const key = normalizeName(course);
    let a = map.get(key);
    if (!a) {
      a = {
        key,
        name: course,
        platforms: [],
        course,
        courseInferred: false,
        objective: "leads",
        mainCategory: cat,
        spend: 0,
        impressions: 0,
        clicksAll: 0,
        linkClicks: null,
        ctrAll: null,
        ctrLink: null,
        cpm: null,
        cpc: null,
        platformLeads: null,
        crmLeads: 0,
        won: 0,
        lost: 0,
        conversionRate: null,
        lostRate: null,
        revenue: 0,
        revenuePerLead: null,
        cpl: null,
        cpa: null,
        roas: null,
        acos: null,
        avgCloseDays: null,
        closeSample: 0,
        closeTotal: 0,
        spendDateMin: "",
        spendDateMax: "",
        partialSpend: false,
        spendCoverage: null,
        orders: 0,
        avgOrder: null,
        prevRevenue: 0,
        revenueDelta: null,
      };
      map.set(key, a);
    }
    if (!a.mainCategory && cat) a.mainCategory = cat;
    return a;
  };

  const orderRefs = new Map<string, Set<string>>();
  for (const i of data.invoiced) {
    if (!i.course) continue;
    const a = get(i.course, i.mainCategory);
    a.revenue += i.usdSales;
    if (i.orderRef) {
      let s = orderRefs.get(a.key);
      if (!s) {
        s = new Set();
        orderRefs.set(a.key, s);
      }
      s.add(i.orderRef);
    }
  }

  for (const c of data.crm) {
    if (!c.course) continue;
    const a = get(c.course, c.mainCategory);
    a.crmLeads++;
    if (c.isWon) a.won++;
    if (c.isLost) a.lost++;
    if (c.daysToClose !== null && c.daysToClose >= 0) {
      a.closeTotal += c.daysToClose;
      a.closeSample++;
    }
  }

  // Ad spend reaches a course only through its campaign's inferred course.
  for (const ad of data.ads) {
    const meta = data.snapshot.campaigns.get(ad.campaignKey);
    if (!meta?.course) continue;
    const a = map.get(normalizeName(meta.course));
    if (!a) continue;
    a.spend += ad.spend;
    a.impressions += ad.impressions;
    a.clicksAll += ad.clicksAll;
    if (ad.platformLeads !== null) a.platformLeads = (a.platformLeads ?? 0) + ad.platformLeads;
    a.courseInferred = true;
  }

  if (prev) {
    for (const i of prev.invoiced) {
      if (!i.course) continue;
      const a = map.get(normalizeName(i.course));
      if (a) a.prevRevenue += i.usdSales;
    }
  }

  for (const a of map.values()) {
    a.orders = orderRefs.get(a.key)?.size ?? 0;
    a.avgOrder = div(a.revenue, a.orders);
    a.conversionRate = pctOf(a.won, a.crmLeads);
    a.lostRate = pctOf(a.lost, a.crmLeads);
    a.roas = div(a.revenue, a.spend);
    a.acos = (() => {
      const r = div(a.spend, a.revenue);
      return r === null ? null : r * 100;
    })();
    a.cpl = div(a.spend, a.crmLeads);
    a.cpa = div(a.spend, a.won);
    a.ctrAll = pctOf(a.clicksAll, a.impressions);
    a.cpm = (() => {
      const r = div(a.spend, a.impressions);
      return r === null ? null : r * 1000;
    })();
    a.cpc = div(a.spend, a.clicksAll);
    a.revenuePerLead = div(a.revenue, a.crmLeads);
    a.avgCloseDays = div(a.closeTotal, a.closeSample);
    a.revenueDelta = a.prevRevenue > 0 ? ((a.revenue - a.prevRevenue) / a.prevRevenue) * 100 : null;
  }

  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

/* --- teams & people --------------------------------------------------------- */

export function computeTeams(data: FilteredData): TeamAgg[] {
  interface Acc {
    agg: TeamAgg;
    closeTotal: number;
    orderRefs: Set<string>;
    people: Map<string, { agg: TeamAgg; closeTotal: number; orderRefs: Set<string> }>;
  }
  const teams = new Map<string, Acc>();

  const blank = (name: string, parent?: string): TeamAgg => ({
    key: name,
    name,
    parent,
    crmLeads: 0,
    won: 0,
    lost: 0,
    conversionRate: null,
    lostRate: null,
    revenue: 0,
    orders: 0,
    avgOrder: null,
    revenuePerLead: null,
    avgCloseDays: null,
    closeSample: 0,
  });

  const getTeam = (name: string) => {
    let t = teams.get(name);
    if (!t) {
      t = { agg: blank(name), closeTotal: 0, orderRefs: new Set(), people: new Map() };
      teams.set(name, t);
    }
    return t;
  };

  for (const c of data.crm) {
    const teamName = c.salesTeam || "—";
    const t = getTeam(teamName);
    t.agg.crmLeads++;
    if (c.isWon) t.agg.won++;
    if (c.isLost) t.agg.lost++;
    if (c.daysToClose !== null && c.daysToClose >= 0) {
      t.closeTotal += c.daysToClose;
      t.agg.closeSample++;
    }

    const person = c.salesperson || "—";
    let p = t.people.get(person);
    if (!p) {
      p = { agg: blank(person, teamName), closeTotal: 0, orderRefs: new Set() };
      t.people.set(person, p);
    }
    p.agg.crmLeads++;
    if (c.isWon) p.agg.won++;
    if (c.isLost) p.agg.lost++;
    if (c.daysToClose !== null && c.daysToClose >= 0) {
      p.closeTotal += c.daysToClose;
      p.agg.closeSample++;
    }
  }

  // Invoice lines name a salesperson on 99% of rows but a team on 16%, so
  // revenue is attributed through the person and rolled up to their team.
  const personTeam = new Map<string, string>();
  for (const c of data.crm) {
    if (c.salesperson && c.salesTeam && !personTeam.has(c.salesperson))
      personTeam.set(c.salesperson, c.salesTeam);
  }

  for (const i of data.invoiced) {
    const person = i.salesperson;
    const teamName = i.salesTeam || (person ? personTeam.get(person) : "") || "—";
    const t = getTeam(teamName);
    t.agg.revenue += i.usdSales;
    if (i.orderRef) t.orderRefs.add(i.orderRef);
    if (person) {
      let p = t.people.get(person);
      if (!p) {
        p = { agg: blank(person, teamName), closeTotal: 0, orderRefs: new Set() };
        t.people.set(person, p);
      }
      p.agg.revenue += i.usdSales;
      if (i.orderRef) p.orderRefs.add(i.orderRef);
    }
  }

  const finish = (a: TeamAgg, closeTotal: number, orders: number) => {
    a.orders = orders;
    a.conversionRate = pctOf(a.won, a.crmLeads);
    a.lostRate = pctOf(a.lost, a.crmLeads);
    a.avgOrder = div(a.revenue, orders);
    a.revenuePerLead = div(a.revenue, a.crmLeads);
    a.avgCloseDays = div(closeTotal, a.closeSample);
    return a;
  };

  const out: TeamAgg[] = [];
  for (const t of teams.values()) {
    const people = [...t.people.values()]
      .map((p) => finish(p.agg, p.closeTotal, p.orderRefs.size))
      .sort((a, b) => b.revenue - a.revenue || b.crmLeads - a.crmLeads);
    const agg = finish(t.agg, t.closeTotal, t.orderRefs.size);
    agg.people = people;
    out.push(agg);
  }
  return out.sort((a, b) => b.revenue - a.revenue || b.crmLeads - a.crmLeads);
}

/* --- grouping helpers ------------------------------------------------------- */

export function groupBy<T>(
  rows: T[],
  key: (r: T) => string,
  value: (r: T) => number = () => 1,
): Grouped[] {
  const m = new Map<string, Grouped>();
  let total = 0;
  for (const r of rows) {
    const k = key(r) || "—";
    let e = m.get(k);
    if (!e) {
      e = { label: k, value: 0, count: 0, share: 0 };
      m.set(k, e);
    }
    const v = value(r);
    e.value += v;
    e.count += 1;
    total += v;
  }
  const out = [...m.values()].sort((a, b) => b.value - a.value);
  for (const e of out) e.share = total > 0 ? (e.value / total) * 100 : 0;
  return out;
}

function matrix<T>(rows: T[], rowKey: (r: T) => string, colKey: (r: T) => string, topRows = 12, topCols = 10): Matrix {
  const rowTotalsMap = new Map<string, number>();
  const colTotalsMap = new Map<string, number>();
  const cellMap = new Map<string, number>();
  for (const r of rows) {
    const rk = rowKey(r) || "—";
    const ck = colKey(r) || "—";
    rowTotalsMap.set(rk, (rowTotalsMap.get(rk) ?? 0) + 1);
    colTotalsMap.set(ck, (colTotalsMap.get(ck) ?? 0) + 1);
    const k = rk + " " + ck;
    cellMap.set(k, (cellMap.get(k) ?? 0) + 1);
  }
  const rowNames = [...rowTotalsMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, topRows).map(([k]) => k);
  const colNames = [...colTotalsMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, topCols).map(([k]) => k);
  const cells = rowNames.map((rk) => colNames.map((ck) => cellMap.get(rk + " " + ck) ?? 0));
  return {
    rows: rowNames,
    cols: colNames,
    cells,
    rowTotals: rowNames.map((rk) => rowTotalsMap.get(rk) ?? 0),
    colTotals: colNames.map((ck) => colTotalsMap.get(ck) ?? 0),
    total: rows.length,
  };
}

/* --- lost ------------------------------------------------------------------- */

/**
 * The Lost Analysis tab and CRM `Cleaned Stage = Lost` describe different
 * populations — they share no odoo ids and differ in size (6,550 vs 4,276).
 * Reason analysis uses the Lost tab; lost *rate* uses CRM. Both counts are
 * returned so the UI can label which is which instead of implying one number.
 */
export function computeLost(data: FilteredData): LostBreakdown {
  const rows = data.lost;
  const labels = data.snapshot.sourceLabels;
  const monthOf = (d: string) => (d ? d.slice(0, 7) : "—");
  return {
    byReason: groupBy(rows, (r) => r.lossReason || "—"),
    byCourse: groupBy(rows, (r) => r.course || "—"),
    byMonth: groupBy(rows, (r) => monthOf(r.createdAt)).sort((a, b) => a.label.localeCompare(b.label)),
    byTeam: groupBy(rows, (r) => r.salesTeam || "—"),
    bySalesperson: groupBy(rows, (r) => r.salesperson || "—"),
    bySource: groupBy(rows, (r) => labels.get(r.sourceKey) ?? r.source ?? "—"),
    byCampaign: groupBy(rows, (r) => r.campaignName || "—"),
    reasonByTeam: matrix(rows, (r) => r.lossReason || "—", (r) => r.salesTeam || "—"),
    reasonByCourse: matrix(rows, (r) => r.lossReason || "—", (r) => r.course || "—"),
    total: rows.length,
    crmLostCount: data.crm.filter((c) => c.isLost).length,
  };
}

/* --- lead origin ------------------------------------------------------------ */

export interface OriginCohort {
  key: "campaign" | "other";
  leads: number;
  won: number;
  lost: number;
  conversionRate: Maybe;
  lostRate: Maybe;
  revenue: number;
  avgCloseDays: Maybe;
  closeSample: number;
}

export function computeLeadOrigin(data: FilteredData): {
  cohorts: OriginCohort[];
  otherBySource: Grouped[];
} {
  const build = (key: "campaign" | "other", rows: CrmLeadRow[], revenue: number): OriginCohort => {
    const { avg, sample } = closeStats(rows);
    const won = rows.filter((r) => r.isWon).length;
    const lost = rows.filter((r) => r.isLost).length;
    return {
      key,
      leads: rows.length,
      won,
      lost,
      conversionRate: pctOf(won, rows.length),
      lostRate: pctOf(lost, rows.length),
      revenue,
      avgCloseDays: avg,
      closeSample: sample,
    };
  };

  const fromCampaign = data.crm.filter((c) => c.fromCampaign);
  const other = data.crm.filter((c) => !c.fromCampaign);
  const campaignRevenue = sum(data.invoiced.filter((i) => !!i.campaignKey), (i) => i.usdSales);
  const otherRevenue = sum(data.invoiced.filter((i) => !i.campaignKey), (i) => i.usdSales);
  const labels = data.snapshot.sourceLabels;

  return {
    cohorts: [build("campaign", fromCampaign, campaignRevenue), build("other", other, otherRevenue)],
    otherBySource: groupBy(other, (c) => labels.get(c.sourceKey) ?? c.source ?? "—"),
  };
}

/* --- periods ---------------------------------------------------------------- */

/**
 * True when the previous window sits inside the range the sheet actually covers.
 *
 * The default year-to-date window is 200 days, so its predecessor starts in
 * mid-2025 — where this sheet holds 109 stray invoice rows and nothing else.
 * Comparing against that produced a "+5,959%" revenue delta on the Overview:
 * arithmetically correct, completely meaningless. When the previous window
 * predates complete data, no delta is shown at all.
 */
export async function isPreviousComparable(prev: { from: string; to: string } | null): Promise<boolean> {
  if (!prev) return false;
  const all = await loadAllData();
  // Ads and CRM define where the dataset genuinely begins; the invoiced tab has
  // a thin 2025 tail that would otherwise vouch for a period it cannot support.
  const starts = [all.adsDateMin, all.crmDateMin].filter(Boolean);
  if (!starts.length) return false;
  const coverageStart = starts.sort().pop()!;
  return prev.from >= coverageStart;
}

export function previousPeriod(from?: string, to?: string): { from: string; to: string } | null {
  if (!from || !to) return null;
  const a = Date.parse(from + "T00:00:00Z");
  const b = Date.parse(to + "T00:00:00Z");
  if (isNaN(a) || isNaN(b)) return null;
  const days = Math.round((b - a) / 86_400_000) + 1;
  const prevTo = new Date(a - 86_400_000);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86_400_000);
  return { from: prevFrom.toISOString().slice(0, 10), to: prevTo.toISOString().slice(0, 10) };
}

export function computeDeltas(now: Totals, prev: Totals): Deltas {
  const out: Deltas = {};
  (Object.keys(now) as (keyof Totals)[]).forEach((k) => {
    const a = prev[k];
    const b = now[k];
    if (typeof a !== "number" || typeof b !== "number") return;
    // A growth % against a zero baseline is not a fact, it's a divide by zero.
    if (a === 0) return;
    out[k] = ((b - a) / Math.abs(a)) * 100;
  });
  return out;
}

/* --- year over year ---------------------------------------------------------- */

export async function computeYoy(currentYear?: number): Promise<YoyResult> {
  const all = await loadAllData();
  const latest = [all.adsDateMax, all.crmDateMax, all.revenueDateMax].filter(Boolean).sort().pop() ?? "";
  const year = currentYear ?? (latest ? +latest.slice(0, 4) : new Date().getUTCFullYear());
  const prevYear = year - 1;

  const inYear = (d: string, y: number) => !!d && d.slice(0, 4) === String(y);
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));

  const spendOf = (y: number, m?: string) =>
    sum(
      all.ads.filter((a) => inYear(a.date, y) && (!m || a.date.slice(5, 7) === m)),
      (a) => a.spend,
    );
  const revenueOf = (y: number, m?: string) =>
    sum(
      all.invoiced.filter((i) => inYear(i.revenueDate, y) && (!m || i.revenueDate.slice(5, 7) === m)),
      (i) => i.usdSales,
    );
  const leadsOf = (y: number, m?: string) =>
    all.crm.filter((c) => inYear(c.createdAt, y) && (!m || c.createdAt.slice(5, 7) === m)).length;
  const wonOf = (y: number, m?: string) =>
    all.crm.filter((c) => c.isWon && inYear(c.createdAt, y) && (!m || c.createdAt.slice(5, 7) === m)).length;

  // Every source must carry a real prior year, not just one of them. The sheet
  // currently holds 109 invoice rows for 2025 and nothing else, which is enough
  // to pass a naive row-count check and then report +577,109% revenue growth
  // against a $134 baseline. A comparison is only possible when spend, leads and
  // revenue all exist for the prior year.
  const MIN_PRIOR_ROWS = 100;
  const priorCounts = {
    ads: all.ads.filter((a) => inYear(a.date, prevYear)).length,
    crm: all.crm.filter((c) => inYear(c.createdAt, prevYear)).length,
    invoiced: all.invoiced.filter((i) => inYear(i.revenueDate, prevYear)).length,
  };
  const available =
    priorCounts.ads >= MIN_PRIOR_ROWS &&
    priorCounts.crm >= MIN_PRIOR_ROWS &&
    priorCounts.invoiced >= MIN_PRIOR_ROWS;

  // Growth is only emitted when the prior year is comparable at all, so no
  // consumer of this payload can render a percentage the data cannot support.
  const growthOf = (current: number, previous: number): Maybe =>
    available && previous > 0 ? ((current - previous) / previous) * 100 : null;

  const series = (fn: (y: number, m?: string) => number) =>
    months.map((m) => {
      const current = fn(year, m);
      const previous = fn(prevYear, m);
      return {
        key: `${year}-${m}`,
        current,
        previous,
        delta: current - previous,
        growth: growthOf(current, previous),
      };
    });

  const ytdCut = latest ? latest.slice(5) : "12-31";
  const ytd = (fn: (y: number) => number, name: string) => {
    const current = fn(year);
    const previous = fn(prevYear);
    return { metric: name, current, previous, growth: growthOf(current, previous) };
  };
  const ytdSpend = (y: number) =>
    sum(all.ads.filter((a) => inYear(a.date, y) && a.date.slice(5) <= ytdCut), (a) => a.spend);
  const ytdRevenue = (y: number) =>
    sum(
      all.invoiced.filter((i) => inYear(i.revenueDate, y) && i.revenueDate.slice(5) <= ytdCut),
      (i) => i.usdSales,
    );
  const ytdLeads = (y: number) =>
    all.crm.filter((c) => inYear(c.createdAt, y) && c.createdAt.slice(5) <= ytdCut).length;
  const ytdWon = (y: number) =>
    all.crm.filter((c) => c.isWon && inYear(c.createdAt, y) && c.createdAt.slice(5) <= ytdCut).length;

  const courseKeys = new Set(all.invoiced.map((i) => i.course).filter(Boolean));
  const byCourse = [...courseKeys].map((course) => {
    const current = sum(
      all.invoiced.filter((i) => i.course === course && inYear(i.revenueDate, year)),
      (i) => i.usdSales,
    );
    const previous = sum(
      all.invoiced.filter((i) => i.course === course && inYear(i.revenueDate, prevYear)),
      (i) => i.usdSales,
    );
    return {
      key: course,
      metric: "revenue",
      current,
      previous,
      delta: current - previous,
      growth: growthOf(current, previous),
    };
  }).sort((a, b) => b.current - a.current);

  return {
    available,
    currentYear: year,
    previousYear: prevYear,
    reason: available ? undefined : "no_prior_year",
    spend: series(spendOf),
    revenue: series(revenueOf),
    leads: series(leadsOf),
    won: series(wonOf),
    byCourse,
    ytd: [
      ytd(ytdSpend, "spend"),
      ytd(ytdRevenue, "revenue"),
      ytd(ytdLeads, "leads"),
      ytd(ytdWon, "won"),
    ],
  };
}

/* --- exec summary ------------------------------------------------------------ */

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const money2 = (n: Maybe) =>
  n === null ? "—" : "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctStr = (n: Maybe, d = 1) => (n === null ? "—" : n.toFixed(d) + "%");
const roasStr = (n: Maybe) => (n === null ? "—" : n.toFixed(2) + "×");
const delta = (n?: number) => (n === undefined ? "—" : (n >= 0 ? "+" : "") + n.toFixed(0) + "%");

/**
 * Deterministic bilingual manager summary. No LLM — this must be reproducible
 * and identical for the same data.
 */
export function execSummary(
  t: Totals,
  rows: PerfRow[],
  deltas: Deltas,
  range: { from?: string; to?: string },
  health: DataHealth,
): ExecSummary {
  const best = bestCampaign(rows);
  const leak = moneyLeak(rows);
  const cheap = bestCPL(rows);
  const window = range.from && range.to ? `${range.from} → ${range.to}` : "";

  const en: string[] = [];
  const ar: string[] = [];

  en.push(
    `Between ${window} you spent ${money(t.spend)} and ${t.crmLeads.toLocaleString("en-US")} leads entered the CRM. ${t.won.toLocaleString("en-US")} closed (${pctStr(t.conversionRate)}) and ${t.lost.toLocaleString("en-US")} were lost (${pctStr(t.lostRate)}).`,
  );
  ar.push(
    `خلال الفترة ${window} أنفقت ${money(t.spend)} ودخل النظام ${t.crmLeads.toLocaleString("en-US")} عميلاً محتملاً. أُغلق منهم ${t.won.toLocaleString("en-US")} بنسبة ${pctStr(t.conversionRate)} وضاع ${t.lost.toLocaleString("en-US")} بنسبة ${pctStr(t.lostRate)}.`,
  );

  en.push(
    `Revenue was ${money(t.revenue)}, of which ${money(t.attributedRevenue)} traces back to a campaign — that attributed slice gives the honest ROAS of ${roasStr(t.attributedRoas)} against a blended ${roasStr(t.roas)}.`,
  );
  ar.push(
    `بلغ الإيراد ${money(t.revenue)}، منه ${money(t.attributedRevenue)} مرتبط فعلياً بحملة إعلانية — وهذا الجزء وحده يعطي عائداً حقيقياً قدره ${roasStr(t.attributedRoas)} مقابل ${roasStr(t.roas)} للإيراد الكامل.`,
  );

  en.push(
    `CPL is ${money2(t.cpl)} per CRM lead, CPA ${money2(t.cpa)} per won deal, and ACOS ${pctStr(t.acos)}.`,
  );
  ar.push(
    `تكلفة العميل المحتمل ${money2(t.cpl)}، وتكلفة الصفقة المغلقة ${money2(t.cpa)}، ونسبة الإنفاق إلى الإيراد ${pctStr(t.acos)}.`,
  );

  if (t.nonLeadSpend > 0) {
    en.push(
      `${money(t.nonLeadSpend)} of that spend ran on traffic or unnamed accounts that generate no CRM leads, and is excluded from the efficiency figures above.`,
    );
    ar.push(
      `من هذا الإنفاق ${money(t.nonLeadSpend)} على حسابات زيارات أو حسابات بلا اسم لا تنتج عملاء في النظام، وقد استُبعدت من حسابات الكفاءة أعلاه.`,
    );
  }

  if (best) {
    en.push(`Best campaign: ${best.name} — ${money(best.spend)} returned ${money(best.revenue)} (${roasStr(best.roas)}).`);
    ar.push(`أفضل حملة: ${best.name} — أنفقت ${money(best.spend)} وأعادت ${money(best.revenue)} (${roasStr(best.roas)}).`);
  }

  if (leak && (leak.roas === null || leak.roas < 1)) {
    en.push(
      `Biggest leak: ${leak.name} — ${money(leak.spend)} spent for ${money(leak.revenue)} back (${roasStr(leak.roas)}). Worth pausing or reworking the creative.`,
    );
    ar.push(
      `أكبر إهدار: ${leak.name} — أنفقت ${money(leak.spend)} ولم تُعد سوى ${money(leak.revenue)} (${roasStr(leak.roas)}). يُفضّل إيقافها أو تغيير الإعلان.`,
    );
  }

  if (cheap) {
    en.push(`Cheapest leads came from ${cheap.name} at ${money2(cheap.cpl)} across ${cheap.crmLeads} leads.`);
    ar.push(`أرخص العملاء جاءوا من ${cheap.name} بتكلفة ${money2(cheap.cpl)} للعميل على ${cheap.crmLeads} عميلاً.`);
  }

  if (t.avgCloseDays !== null) {
    en.push(`Deals take ${t.avgCloseDays.toFixed(1)} days to close on average, measured over ${t.closeSample.toLocaleString("en-US")} closed leads.`);
    ar.push(`متوسط زمن إغلاق الصفقة ${t.avgCloseDays.toFixed(1)} يوماً، محسوباً على ${t.closeSample.toLocaleString("en-US")} صفقة مغلقة.`);
  }

  if (health.leadsWithoutSpendSource > 0) {
    en.push(
      `Note: ${health.leadsWithoutSpendSource.toLocaleString("en-US")} leads arrived from sources with no spend data in the sheet (TikTok, UChat, WhatsApp and referrals), so blended CPL reads cheaper than paid CPL alone.`,
    );
    ar.push(
      `ملاحظة: وصل ${health.leadsWithoutSpendSource.toLocaleString("en-US")} عميلاً من مصادر لا يوجد لها إنفاق في الملف (تيك توك ويوشات وواتساب والترشيحات)، لذلك تظهر تكلفة العميل الإجمالية أقل من تكلفة العميل المدفوع.`,
    );
  }

  if (typeof deltas.spend === "number") {
    en.push(`Spend is ${delta(deltas.spend)} versus the previous period.`);
    ar.push(`الإنفاق ${delta(deltas.spend)} مقارنة بالفترة السابقة.`);
  }

  return { en: en.join(" "), ar: ar.join(" ") };
}

export function distinctValues<T>(rows: T[], key: (r: T) => string): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const v = key(r);
    if (v && v.trim()) set.add(v.trim());
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export type { DataHealth };
