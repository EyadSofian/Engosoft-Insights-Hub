// Server-only: sheet fetch, parse, cache
import Papa from "papaparse";
import type {
  MetaRow,
  CrmLeadRow,
  InvoicedRow,
  SalesRow,
  LostRow,
} from "./types";

const DEFAULT_SHEET_ID = "14kv8Xkv8SeFhF9roekDI0OKmpZBU29YQOlMj03LOKT0";
const TTL_MS = 30 * 60 * 1000;

export interface DataQuality {
  /** Rows whose attribution date could not be resolved at all. */
  invoicedMissingDate: number;
  invoicedRows: number;
  salesMissingDate: number;
  salesRows: number;
  crmMissingDate: number;
  crmRows: number;
  /** Share of invoiced revenue that maps to a Meta campaign (id or name). */
  attributedRevenueShare: number;
}

interface Cache {
  fetchedAt: number;
  meta: MetaRow[];
  crm: CrmLeadRow[];
  invoiced: InvoicedRow[];
  sales: SalesRow[];
  lost: LostRow[];
  syncedAt: string;
  matchRate: number;
  unmatchedCampaigns: string[];
  unmatchedRevenueCampaigns: string[];
  metaDateMin: string;
  metaDateMax: string;
  revenueDateMin: string;
  revenueDateMax: string;
  dataQuality: DataQuality;
  /** Non-fatal per-tab fetch failures, surfaced in the UI. */
  fetchErrors: string[];
}

let cache: Cache | null = null;
let inflight: Promise<Cache> | null = null;

const TAB_NAMES = {
  meta: "Meta Ads Daily",
  crm: "CRM Leads",
  invoiced: "Full Invoiced Orders",
  sales: "Sales",
  lost: "Lost Analysis",
};

function csvUrl(sheetId: string, tab: string): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
    tab,
  )}`;
}

function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const s = String(v).replace(/[,\s$%]/g, "").replace(/[^\d.\-]/g, "");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function parseDate(v: unknown): string {
  const s = str(v);
  if (!s) return "";
  // Try common formats: YYYY-MM-DD, DD/MM/YYYY, ISO
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dmy) {
    const y = dmy[3].length === 2 ? "20" + dmy[3] : dmy[3];
    return `${y}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return "";
}

async function fetchTab(sheetId: string, tab: string): Promise<Record<string, string>[]> {
  const res = await fetch(csvUrl(sheetId, tab), {
    headers: { "cache-control": "no-cache" },
  });
  if (!res.ok) throw new Error(`Failed to fetch tab "${tab}": ${res.status}`);
  const text = await res.text();
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  return parsed.data.filter((r) => r && Object.keys(r).length > 0);
}

function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function loadAllData(force = false): Promise<Cache> {
  if (!force && cache && Date.now() - cache.fetchedAt < TTL_MS) return cache;
  if (inflight) return inflight;

  const sheetId = process.env.SHEET_ID || DEFAULT_SHEET_ID;

  inflight = (async () => {
    const fetchErrors: string[] = [];
    const safeFetch = (tab: string) =>
      fetchTab(sheetId, tab).catch((e: unknown) => {
        fetchErrors.push(`${tab}: ${e instanceof Error ? e.message : String(e)}`);
        return [] as Record<string, string>[];
      });

    const [metaRaw, crmRaw, invRaw, salesRaw, lostRaw] = await Promise.all([
      safeFetch(TAB_NAMES.meta),
      safeFetch(TAB_NAMES.crm),
      safeFetch(TAB_NAMES.invoiced),
      safeFetch(TAB_NAMES.sales),
      safeFetch(TAB_NAMES.lost),
    ]);

    const meta: MetaRow[] = metaRaw.map((r) => ({
      date: parseDate(r["التاريخ"]),
      account: str(r["اسم الحساب الإعلاني"]),
      campaign: str(r["اسم الكامبين"]),
      campaignId: str(r["__campaign_id"]),
      adsetName: str(r["Ad set name"]),
      adName: str(r["Ad Name"]),
      spend: num(r["Spend (Cost)"]),
      impressions: num(r["Impressions"]),
      linkClicks: num(r["Link Clicks"]),
      clicksAll: num(r["Clicks (all)"]),
      metaLeads: num(r["Leads (on facebook Leads)"]),
      syncedAt: str(r["__synced_at"]),
    }));

    const crm: CrmLeadRow[] = crmRaw.map((r) => ({
      createdAt: parseDate(r["أنشئ في"]),
      campaignName: str(r["Campaign Name"]),
      campaignId: str(r["Campaign ID"]),
      adName: str(r["Ad Name"]),
      contact: str(r["اسم جهة الاتصال"]),
      salesperson: str(r["Salesperson"]),
      salesTeam: str(r["Sales Team"]),
      stage: str(r["Stage"]),
      cleanedStage: str(r["Cleaned Stage"]),
      source: str(r["Source"]),
      cleanedSource: str(r["cleaned Source"]),
      course: str(r["Course"]),
      mainCategory: str(r["Main Category"]),
      priority: str(r["Priority"]),
      month: str(r["Month"]),
      orderTotal: num(r["إجمالي الطلبات"]),
    }));

    const invoiced: InvoicedRow[] = invRaw.map((r) => {
      const invoiceDate = parseDate(r["Invoice Date"]);
      // `Invoice Date` is populated on only ~7% of rows, while `Date` (the order
      // line creation timestamp) is populated on 100%. Filtering on `Invoice Date`
      // silently drops ~93% of revenue, so `Date` is the attribution date.
      const revenueDate =
        parseDate(r["Date"]) || parseDate(r["بنود الطلب /أنشئ في"]) || invoiceDate;
      return {
        orderRef: str(r["بنود الطلب /مرجع الطلب"]) || str(r["بنود الطلب/مرجع الطلب"]),
        campaignName: str(r["Campaign Name"]) || str(r["الفرصة /Campaign Name"]),
        campaignId: str(r["الفرصة /Campaign ID"]) || str(r["Campaign ID"]),
        adName: str(r["AD Name"]) || str(r["Ad Name"]) || str(r["الفرصة /Ad Name"]),
        product: str(r["بنود الطلب /المنتج"]) || str(r["بنود الطلب/المنتج"]),
        customer: str(r["بنود الطلب /العميل"]) || str(r["بنود الطلب/العميل"]),
        course: str(r["Course"]),
        mainCategory: str(r["Main Category"]),
        salesTeam: str(r["Sales Team"]) || str(r["Team"]),
        salesperson: str(r["بنود الطلب /مندوب المبيعات"]),
        source: str(r["Source"]),
        cleanedSource: str(r["Cleaned Source"]),
        invoiceDate,
        revenueDate,
        month: str(r["Month"]),
        localTotal: num(r["بنود الطلب /الإجمالي"]) || num(r["بنود الطلب/الإجمالي"]),
        usdSales: num(r["$ Sales"]),
      };
    });

    const sales: SalesRow[] = salesRaw.map((r) => ({
      paymentDate: parseDate(r["Payment Date"]),
      invoiceDate: parseDate(r["تاريخ الفاتورة"]),
      course: str(r["Course Name"]),
      category: str(r["فئة المنتج"]),
      partner: str(r["الشريك"]),
      salesperson: str(r["Salesperson"]),
      teamLeader: str(r["Team Leader"]),
      salesTeam: str(r["فريق المبيعات"]),
      usdSales: num(r["$ Sales"]),
      currency: str(r["العملة"]),
      eventStage: str(r["Event Stage"]),
      month: (() => {
        const d = parseDate(r["Payment Date"]);
        return d ? d.slice(0, 7) : "";
      })(),
    }));

    const lost: LostRow[] = lostRaw.map((r) => ({
      campaignName: str(r["Campaign Name"]),
      lossReason: str(r["سبب الضياع"]),
      course: str(r["Course"]),
      mainCategory: str(r["Main Category"]),
      salesTeam: str(r["فريق المبيعات"]),
      cleanedSource: str(r["cleaned Source"]),
      month: str(r["Month"]),
      createdAt: parseDate(r["أنشئ في"]),
    }));

    // freshness
    let syncedAt = "";
    for (const m of meta) {
      if (m.syncedAt && m.syncedAt > syncedAt) syncedAt = m.syncedAt;
    }

    // Meta date range
    const metaDates = meta.map((m) => m.date).filter(Boolean).sort();
    const metaDateMin = metaDates[0] ?? "";
    const metaDateMax = metaDates[metaDates.length - 1] ?? "";

    // Match rate: CRM campaigns matched to Meta by id or name
    const metaIds = new Set(meta.map((m) => m.campaignId).filter(Boolean));
    const metaNames = new Set(meta.map((m) => normalizeName(m.campaign)));
    let matched = 0;
    let total = 0;
    const unmatchedSet = new Set<string>();
    for (const c of crm) {
      if (!c.campaignName && !c.campaignId) continue;
      total++;
      if (
        (c.campaignId && metaIds.has(c.campaignId)) ||
        (c.campaignName && metaNames.has(normalizeName(c.campaignName)))
      ) {
        matched++;
      } else if (c.campaignName) {
        unmatchedSet.add(c.campaignName);
      }
    }

    // Unmatched revenue: invoiced with no meta campaign
    const unmatchedRev = new Set<string>();
    let attributedRevenue = 0;
    let totalRevenue = 0;
    for (const inv of invoiced) {
      totalRevenue += inv.usdSales;
      if (!inv.campaignName && !inv.campaignId) continue;
      const hit =
        (inv.campaignId && metaIds.has(inv.campaignId)) ||
        (inv.campaignName && metaNames.has(normalizeName(inv.campaignName)));
      if (hit) attributedRevenue += inv.usdSales;
      else if (inv.campaignName) unmatchedRev.add(inv.campaignName);
    }

    const revDates = invoiced.map((i) => i.revenueDate).filter(Boolean).sort();

    const dataQuality: DataQuality = {
      invoicedMissingDate: invoiced.filter((i) => !i.revenueDate).length,
      invoicedRows: invoiced.length,
      salesMissingDate: sales.filter((s) => !s.paymentDate).length,
      salesRows: sales.length,
      crmMissingDate: crm.filter((c) => !c.createdAt).length,
      crmRows: crm.length,
      attributedRevenueShare: totalRevenue > 0 ? attributedRevenue / totalRevenue : 0,
    };

    return {
      fetchedAt: Date.now(),
      meta,
      crm,
      invoiced,
      sales,
      lost,
      syncedAt,
      matchRate: total > 0 ? matched / total : 0,
      unmatchedCampaigns: Array.from(unmatchedSet),
      unmatchedRevenueCampaigns: Array.from(unmatchedRev),
      metaDateMin,
      metaDateMax,
      revenueDateMin: revDates[0] ?? "",
      revenueDateMax: revDates[revDates.length - 1] ?? "",
      dataQuality,
      fetchErrors,
    };
  })();

  const previous = cache;
  try {
    const next = await inflight;
    // If every tab failed but we still hold a good snapshot, keep serving the
    // stale one rather than blanking the dashboard.
    const empty =
      next.meta.length === 0 &&
      next.crm.length === 0 &&
      next.invoiced.length === 0 &&
      next.sales.length === 0;
    if (empty && previous) {
      previous.fetchedAt = Date.now();
      return previous;
    }
    cache = next;
    return cache;
  } catch (e) {
    if (previous) return previous;
    throw e;
  } finally {
    inflight = null;
  }
}

export function invalidateCache() {
  cache = null;
}

export { normalizeName };
