// Server-only compute layer: applies filters, produces aggregates.
import { loadAllData, normalizeName, type DataQuality } from "./sheet-cache.server";
import type {
  AdSetAgg,
  CampaignAgg,
  CourseAgg,
  CrmLeadRow,
  Deltas,
  ExecSummary,
  GlobalFilters,
  Grouped,
  InvoicedRow,
  LostRow,
  MetaRow,
  SalesRow,
  Totals,
} from "./types";

/**
 * A row passes when no date window is active. Once a window IS active, a row
 * with no date must be EXCLUDED — otherwise undated rows leak all-time totals
 * into a filtered window. (The invoiced tab has ~93% blank `Invoice Date`,
 * which is what inflated ROAS to ~87x before this guard existed.)
 */
function inRange(date: string, from?: string, to?: string): boolean {
  if (!from && !to) return true;
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function matchesFilter<T>(rows: T[], test: (r: T) => boolean): T[] {
  return rows.filter(test);
}

function safeDiv(a: number, b: number): number {
  return b > 0 ? a / b : 0;
}

const isWon = (stage: string) => stage.trim().toLowerCase() === "won";

export interface FilteredData {
  meta: MetaRow[];
  crm: CrmLeadRow[];
  invoiced: InvoicedRow[];
  sales: SalesRow[];
  lost: LostRow[];
  metaDateMin: string;
  metaDateMax: string;
  revenueDateMin: string;
  revenueDateMax: string;
  syncedAt: string;
  matchRate: number;
  unmatchedCampaigns: string[];
  unmatchedRevenueCampaigns: string[];
  dateMismatch: boolean;
  dataQuality: DataQuality;
  fetchErrors: string[];
  applied: GlobalFilters;
}

export async function getFiltered(f: GlobalFilters = {}): Promise<FilteredData> {
  const all = await loadAllData();
  const { from, to, account, campaign, source, mainCategory, salesTeam } = f;

  const meta = matchesFilter(all.meta, (r) => {
    if (!inRange(r.date, from, to)) return false;
    if (account && r.account !== account) return false;
    if (campaign && r.campaign !== campaign) return false;
    return true;
  });

  const crm = matchesFilter(all.crm, (r) => {
    if (!inRange(r.createdAt, from, to)) return false;
    if (campaign && r.campaignName !== campaign) return false;
    if (source && r.cleanedSource !== source && r.source !== source) return false;
    if (mainCategory && r.mainCategory !== mainCategory) return false;
    if (salesTeam && r.salesTeam !== salesTeam) return false;
    return true;
  });

  const invoiced = matchesFilter(all.invoiced, (r) => {
    if (!inRange(r.revenueDate, from, to)) return false;
    if (campaign && r.campaignName !== campaign) return false;
    if (source && r.cleanedSource !== source && r.source !== source) return false;
    if (mainCategory && r.mainCategory !== mainCategory) return false;
    if (salesTeam && r.salesTeam !== salesTeam) return false;
    return true;
  });

  const sales = matchesFilter(all.sales, (r) => {
    if (!inRange(r.paymentDate, from, to)) return false;
    if (salesTeam && r.salesTeam !== salesTeam) return false;
    return true;
  });

  const lost = matchesFilter(all.lost, (r) => {
    if (!inRange(r.createdAt, from, to)) return false;
    if (campaign && r.campaignName !== campaign) return false;
    if (source && r.cleanedSource !== source) return false;
    if (mainCategory && r.mainCategory !== mainCategory) return false;
    if (salesTeam && r.salesTeam !== salesTeam) return false;
    return true;
  });

  // Revenue is all-time but spend only covers Meta's window → ROAS is inflated.
  const dateMismatch =
    !!(from && all.metaDateMin && from < all.metaDateMin) ||
    !!(to && all.metaDateMax && to > all.metaDateMax) ||
    (!from && !to && !!all.metaDateMin);

  return {
    meta,
    crm,
    invoiced,
    sales,
    lost,
    metaDateMin: all.metaDateMin,
    metaDateMax: all.metaDateMax,
    revenueDateMin: all.revenueDateMin,
    revenueDateMax: all.revenueDateMax,
    syncedAt: all.syncedAt,
    matchRate: all.matchRate,
    unmatchedCampaigns: all.unmatchedCampaigns,
    unmatchedRevenueCampaigns: all.unmatchedRevenueCampaigns,
    dateMismatch,
    dataQuality: all.dataQuality,
    fetchErrors: all.fetchErrors,
    applied: f,
  };
}

/** The Meta window, used as the honest default range for the whole dashboard. */
export async function getDefaultRange(): Promise<{ from: string; to: string }> {
  const all = await loadAllData();
  return { from: all.metaDateMin, to: all.metaDateMax };
}

export function computeTotals(data: FilteredData): Totals {
  const spend = data.meta.reduce((s, r) => s + r.spend, 0);
  const impressions = data.meta.reduce((s, r) => s + r.impressions, 0);
  const clicksAll = data.meta.reduce((s, r) => s + r.clicksAll, 0);
  const linkClicks = data.meta.reduce((s, r) => s + r.linkClicks, 0);
  const metaLeads = data.meta.reduce((s, r) => s + r.metaLeads, 0);
  const crmLeads = data.crm.length;
  const won = data.crm.filter((r) => isWon(r.cleanedStage)).length;
  const revenue = data.invoiced.reduce((s, r) => s + r.usdSales, 0);

  const metaIds = new Set(data.meta.map((m) => m.campaignId).filter(Boolean));
  const metaNames = new Set(data.meta.map((m) => normalizeName(m.campaign)).filter(Boolean));
  const attributedRevenue = data.invoiced.reduce((s, r) => {
    const hit =
      (r.campaignId && metaIds.has(r.campaignId)) ||
      (r.campaignName && metaNames.has(normalizeName(r.campaignName)));
    return hit ? s + r.usdSales : s;
  }, 0);

  const orders = new Set(data.invoiced.map((r) => r.orderRef).filter(Boolean)).size;

  return {
    spend,
    impressions,
    clicksAll,
    linkClicks,
    // CTR is recomputed from summed clicks/impressions — never averaged.
    ctrAll: safeDiv(clicksAll, impressions) * 100,
    ctrLink: safeDiv(linkClicks, impressions) * 100,
    cpm: safeDiv(spend, impressions) * 1000,
    cpc: safeDiv(spend, clicksAll),
    metaLeads,
    crmLeads,
    won,
    winRate: safeDiv(won, crmLeads) * 100,
    revenue,
    attributedRevenue,
    cpl: safeDiv(spend, metaLeads || crmLeads),
    cac: safeDiv(spend, won),
    roas: safeDiv(revenue, spend),
    attributedRoas: safeDiv(attributedRevenue, spend),
    orders: orders || data.invoiced.length,
    avgOrder: safeDiv(revenue, orders || data.invoiced.length),
  };
}

export function computeCampaigns(data: FilteredData): CampaignAgg[] {
  const map = new Map<string, CampaignAgg>();
  const keyFor = (name: string, id: string) =>
    id ? `id:${id}` : `name:${normalizeName(name)}`;

  const upsert = (name: string, id: string): CampaignAgg => {
    const key = keyFor(name, id);
    let agg = map.get(key);
    if (!agg) {
      agg = emptyAgg(name, id);
      map.set(key, agg);
    }
    if (!agg.campaign && name) agg.campaign = name;
    return agg;
  };

  for (const m of data.meta) {
    if (!m.campaign && !m.campaignId) continue;
    const agg = upsert(m.campaign, m.campaignId);
    agg.spend += m.spend;
    agg.impressions += m.impressions;
    agg.clicksAll += m.clicksAll;
    agg.linkClicks += m.linkClicks;
    agg.metaLeads += m.metaLeads;
  }

  const adSpend = new Map<string, Map<string, number>>();
  for (const m of data.meta) {
    if (!m.adName) continue;
    const key = keyFor(m.campaign, m.campaignId);
    let inner = adSpend.get(key);
    if (!inner) {
      inner = new Map();
      adSpend.set(key, inner);
    }
    inner.set(m.adName, (inner.get(m.adName) ?? 0) + m.spend);
  }

  for (const c of data.crm) {
    if (!c.campaignName && !c.campaignId) continue;
    const agg = upsert(c.campaignName, c.campaignId);
    agg.crmLeads += 1;
    if (isWon(c.cleanedStage)) agg.won += 1;
  }

  for (const inv of data.invoiced) {
    if (!inv.campaignName && !inv.campaignId) continue;
    const agg = upsert(inv.campaignName, inv.campaignId);
    agg.revenue += inv.usdSales;
  }

  const out: CampaignAgg[] = [];
  for (const [key, agg] of map) {
    agg.ctrAll = safeDiv(agg.clicksAll, agg.impressions) * 100;
    agg.ctrLink = safeDiv(agg.linkClicks, agg.impressions) * 100;
    agg.cpm = safeDiv(agg.spend, agg.impressions) * 1000;
    agg.cpc = safeDiv(agg.spend, agg.clicksAll);
    agg.cpl = safeDiv(agg.spend, agg.metaLeads || agg.crmLeads);
    agg.cac = safeDiv(agg.spend, agg.won);
    agg.roas = safeDiv(agg.revenue, agg.spend);
    agg.winRate = safeDiv(agg.won, agg.crmLeads) * 100;
    const ads = adSpend.get(key);
    if (ads) {
      let topName = "";
      let topVal = 0;
      for (const [n, v] of ads) if (v > topVal) { topName = n; topVal = v; }
      if (topName) agg.topAd = { name: topName, spend: topVal };
    }
    out.push(agg);
  }
  return out.sort((a, b) => b.spend - a.spend);
}

function emptyAgg(name: string, id: string): CampaignAgg {
  return {
    campaign: name,
    campaignId: id,
    spend: 0,
    impressions: 0,
    clicksAll: 0,
    linkClicks: 0,
    ctrAll: 0,
    ctrLink: 0,
    cpm: 0,
    cpc: 0,
    metaLeads: 0,
    crmLeads: 0,
    won: 0,
    revenue: 0,
    cpl: 0,
    cac: 0,
    roas: 0,
    winRate: 0,
  };
}

/** Ad-set → ad drilldown for one campaign. */
export function computeDrilldown(data: FilteredData, campaign: string): AdSetAgg[] {
  const target = normalizeName(campaign);
  const rows = data.meta.filter((m) => normalizeName(m.campaign) === target);
  const sets = new Map<string, AdSetAgg>();
  const adMap = new Map<string, Map<string, AdSetAgg["ads"][number]>>();

  for (const m of rows) {
    const sName = m.adsetName || "—";
    let s = sets.get(sName);
    if (!s) {
      s = { adset: sName, spend: 0, impressions: 0, clicksAll: 0, ctrAll: 0, metaLeads: 0, cpl: 0, ads: [] };
      sets.set(sName, s);
      adMap.set(sName, new Map());
    }
    s.spend += m.spend;
    s.impressions += m.impressions;
    s.clicksAll += m.clicksAll;
    s.metaLeads += m.metaLeads;

    const inner = adMap.get(sName)!;
    const aName = m.adName || "—";
    let a = inner.get(aName);
    if (!a) {
      a = { ad: aName, spend: 0, impressions: 0, clicksAll: 0, ctrAll: 0, metaLeads: 0, cpl: 0 };
      inner.set(aName, a);
    }
    a.spend += m.spend;
    a.impressions += m.impressions;
    a.clicksAll += m.clicksAll;
    a.metaLeads += m.metaLeads;
  }

  for (const [name, s] of sets) {
    s.ctrAll = safeDiv(s.clicksAll, s.impressions) * 100;
    s.cpl = safeDiv(s.spend, s.metaLeads);
    s.ads = Array.from(adMap.get(name)!.values())
      .map((a) => ({ ...a, ctrAll: safeDiv(a.clicksAll, a.impressions) * 100, cpl: safeDiv(a.spend, a.metaLeads) }))
      .sort((x, y) => y.spend - x.spend);
  }
  return Array.from(sets.values()).sort((a, b) => b.spend - a.spend);
}

export function bestCampaign(campaigns: CampaignAgg[], minSpend = 100): CampaignAgg | null {
  let eligible = campaigns.filter((c) => c.spend >= minSpend && c.revenue > 0);
  // Relax the threshold rather than showing nothing on a short/quiet window.
  if (!eligible.length) eligible = campaigns.filter((c) => c.spend > 0 && c.revenue > 0);
  if (!eligible.length) return null;
  return eligible.reduce((a, b) => (b.roas > a.roas ? b : a));
}

export function moneyLeak(campaigns: CampaignAgg[], minSpend = 100): CampaignAgg | null {
  let eligible = campaigns.filter((c) => c.spend >= minSpend);
  if (!eligible.length) eligible = campaigns.filter((c) => c.spend > 0);
  if (!eligible.length) return null;
  // Rank by wasted spend: high spend and low ROAS score worst.
  return eligible.reduce((worst, c) =>
    c.spend / (1 + c.roas) > worst.spend / (1 + worst.roas) ? c : worst,
  );
}

/**
 * Cheapest cost per lead. Requires real volume and real spend, otherwise a
 * campaign with two leads and a few dollars always "wins" at a meaningless CPL.
 */
export function bestCPL(campaigns: CampaignAgg[], minLeads = 20, minSpend = 50): CampaignAgg | null {
  const volume = (c: CampaignAgg) => c.metaLeads || c.crmLeads;
  let eligible = campaigns.filter((c) => c.cpl > 0 && c.spend >= minSpend && volume(c) >= minLeads);
  if (!eligible.length) {
    eligible = campaigns.filter((c) => c.cpl > 0 && volume(c) >= 5);
  }
  if (!eligible.length) return null;
  return eligible.reduce((a, b) => (b.cpl < a.cpl ? b : a));
}

export function dailyTrend(data: FilteredData): { date: string; spend: number; revenue: number; leads: number }[] {
  const spendByDate = new Map<string, number>();
  const revenueByDate = new Map<string, number>();
  const leadsByDate = new Map<string, number>();
  for (const m of data.meta)
    if (m.date) spendByDate.set(m.date, (spendByDate.get(m.date) ?? 0) + m.spend);
  // revenueDate, not invoiceDate — invoiceDate is blank on ~93% of rows.
  for (const inv of data.invoiced)
    if (inv.revenueDate)
      revenueByDate.set(inv.revenueDate, (revenueByDate.get(inv.revenueDate) ?? 0) + inv.usdSales);
  for (const c of data.crm)
    if (c.createdAt) leadsByDate.set(c.createdAt, (leadsByDate.get(c.createdAt) ?? 0) + 1);

  const dates = new Set<string>([...spendByDate.keys(), ...revenueByDate.keys(), ...leadsByDate.keys()]);
  return Array.from(dates)
    .sort()
    .map((d) => ({
      date: d,
      spend: spendByDate.get(d) ?? 0,
      revenue: revenueByDate.get(d) ?? 0,
      leads: leadsByDate.get(d) ?? 0,
    }));
}

export function computeCourses(data: FilteredData, prev?: FilteredData): CourseAgg[] {
  const map = new Map<string, CourseAgg>();
  const blank = (course: string, mainCategory: string): CourseAgg => ({
    course,
    mainCategory,
    revenue: 0,
    prevRevenue: 0,
    revenueDelta: 0,
    orders: 0,
    avgOrder: 0,
    leads: 0,
    won: 0,
    winRate: 0,
    spend: 0,
    roas: 0,
    cpl: 0,
  });
  const get = (course: string, cat: string) => {
    let a = map.get(course);
    if (!a) {
      a = blank(course, cat);
      map.set(course, a);
    }
    if (!a.mainCategory && cat) a.mainCategory = cat;
    return a;
  };

  for (const inv of data.invoiced) {
    if (!inv.course) continue;
    const a = get(inv.course, inv.mainCategory);
    a.revenue += inv.usdSales;
    a.orders += 1;
  }

  for (const c of data.crm) {
    if (!c.course) continue;
    const a = get(c.course, c.mainCategory);
    a.leads += 1;
    if (isWon(c.cleanedStage)) a.won += 1;
  }

  // Attribute Meta spend to a course via the campaign's dominant CRM course.
  const campaignCourse = new Map<string, Map<string, number>>();
  for (const c of data.crm) {
    if (!c.campaignName || !c.course) continue;
    const k = normalizeName(c.campaignName);
    let counts = campaignCourse.get(k);
    if (!counts) {
      counts = new Map();
      campaignCourse.set(k, counts);
    }
    counts.set(c.course, (counts.get(c.course) ?? 0) + 1);
  }
  const dominant = new Map<string, string>();
  for (const [k, counts] of campaignCourse) {
    let top = "";
    let n = 0;
    for (const [course, cnt] of counts) if (cnt > n) { top = course; n = cnt; }
    if (top) dominant.set(k, top);
  }
  for (const m of data.meta) {
    const course = dominant.get(normalizeName(m.campaign));
    if (!course) continue;
    const a = map.get(course);
    if (a) a.spend += m.spend;
  }

  if (prev) {
    for (const inv of prev.invoiced) {
      if (!inv.course) continue;
      const a = map.get(inv.course);
      if (a) a.prevRevenue += inv.usdSales;
    }
  }

  for (const a of map.values()) {
    a.avgOrder = safeDiv(a.revenue, a.orders);
    a.winRate = safeDiv(a.won, a.leads) * 100;
    a.roas = safeDiv(a.revenue, a.spend);
    a.cpl = safeDiv(a.spend, a.leads);
    a.revenueDelta = a.prevRevenue > 0 ? ((a.revenue - a.prevRevenue) / a.prevRevenue) * 100 : 0;
  }
  return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
}

/** The equal-length window immediately before [from, to]. */
export function previousPeriod(from?: string, to?: string): { from: string; to: string } | null {
  if (!from || !to) return null;
  const a = new Date(from + "T00:00:00Z");
  const b = new Date(to + "T00:00:00Z");
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  const days = Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
  const prevTo = new Date(a.getTime() - 86_400_000);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86_400_000);
  return { from: prevFrom.toISOString().slice(0, 10), to: prevTo.toISOString().slice(0, 10) };
}

/** Percentage change per metric vs the previous equal-length window. */
export function computeDeltas(now: Totals, prev: Totals): Deltas {
  const out: Deltas = {};
  (Object.keys(now) as (keyof Totals)[]).forEach((k) => {
    const a = prev[k];
    const b = now[k];
    if (typeof a !== "number" || typeof b !== "number") return;
    if (a === 0) return;
    out[k] = ((b - a) / Math.abs(a)) * 100;
  });
  return out;
}

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
/** Small values (CPL, CPC) need decimals or they collapse to "$0". */
const money2 = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(0) + "%";

/**
 * Deterministic, bilingual manager summary. No LLM involved — this must be
 * reliable and identical for the same data.
 */
export function execSummary(
  totals: Totals,
  campaigns: CampaignAgg[],
  deltas: Deltas,
  range: { from?: string; to?: string },
): ExecSummary {
  const best = bestCampaign(campaigns);
  const leak = moneyLeak(campaigns);
  const cpl = bestCPL(campaigns);
  const window = range.from && range.to ? `${range.from} → ${range.to}` : "";

  const en: string[] = [];
  const ar: string[] = [];

  en.push(
    `Between ${window}, you spent ${money(totals.spend)} and brought in ${totals.crmLeads.toLocaleString("en-US")} leads, of which ${totals.won} closed (${totals.winRate.toFixed(1)}% win rate).`,
  );
  ar.push(
    `خلال الفترة ${window} أنفقت ${money(totals.spend)} ووصلك ${totals.crmLeads.toLocaleString("en-US")} عميل محتمل، أُغلق منهم ${totals.won} (نسبة إغلاق ${totals.winRate.toFixed(1)}%).`,
  );

  en.push(
    `Revenue in the same window was ${money(totals.revenue)}, of which ${money(totals.attributedRevenue)} traces back to a Meta campaign — that attributed slice is the honest ROAS at ${totals.attributedRoas.toFixed(2)}×.`,
  );
  ar.push(
    `الإيراد في نفس الفترة ${money(totals.revenue)}، منه ${money(totals.attributedRevenue)} مرتبط بحملة على ميتا — وهذا الجزء وحده هو ما يعطي ROAS حقيقي قدره ${totals.attributedRoas.toFixed(2)}×.`,
  );

  if (best) {
    en.push(
      `Best campaign: ${best.campaign} — ${money(best.spend)} spent returned ${money(best.revenue)} (${best.roas.toFixed(2)}×).`,
    );
    ar.push(
      `أفضل حملة: ${best.campaign} — أنفقت ${money(best.spend)} وأعادت ${money(best.revenue)} (${best.roas.toFixed(2)}×).`,
    );
  }

  if (leak && leak.roas < 1) {
    en.push(
      `Biggest leak: ${leak.campaign} — ${money(leak.spend)} spent for ${money(leak.revenue)} back (${leak.roas.toFixed(2)}×). Worth pausing or reworking the creative.`,
    );
    ar.push(
      `أكبر إهدار: ${leak.campaign} — أنفقت ${money(leak.spend)} ولم تُعد سوى ${money(leak.revenue)} (${leak.roas.toFixed(2)}×). يُفضّل إيقافها أو تغيير الإعلان.`,
    );
  }

  if (cpl) {
    const leads = cpl.metaLeads || cpl.crmLeads;
    en.push(
      `Cheapest leads came from ${cpl.campaign} at ${money2(cpl.cpl)} per lead across ${leads} leads.`,
    );
    ar.push(
      `أرخص العملاء جاءوا من ${cpl.campaign} بتكلفة ${money2(cpl.cpl)} للعميل الواحد على ${leads} عميل.`,
    );
  }

  if (typeof deltas.spend === "number") {
    en.push(`Spend is ${pct(deltas.spend)} versus the previous period.`);
    ar.push(`الإنفاق ${pct(deltas.spend)} مقارنة بالفترة السابقة.`);
  }

  return { en: en.join(" "), ar: ar.join(" ") };
}

export function distinctValues<T>(rows: T[], key: keyof T): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const v = r[key];
    if (v && typeof v === "string" && v.trim()) set.add(v.trim());
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function groupSum<T>(rows: T[], key: (r: T) => string, value: (r: T) => number): Grouped[] {
  const m = new Map<string, Grouped>();
  for (const r of rows) {
    const k = key(r) || "—";
    let e = m.get(k);
    if (!e) {
      e = { label: k, value: 0, count: 0 };
      m.set(k, e);
    }
    e.value += value(r);
    e.count += 1;
  }
  return Array.from(m.values()).sort((a, b) => b.value - a.value);
}

export type { DataQuality };
