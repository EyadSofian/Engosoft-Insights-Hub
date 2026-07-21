// Server-only: sheet fetch, parse, normalize, cache.
//
// Everything that makes a number right or wrong happens in this file. The sheet
// is an Odoo/ads export with several traps that are easy to reintroduce:
// header keys carry stray carriage returns, slash dates are US-ordered, ad names
// are not unique, and two of the tabs describe overlapping-but-different
// populations. Each guard below is load-bearing; see README "Things that are
// easy to get wrong here" before simplifying any of them.
import Papa from "papaparse";
import type {
  AdRow,
  AdSetOrigin,
  CampaignObjective,
  CrmLeadRow,
  DataHealth,
  InvoicedRow,
  LostRow,
  Platform,
  SalesRow,
} from "./types";

const DEFAULT_SHEET_ID = "14kv8Xkv8SeFhF9roekDI0OKmpZBU29YQOlMj03LOKT0";
const TTL_MS = 30 * 60 * 1000;

const TAB = {
  meta: "Meta Ads Daily",
  snap: "Snap Ads Daily",
  crm: "CRM Leads",
  invoiced: "Full Invoiced Orders",
  sales: "Sales",
  lost: "Lost Analysis",
} as const;

export interface SourceFreshness {
  key: string;
  label: string;
  /** ISO time the upstream job last wrote this tab. */
  syncedAt: string;
}

export interface AccountInfo {
  name: string;
  id: string;
  platform: Platform;
  objective: CampaignObjective;
  spend: number;
  platformLeads: number | null;
}

export interface CampaignMeta {
  key: string;
  name: string;
  id: string;
  /** Modal course of this campaign's CRM leads. */
  course: string;
  /** Share of the campaign's leads that carry the modal course, 0–1. */
  courseDominance: number;
  platforms: Platform[];
  objective: CampaignObjective;
}

export interface Snapshot {
  /** When the sheet was last pulled *successfully*. Never bumped on failure, so
   *  it cannot report stale data as fresh. */
  fetchedAt: number;
  /** When a pull was last attempted. Drives the TTL, so a sheet that keeps
   *  failing is not re-fetched on every single request. */
  lastAttemptAt: number;
  ads: AdRow[];
  crm: CrmLeadRow[];
  invoiced: InvoicedRow[];
  sales: SalesRow[];
  lost: LostRow[];
  accounts: AccountInfo[];
  campaigns: Map<string, CampaignMeta>;
  /** Display casing for each normalized source key, e.g. "uchat" → "UChat". */
  sourceLabels: Map<string, string>;
  /** Freshest upstream sync across all tabs. Written by the sync jobs, not here. */
  syncedAt: string;
  /** Oldest upstream sync — the one that actually decides how stale the data is. */
  oldestSyncedAt: string;
  /** Per-tab sync times, so a lagging source can be named. */
  tabSyncs: SourceFreshness[];
  adsDateMin: string;
  adsDateMax: string;
  crmDateMin: string;
  crmDateMax: string;
  revenueDateMin: string;
  revenueDateMax: string;
  years: number[];
  health: DataHealth;
  fetchErrors: string[];
}

let cache: Snapshot | null = null;
let inflight: Promise<Snapshot> | null = null;

/* --- primitives ----------------------------------------------------------- */

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const s = String(v)
    .replace(/[,\s$%]/g, "")
    .replace(/[^\d.-]/g, "");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

/**
 * The export mixes ISO timestamps with US slash dates. `Closing Date` arrives as
 * `5/21/2026` and `Date` as `7/13/2026` — month first. Reading those as D/M/Y
 * turns every day past the 12th into an invalid date, which is how close-time
 * silently became NaN. Order is only swapped when the first field cannot be a
 * month, so a genuinely D/M/Y sheet would still parse.
 */
function parseDate(v: unknown): string {
  const s = str(v);
  if (!s) return "";

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const mo = +iso[2];
    const da = +iso[3];
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return "";
    return `${iso[1]}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
  }

  const slash = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (slash) {
    const a = +slash[1];
    const b = +slash[2];
    const y = slash[3].length === 2 ? 2000 + +slash[3] : +slash[3];
    let mo = a;
    let da = b;
    if (a > 12 && b <= 12) {
      mo = b;
      da = a;
    }
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return "";
    return `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
  }

  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return "";
}

function daysBetween(from: string, to: string): number | null {
  if (!from || !to) return null;
  const a = Date.parse(from + "T00:00:00Z");
  const b = Date.parse(to + "T00:00:00Z");
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

export function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * `cleaned Source` holds casing duplicates (`uchat` 458 / `UChat` 1,093) and two
 * spellings of email. Both collapse here so every grouping counts them once.
 */
export function normalizeSource(s: string): string {
  const k = normalizeName(s);
  if (!k) return "";
  if (k === "e-mail") return "email";
  if (k === "whatsapp") return "whatsapp broadcast";
  return k;
}

/** Sources that generate leads but have no spend tab in the sheet. */
const SOURCES_WITHOUT_SPEND = new Set([
  "tiktok",
  "uchat",
  "whatsapp broadcast",
  "chatwoot",
  "website",
  "recommended from customer",
  "recommendation sales",
  "recommendation",
  "phone call",
  "email",
  "cfm landing page",
  "company page",
  "linkedin",
  "telegram",
  "resale old data",
  "recommended from coordination",
]);

/* --- fetch ---------------------------------------------------------------- */

function csvUrl(sheetId: string, tab: string, bust: number): string {
  // gviz serves through Google's CDN, which caches the CSV and ignores a
  // no-cache request header — so a plain refresh keeps returning the old data.
  // A unique query param per fetch forces a fresh copy. gviz ignores unknown
  // params, so this is safe.
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}&_cb=${bust}`;
}

type Raw = Record<string, string>;

async function fetchTab(sheetId: string, tab: string, bust: number): Promise<Raw[]> {
  const res = await fetch(csvUrl(sheetId, tab, bust), {
    headers: { "cache-control": "no-cache", pragma: "no-cache" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to fetch tab "${tab}": ${res.status}`);
  const text = await res.text();
  const parsed = Papa.parse<Raw>(text, {
    header: true,
    skipEmptyLines: true,
    // The CRM header row contains a cell that literally ends in CR ("Date\r").
    // Without this the column is unreachable by name.
    transformHeader: (h) => h.trim(),
  });
  return parsed.data.filter((r) => r && Object.keys(r).length > 0);
}

/* --- account classification ----------------------------------------------- */

/**
 * `Engo soft website` runs traffic campaigns to the site rather than lead forms,
 * and `114732099069544` is a raw account id with no friendly name and zero
 * leads. Both spend real money while producing no CRM leads, so leaving them in
 * the CPL/CPA/ROAS denominators quietly worsens every efficiency number.
 */
function classifyAccount(name: string): CampaignObjective {
  const n = name.trim();
  if (!n) return "unknown";
  if (/^\d+$/.test(n)) return "unknown";
  if (/website|web\s*site/i.test(n)) return "traffic";
  return "leads";
}

/* --- campaign key unification --------------------------------------------- */

/**
 * A campaign must collapse to one key across five tabs. Ids are authoritative,
 * but ~890 CRM rows carry a campaign name with no id, and those would otherwise
 * split into a second phantom campaign. So names seen alongside an id anywhere
 * in the workbook resolve back to that id.
 */
class CampaignKeyResolver {
  private nameToId = new Map<string, string>();

  learn(id: string, name: string) {
    const n = normalizeName(name);
    if (!id || !n) return;
    if (!this.nameToId.has(n)) this.nameToId.set(n, id);
  }

  key(id: string, name: string): string {
    if (id) return `id:${id}`;
    const n = normalizeName(name);
    if (!n) return "";
    const mapped = this.nameToId.get(n);
    return mapped ? `id:${mapped}` : `nm:${n}`;
  }
}

/* --- ad-set resolution ----------------------------------------------------- */

/**
 * `Ad Set Name` is exported empty on every CRM and invoice row, so ad-set
 * performance has to be backfilled from the ads tabs.
 *
 * Ad id is the only safe key: one ad belongs to exactly one ad set. Ad *name* is
 * not unique — 96 of 161 distinct names in this sheet appear under more than one
 * ad set — so a name-only match is a guess. Names are still used as a fallback
 * (they recover rows whose ad id is missing) but ambiguous ones are flagged so
 * the UI can warn instead of pretending the value is solid.
 */
class AdSetIndex {
  private byId = new Map<string, string>();
  private byName = new Map<string, Map<string, number>>();
  private modal = new Map<string, string>();
  private ambiguous = new Set<string>();

  learn(adId: string, adName: string, adset: string) {
    if (!adset) return;
    if (adId) this.byId.set(adId, adset);
    const n = normalizeName(adName);
    if (!n) return;
    let counts = this.byName.get(n);
    if (!counts) {
      counts = new Map();
      this.byName.set(n, counts);
    }
    counts.set(adset, (counts.get(adset) ?? 0) + 1);
  }

  finalize() {
    for (const [name, counts] of this.byName) {
      let top = "";
      let best = 0;
      for (const [set, c] of counts) {
        if (c > best) {
          top = set;
          best = c;
        }
      }
      this.modal.set(name, top);
      if (counts.size > 1) this.ambiguous.add(name);
    }
  }

  resolve(adId: string, adName: string): { adset: string; origin: AdSetOrigin } {
    const hasAd = !!adId || !!normalizeName(adName);
    if (!hasAd) return { adset: "", origin: "none" };

    if (adId) {
      const hit = this.byId.get(adId);
      if (hit) return { adset: hit, origin: "exact" };
    }
    const n = normalizeName(adName);
    if (n) {
      const hit = this.modal.get(n);
      if (hit) return { adset: hit, origin: this.ambiguous.has(n) ? "ambiguous" : "derived" };
    }
    return { adset: "", origin: "unknown" };
  }
}

/* --- load ----------------------------------------------------------------- */

export async function loadAllData(force = false): Promise<Snapshot> {
  if (!force && cache && Date.now() - cache.lastAttemptAt < TTL_MS) return cache;
  // A forced reload must never be handed an in-flight fetch: that request was
  // already sent with an older cache-busting token, so the Refresh button would
  // wait on it and return exactly the stale data the user was trying to escape.
  if (inflight && !force) return inflight;

  const sheetId = process.env.SHEET_ID || DEFAULT_SHEET_ID;

  inflight = (async () => {
    const fetchErrors: string[] = [];
    // One token for the whole load, so all six tabs come from the same fresh
    // pull and bypass Google's CDN cache together.
    const bust = Date.now();
    const safeFetch = (tab: string) =>
      fetchTab(sheetId, tab, bust).catch((e: unknown) => {
        fetchErrors.push(`${tab}: ${e instanceof Error ? e.message : String(e)}`);
        return [] as Raw[];
      });

    const [metaRaw, snapRaw, crmRaw, invRaw, salesRaw, lostRaw] = await Promise.all([
      safeFetch(TAB.meta),
      safeFetch(TAB.snap),
      safeFetch(TAB.crm),
      safeFetch(TAB.invoiced),
      safeFetch(TAB.sales),
      safeFetch(TAB.lost),
    ]);

    /* -- pass 1: learn keys from the ads tabs ----------------------------- */
    const keys = new CampaignKeyResolver();
    const adsets = new AdSetIndex();

    for (const r of metaRaw) {
      keys.learn(str(r["__campaign_id"]), str(r["اسم الكامبين"]));
      adsets.learn(str(r["__ad_id"]), str(r["Ad Name"]), str(r["Ad set name"]));
    }
    for (const r of snapRaw) {
      keys.learn(str(r["__campaign_id"]), str(r["اسم الكامبين"]));
      adsets.learn(str(r["__ad_id"]), str(r["Ad Name"]), str(r["Ad set name"]));
    }
    // CRM and invoices also pair ids with names; learning from them lets a
    // name-only row on one tab join an id-bearing row on another.
    for (const r of crmRaw) keys.learn(str(r["Campaign ID"]), str(r["Campaign Name"]));
    for (const r of invRaw)
      keys.learn(str(r["الفرصة /Campaign ID"]) || str(r["Campaign ID"]), str(r["Campaign Name"]));
    for (const r of lostRaw) keys.learn(str(r["Campaign ID"]), str(r["Campaign Name"]));
    adsets.finalize();

    /* -- ads --------------------------------------------------------------- */
    const objectiveByAccount = new Map<string, CampaignObjective>();

    const meta: AdRow[] = metaRaw.map((r) => {
      const account = str(r["اسم الحساب الإعلاني"]) || str(r["__account_name"]);
      const objective = classifyAccount(account);
      objectiveByAccount.set(account, objective);
      return {
        platform: "meta" as Platform,
        date: parseDate(r["التاريخ"]),
        account,
        accountId: str(r["__account_id"]),
        objective,
        campaign: str(r["اسم الكامبين"]),
        campaignId: str(r["__campaign_id"]),
        campaignKey: keys.key(str(r["__campaign_id"]), str(r["اسم الكامبين"])),
        adset: str(r["Ad set name"]),
        adsetId: str(r["__adset_id"]),
        ad: str(r["Ad Name"]),
        adId: str(r["__ad_id"]),
        spend: num(r["Spend (Cost)"]),
        impressions: num(r["Impressions"]),
        clicksAll: num(r["Clicks (all)"]),
        linkClicks: num(r["Link Clicks"]),
        // The business counts on-Facebook lead-form submissions. `Leads (Total)`
        // adds 16 website/pixel leads that CRM already counts separately.
        platformLeads: num(r["Leads (on facebook Leads)"]),
        viewCompletions: null,
        syncedAt: str(r["__synced_at"]),
      };
    });

    const snap: AdRow[] = snapRaw.map((r) => {
      const account = str(r["اسم الحساب الإعلاني"]) || str(r["__account_name"]);
      const objective = classifyAccount(account);
      const snapLeads = str(r["Leads (Native)"]) || str(r["Leads"]) || str(r["On-Facebook leads"]);
      objectiveByAccount.set(account, objective);
      return {
        platform: "snapchat" as Platform,
        date: parseDate(r["التاريخ"]),
        account,
        accountId: str(r["__account_id"]),
        objective,
        campaign: str(r["اسم الكامبين"]),
        campaignId: str(r["__campaign_id"]),
        campaignKey: keys.key(str(r["__campaign_id"]), str(r["اسم الكامبين"])),
        adset: str(r["Ad set name"]),
        adsetId: str(r["__adset_id"]),
        ad: str(r["Ad Name"]),
        adId: str(r["__ad_id"]),
        spend: num(r["Spend (Cost)"]),
        impressions: num(r["Impressions"]),
        clicksAll: num(r["Clicks (all)"]),
        // Snap reports native lead-form submissions as `native_leads`. Older
        // reference exports called the same measure simply `Leads`.
        linkClicks: null,
        platformLeads: snapLeads ? num(snapLeads) : null,
        viewCompletions: num(r["View Completions"]),
        syncedAt: str(r["__synced_at"]),
      };
    });

    const ads = [...meta, ...snap];

    /* -- CRM --------------------------------------------------------------- */
    const crm: CrmLeadRow[] = crmRaw.map((r) => {
      const createdAt = parseDate(r["أنشئ في"]);
      const closedAt = parseDate(r["التاريخ المقفل"]) || parseDate(r["Closing Date"]);
      const adName = str(r["Ad Name"]);
      const adId = str(r["Ad ID"]);
      const { adset, origin } = adsets.resolve(adId, adName);
      const campaignName = str(r["Campaign Name"]);
      const campaignId = str(r["Campaign ID"]);
      const cleanedStage = str(r["Cleaned Stage"]);
      const source = str(r["cleaned Source"]) || str(r["Source"]);
      return {
        id: str(r["__odoo_id"]),
        createdAt,
        closedAt,
        daysToClose: closedAt ? daysBetween(createdAt, closedAt) : null,
        campaignName,
        campaignId,
        campaignKey: keys.key(campaignId, campaignName),
        adName,
        adId,
        adset,
        adsetOrigin: origin,
        contact: str(r["اسم جهة الاتصال"]),
        salesperson: str(r["Salesperson"]),
        salesTeam: str(r["Sales Team"]),
        subTeam: str(r["فريق المبيعات"]),
        stage: str(r["Stage"]),
        cleanedStage,
        lastStageUpdate: parseDate(r["آخر تحديث للمرحلة"]),
        callingReply: str(r["Calling reply?"]),
        isWon: cleanedStage.toLowerCase() === "won",
        isLost: cleanedStage.toLowerCase() === "lost",
        source,
        sourceKey: normalizeSource(source),
        course: str(r["Course"]),
        mainCategory: str(r["Main Category"]),
        priority: str(r["Priority"]),
        fromCampaign: !!campaignName || !!campaignId,
      };
    });

    /* -- invoiced ---------------------------------------------------------- */
    const invoiced: InvoicedRow[] = invRaw.map((r) => {
      const invoiceDate = parseDate(r["Invoice Date"]);
      // `Invoice Date` is populated on ~8% of rows; `Date` on 100%. Filtering on
      // `Invoice Date` silently drops most of the revenue, so `Date` is the
      // attribution date.
      const revenueDate =
        parseDate(r["Date"]) || parseDate(r["بنود الطلب /أنشئ في"]) || invoiceDate;
      const campaignName = str(r["Campaign Name"]) || str(r["الفرصة /Campaign Name"]);
      const campaignId = str(r["الفرصة /Campaign ID"]) || str(r["Campaign ID"]);
      const adName = str(r["AD Name"]) || str(r["الفرصة /Ad Name"]);
      const adId = str(r["الفرصة /Ad ID"]);
      const { adset, origin } = adsets.resolve(adId, adName);
      const source = str(r["Cleaned Source"]) || str(r["Source"]);
      return {
        orderRef: str(r["بنود الطلب /مرجع الطلب"]),
        campaignName,
        campaignId,
        campaignKey: keys.key(campaignId, campaignName),
        adName,
        adId,
        adset,
        adsetOrigin: origin,
        product: str(r["بنود الطلب /المنتج"]),
        customer: str(r["بنود الطلب /العميل"]),
        course: str(r["Course"]),
        mainCategory: str(r["Main Category"]),
        // Only ~16% of rows carry a team, so this must never be used as a
        // revenue filter on its own — see health.revenueTeamCoverage.
        salesTeam: str(r["Sales Team"]) || str(r["Team"]),
        salesperson: str(r["بنود الطلب /مندوب المبيعات"]),
        source,
        sourceKey: normalizeSource(source),
        invoiceDate,
        revenueDate,
        localTotal: num(r["بنود الطلب /الإجمالي"]),
        // Already USD. The `Value to dolar` tab must never be applied to it.
        usdSales: num(r["$ Sales"]),
      };
    });

    /* -- sales ------------------------------------------------------------- */
    const sales: SalesRow[] = salesRaw.map((r) => {
      const paymentDate = parseDate(r["Payment Date"]);
      return {
        paymentDate,
        invoiceDate: parseDate(r["تاريخ الفاتورة"]),
        orderRef: str(r["Sales Order #"]),
        course: str(r["Course Name"]),
        category: str(r["فئة المنتج"]),
        partner: str(r["الشريك"]),
        salesperson: str(r["Salesperson"]),
        teamLeader: str(r["Team Leader"]),
        salesTeam: str(r["فريق المبيعات"]),
        usdSales: num(r["$ Sales"]),
        currency: str(r["العملة"]),
        eventStage: str(r["Event Stage"]),
        month: paymentDate ? paymentDate.slice(0, 7) : "",
      };
    });

    /* -- lost -------------------------------------------------------------- */
    const lost: LostRow[] = lostRaw.map((r) => {
      const campaignName = str(r["Campaign Name"]);
      const campaignId = str(r["Campaign ID"]);
      const source = str(r["cleaned Source"]) || str(r["المصدر"]);
      return {
        id: str(r["__odoo_id"]),
        contact: str(r["اسم جهة الاتصال"]),
        campaignName,
        campaignId,
        campaignKey: keys.key(campaignId, campaignName),
        adName: str(r["Ad Name"]),
        adId: str(r["Ad ID"]),
        lossReason: str(r["سبب الضياع"]),
        course: str(r["Course"]),
        mainCategory: str(r["Main Category"]),
        salesTeam: str(r["فريق المبيعات"]),
        salesperson: str(r["مندوب المبيعات"]),
        source,
        sourceKey: normalizeSource(source),
        stage: str(r["Cleaned Stage"]),
        createdAt: parseDate(r["أنشئ في"]),
      };
    });

    /* -- accounts ---------------------------------------------------------- */
    const acctMap = new Map<string, AccountInfo>();
    for (const a of ads) {
      let e = acctMap.get(a.account);
      if (!e) {
        e = {
          name: a.account,
          id: a.accountId,
          platform: a.platform,
          objective: a.objective,
          spend: 0,
          platformLeads: null,
        };
        acctMap.set(a.account, e);
      }
      e.spend += a.spend;
      if (a.platformLeads !== null) e.platformLeads = (e.platformLeads ?? 0) + a.platformLeads;
    }
    const accounts = [...acctMap.values()].sort((x, y) => y.spend - x.spend);

    /* -- campaign → course inference --------------------------------------- */
    // Ads tabs carry no course, so spend rolls up to a course through the modal
    // course of the campaign's CRM leads. Dominance is kept so the UI can say how
    // confident that inference is (it averages ~99% here).
    const courseCounts = new Map<string, Map<string, number>>();
    for (const c of crm) {
      if (!c.campaignKey || !c.course) continue;
      let m = courseCounts.get(c.campaignKey);
      if (!m) {
        m = new Map();
        courseCounts.set(c.campaignKey, m);
      }
      m.set(c.course, (m.get(c.course) ?? 0) + 1);
    }

    const campaigns = new Map<string, CampaignMeta>();
    const touchCampaign = (key: string, name: string, id: string, platform?: Platform) => {
      if (!key) return;
      let e = campaigns.get(key);
      if (!e) {
        e = {
          key,
          name,
          id,
          course: "",
          courseDominance: 0,
          platforms: [],
          objective: "unknown",
        };
        campaigns.set(key, e);
      }
      if (!e.name && name) e.name = name;
      if (!e.id && id) e.id = id;
      if (platform && !e.platforms.includes(platform)) e.platforms.push(platform);
    };

    for (const a of ads) {
      touchCampaign(a.campaignKey, a.campaign, a.campaignId, a.platform);
      const e = campaigns.get(a.campaignKey);
      if (e && e.objective === "unknown") e.objective = a.objective;
    }
    for (const c of crm) touchCampaign(c.campaignKey, c.campaignName, c.campaignId);
    for (const i of invoiced) touchCampaign(i.campaignKey, i.campaignName, i.campaignId);
    for (const l of lost) touchCampaign(l.campaignKey, l.campaignName, l.campaignId);

    for (const [key, counts] of courseCounts) {
      const e = campaigns.get(key);
      if (!e) continue;
      let top = "";
      let best = 0;
      let total = 0;
      for (const [course, n] of counts) {
        total += n;
        if (n > best) {
          top = course;
          best = n;
        }
      }
      e.course = top;
      e.courseDominance = total > 0 ? best / total : 0;
    }

    /* -- source display labels --------------------------------------------- */
    const labelCounts = new Map<string, Map<string, number>>();
    const noteLabel = (key: string, raw: string) => {
      if (!key || !raw) return;
      let m = labelCounts.get(key);
      if (!m) {
        m = new Map();
        labelCounts.set(key, m);
      }
      m.set(raw, (m.get(raw) ?? 0) + 1);
    };
    for (const c of crm) noteLabel(c.sourceKey, c.source);
    for (const i of invoiced) noteLabel(i.sourceKey, i.source);
    const sourceLabels = new Map<string, string>();
    for (const [key, m] of labelCounts) {
      let top = "";
      let best = 0;
      for (const [raw, n] of m) {
        if (n > best) {
          top = raw;
          best = n;
        }
      }
      sourceLabels.set(key, top);
    }

    /* -- ranges ------------------------------------------------------------- */
    const range = (vals: string[]) => {
      const s = vals.filter(Boolean).sort();
      return { min: s[0] ?? "", max: s[s.length - 1] ?? "" };
    };
    const adsRange = range(ads.map((a) => a.date));
    const crmRange = range(crm.map((c) => c.createdAt));
    const revRange = range(invoiced.map((i) => i.revenueDate));

    const yearSet = new Set<number>();
    for (const d of [
      ...ads.map((a) => a.date),
      ...crm.map((c) => c.createdAt),
      ...invoiced.map((i) => i.revenueDate),
      ...sales.map((s) => s.paymentDate),
    ]) {
      if (d) yearSet.add(+d.slice(0, 4));
    }
    const years = [...yearSet].filter((y) => y > 2000).sort();

    /* -- per-source freshness ---------------------------------------------- */
    // Each tab is filled by its own upstream job, and they run on different
    // schedules — the ads sync can be hours behind while Odoo is minutes old.
    // Reporting one blended "last synced" hid that: the badge read the ads tabs
    // only and called the whole dashboard stale while CRM was 24 minutes fresh.
    //
    // Note these timestamps describe when the *sheet* was last filled from the
    // sources. Nothing in this app can move them; the Refresh button only
    // controls how recently we pulled the sheet itself (`fetchedAt`).
    const maxOf = (rows: Raw[], col: string): string => {
      let max = "";
      for (const r of rows) {
        const v = str(r[col]);
        if (v && v > max) max = v;
      }
      return max;
    };
    // Odoo exports a local-looking "YYYY-MM-DD HH:MM:SS" with no zone marker;
    // it is UTC, so it is normalised here rather than being read as local time.
    const asIso = (v: string): string => {
      if (!v) return "";
      if (v.includes("T")) return v;
      const d = Date.parse(v.replace(" ", "T") + "Z");
      return isFinite(d) ? new Date(d).toISOString() : "";
    };

    const tabSyncs: SourceFreshness[] = [
      { key: "meta", label: TAB.meta, syncedAt: maxOf(metaRaw, "__synced_at") },
      { key: "snap", label: TAB.snap, syncedAt: maxOf(snapRaw, "__synced_at") },
      { key: "crm", label: TAB.crm, syncedAt: asIso(maxOf(crmRaw, "__odoo_write_date")) },
      { key: "invoiced", label: TAB.invoiced, syncedAt: asIso(maxOf(invRaw, "__odoo_write_date")) },
      { key: "sales", label: TAB.sales, syncedAt: asIso(maxOf(salesRaw, "__odoo_write_date")) },
      { key: "lost", label: TAB.lost, syncedAt: asIso(maxOf(lostRaw, "__odoo_write_date")) },
    ].filter((s) => !!s.syncedAt);

    // The headline stays the freshest source, but `sources` carries the detail so
    // a single lagging tab can be named instead of condemning everything.
    let syncedAt = "";
    for (const s of tabSyncs) if (s.syncedAt > syncedAt) syncedAt = s.syncedAt;
    let oldestSyncedAt = "";
    for (const s of tabSyncs)
      if (!oldestSyncedAt || s.syncedAt < oldestSyncedAt) oldestSyncedAt = s.syncedAt;

    /* -- health ------------------------------------------------------------- */
    const adCampaignKeys = new Set(ads.map((a) => a.campaignKey).filter(Boolean));

    const countOrigin = (o: AdSetOrigin) =>
      crm.filter((c) => c.adsetOrigin === o).length +
      invoiced.filter((i) => i.adsetOrigin === o).length;
    const adsetExact = countOrigin("exact");
    const adsetDerived = countOrigin("derived");
    const adsetAmbiguous = countOrigin("ambiguous");
    const adsetUnknown = countOrigin("unknown");
    const adsetNoAd = countOrigin("none");
    const adBearing = adsetExact + adsetDerived + adsetAmbiguous + adsetUnknown;

    const totalRevenue = invoiced.reduce((s, r) => s + r.usdSales, 0);
    const campaignRevenueRows = invoiced.filter((r) => !!r.campaignKey);
    const campaignRevenue = campaignRevenueRows.reduce((s, r) => s + r.usdSales, 0);
    const attributedRevenue = invoiced
      .filter((r) => r.campaignKey && adCampaignKeys.has(r.campaignKey))
      .reduce((s, r) => s + r.usdSales, 0);

    const crmWithCampaign = crm.filter((c) => c.fromCampaign);
    const crmMatched = crmWithCampaign.filter((c) => adCampaignKeys.has(c.campaignKey));

    const unpricedCounts = new Map<string, number>();
    for (const c of crm) {
      if (c.sourceKey && SOURCES_WITHOUT_SPEND.has(c.sourceKey)) {
        unpricedCounts.set(c.sourceKey, (unpricedCounts.get(c.sourceKey) ?? 0) + 1);
      }
    }
    const unpricedSources = [...unpricedCounts.entries()]
      .map(([label, count]) => ({ label: sourceLabels.get(label) ?? label, count }))
      .sort((a, b) => b.count - a.count);

    const closable = crm.filter((c) => c.daysToClose !== null && c.daysToClose >= 0);
    const negativeRows = invoiced.filter((r) => r.usdSales < 0);

    const health: DataHealth = {
      crmRows: crm.length,
      invoicedRows: invoiced.length,
      salesRows: sales.length,
      lostRows: lost.length,
      adRows: ads.length,
      adsetExact,
      adsetDerived,
      adsetAmbiguous,
      adsetUnknown,
      adsetNoAd,
      adsetResolutionRate:
        adBearing > 0 ? (adsetExact + adsetDerived + adsetAmbiguous) / adBearing : 0,
      crmAdCoverage: crm.length > 0 ? crm.filter((c) => c.adName || c.adId).length / crm.length : 0,
      invoicedAdCoverage:
        invoiced.length > 0
          ? invoiced.filter((i) => i.adName || i.adId).length / invoiced.length
          : 0,
      revenueCampaignCoverage:
        invoiced.length > 0 ? campaignRevenueRows.length / invoiced.length : 0,
      revenueCampaignShare: totalRevenue > 0 ? campaignRevenue / totalRevenue : 0,
      attributedRevenueShare: totalRevenue > 0 ? attributedRevenue / totalRevenue : 0,
      campaignMatchRate:
        crmWithCampaign.length > 0 ? crmMatched.length / crmWithCampaign.length : 0,
      leadsWithoutSpendSource: [...unpricedCounts.values()].reduce((a, b) => a + b, 0),
      unpricedSources,
      closeSample: closable.length,
      closeCoverage: crm.length > 0 ? closable.length / crm.length : 0,
      invoicedMissingDate: invoiced.filter((i) => !i.revenueDate).length,
      crmMissingDate: crm.filter((c) => !c.createdAt).length,
      salesMissingDate: sales.filter((s) => !s.paymentDate).length,
      negativeRevenueRows: negativeRows.length,
      negativeRevenue: negativeRows.reduce((s, r) => s + r.usdSales, 0),
    };

    return {
      fetchedAt: Date.now(),
      lastAttemptAt: Date.now(),
      ads,
      crm,
      invoiced,
      sales,
      lost,
      accounts,
      campaigns,
      sourceLabels,
      syncedAt,
      oldestSyncedAt,
      tabSyncs,
      adsDateMin: adsRange.min,
      adsDateMax: adsRange.max,
      crmDateMin: crmRange.min,
      crmDateMax: crmRange.max,
      revenueDateMin: revRange.min,
      revenueDateMax: revRange.max,
      years,
      health,
      fetchErrors,
    };
  })();

  const previous = cache;
  try {
    const next = await inflight;
    // If every tab failed but a good snapshot is still held, keep serving the
    // stale one rather than blanking the dashboard.
    const empty =
      !next.ads.length && !next.crm.length && !next.invoiced.length && !next.sales.length;
    if (empty && previous) {
      // Back off before retrying, but leave `fetchedAt` alone — bumping it here
      // is what made a failed reload report the old snapshot as freshly loaded.
      previous.lastAttemptAt = Date.now();
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

export { parseDate, daysBetween, SOURCES_WITHOUT_SPEND };
