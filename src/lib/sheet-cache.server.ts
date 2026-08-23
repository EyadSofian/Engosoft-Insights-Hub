// Server-only: sheet fetch, parse, normalize, cache.
//
// Everything that makes a number right or wrong happens in this file. The sheet
// is an Odoo/ads export with several traps that are easy to reintroduce:
// header keys carry stray carriage returns, slash dates are US-ordered, ad names
// are not unique, and two of the tabs describe overlapping-but-different
// populations. Each guard below is load-bearing; see README "Things that are
// easy to get wrong here" before simplifying any of them.
import Papa from "papaparse";
import { loadDirectCrm, type CrmExclusionDiagnostics, type CrmRawRow } from "./crm-odoo.server";
import { loadDirectAccounting, type DirectAccountingSnapshot } from "./accounting-odoo.server";
import {
  authoritativeAccountingUsd,
  directAccountingPassesCompletenessGate,
} from "./accounting-authority";
import { accountingReportingDate, signedCreditAmount } from "./accounting-policy";
import {
  legacyAdCourseValue,
  legacyAdLeadValue,
  legacyAdPlatform,
  lockedLegacyAccountingUsd,
} from "./legacy-datasets";
import { odooConfigured } from "./odoo.server";
import { fetchGoogleAds } from "./google-ads.server";
import { fetchTikTokAds } from "./tiktok.server";
import {
  canonicalCourseValue,
  courseFromMarketingName,
  isKnownCourse,
  mainCategoryForCourse,
} from "./course-taxonomy";
import { isArchivedWonStage } from "./archived-won";
import { decideSnapshotRead } from "./snapshot-freshness";
import { datasetFreshnessAlerts, type StoredDatasetState } from "./dataset-freshness";
import { PLATFORM_SOURCE_KEYS } from "./acquisition-channel";
import { isWebsiteCampaignName, isWebsiteConversionCampaignName } from "./campaign-purpose";
export { isWebsiteCampaignName, isWebsiteConversionCampaignName } from "./campaign-purpose";
import {
  databaseConfigured,
  readDashboardDataset,
  readDashboardDatasets,
  writeDashboardDataset,
  type DashboardDataset,
  type DatasetSnapshot,
} from "./dashboard-db.server";
import type {
  AdRow,
  AdSetOrigin,
  AccountingRow,
  CampaignObjective,
  CampaignOperationalState,
  CrmLeadRow,
  DataHealth,
  InvoicedRow,
  LostRow,
  Platform,
  WebsiteSaleRow,
} from "./types";

const DEFAULT_SHEET_ID = "14kv8Xkv8SeFhF9roekDI0OKmpZBU29YQOlMj03LOKT0";
// The ad workflows write daily rows independently of this process. Keeping the
// old 30-minute snapshot made a successful Meta/Snap run look stalled and led
// operators to run n8n again. Five minutes keeps the shared sheet/Odoo load
// bounded while allowing scheduled syncs to appear without manual intervention.
const TTL_MS = 5 * 60 * 1000;
// Odoo CRM/Lost is a full-history export followed by two full PostgreSQL
// replaces. It is an upstream sync, not a page read, and does not belong on the
// five-minute in-memory snapshot cadence.
const DIRECT_ODOO_REFRESH_MS = 30 * 60 * 1000;

const TAB = {
  meta: "Meta Ads Daily",
  snap: "Snap Ads Daily",
  // Not in the workbook yet. TikTok spends real money and produces thousands of
  // CRM leads, so it is read optionally: the moment the tab exists with the same
  // columns as Meta it starts counting, and until then its absence is reported
  // as a named data-health gap instead of silently flattering every ratio.
  tiktok: "TikTok Ads Daily",
  crm: "CRM Leads",
  invoiced: "Full Invoiced Orders",
  accounting: "Accounting",
  /** Temporary read fallback while the upstream workflow migrates its tab. */
  legacySales: "Sales",
  websiteSales: "Website Sales",
  lost: "Lost Analysis",
} as const;

/** Tabs that may legitimately be absent. A miss is a gap, not a fetch failure. */
const OPTIONAL_TABS = new Set<string>([TAB.tiktok]);

const LOST_SHEET_GID = "1314891021";

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
  /** Course named by the campaign, or the modal course of its CRM leads. */
  course: string;
  /** How the campaign-level course was identified. Ad/ad-set names are handled per ad row. */
  courseSource: "" | "campaign_name" | "crm_leads";
  /** Confidence of the campaign-level inference, 0–1. */
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
  /** Latest operational campaign snapshot, kept out of historical ad facts. */
  campaignStates: CampaignOperationalState[];
  crm: CrmLeadRow[];
  invoiced: InvoicedRow[];
  accounting: AccountingRow[];
  /** @deprecated Compatibility alias for `accounting`. */
  sales: AccountingRow[];
  websiteSales: WebsiteSaleRow[];
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
  /** Tabs served from the last good copy because this pull failed or came back
   *  empty. The numbers are usable but not current for these tabs. */
  staleTabs: string[];
}

let cache: Snapshot | null = null;
let inflight: Promise<Snapshot> | null = null;
let inflightStartedAt = 0;
let cacheRevision = 0;

/**
 * How long a snapshot may keep being served past its TTL while the refresh runs
 * behind the request.
 *
 * Past this the wait is taken instead of the number. Serving a stale snapshot
 * is the right trade for a few minutes; quietly reporting half-hour-old
 * collections on an accounting dashboard is not.
 */
const MAX_STALE_MS = 30 * 60 * 1000;

/**
 * After this a running refresh is treated as stuck and a new one may start.
 *
 * Nothing in the read path has a timeout, so without this a single hung
 * PostgreSQL query would freeze the data permanently: `inflight` would never
 * clear, no later request could ever start another load, and every page would
 * go on serving the same snapshot with nothing on screen to say so.
 */
const REFRESH_STUCK_MS = 2 * 60 * 1000;

/**
 * Make newly-ingested batches visible without turning the next visitor into a
 * cold-start victim. A warm snapshot is marked stale and refreshed behind the
 * request; only a genuinely cold process has to wait.
 */
export function invalidateDataCache(): void {
  cacheRevision += 1;
  if (cache) cache = { ...cache, lastAttemptAt: Date.now() - TTL_MS };
}
/**
 * Last successful raw rows per tab. A tab that fails or comes back empty is
 * served from here rather than as an empty array, so one bad read cannot blank
 * a page. Raw rather than parsed, because the parse depends on rows from other
 * tabs (campaign ids, ad-set names) and must be redone for the whole workbook.
 */
const lastGoodRaw = new Map<string, Raw[]>();

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
 * Return the first populated value without treating numeric zero as missing.
 * Financial exports legitimately contain zero-value lines, so `a || b` is not
 * safe for choosing between equivalent headers.
 */
function firstPresent(...values: unknown[]): unknown {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (String(value).trim() === "") continue;
    return value;
  }
  return "";
}

const USD_RATE: Record<string, number> = {
  EGP: 1 / 50.5,
  SAR: 1 / 3.7453,
  AED: 0.27,
  USD: 1,
};

function usdValue(explicit: unknown, totalInCurrency: unknown, currency: unknown): number {
  if (str(explicit) !== "") return num(explicit);
  return num(totalInCurrency) * (USD_RATE[str(currency).toUpperCase()] ?? 0);
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
 * The course a campaign / ad-set / ad name declares, or `""` when it declares
 * none. Ads carry no course column on every feed, so the name is the only
 * signal available for those rows.
 *
 * Resolution lives in `course-taxonomy.ts`; see the note at the top of that file
 * for why the course is read off the *leading* token rather than searched for
 * anywhere in the string, and why a bare `auto` is no longer a course token.
 */
export function knownCourseFromText(...values: unknown[]): string {
  for (const value of values) {
    const course = courseFromMarketingName(str(value));
    if (course) return course;
  }
  return "";
}

/**
 * Shared course key across CRM, Lost, paid invoices and sales orders.
 * Unknown courses retain their real source value; they are never hidden under
 * a generic "Other" bucket.
 */
function canonicalCourse(...values: unknown[]): string {
  return canonicalCourseValue(values[0], ...values.slice(1));
}

/**
 * The course column on an ads feed, accepted only when it names a course we
 * recognise. Ads have a campaign name to fall back on, so a spreadsheet error
 * is better dropped than turned into a course carrying a real budget.
 */
function adCourseHint(raw: unknown): string {
  const course = canonicalCourse(raw);
  return isKnownCourse(course) ? course : "";
}

function canonicalMainCategory(
  raw: unknown,
  course: string,
  productCategory: unknown = "",
): string {
  const explicit = str(raw);
  if (explicit) return explicit;
  // The workbook's Courses tab assigns a Main Category per course; that mapping
  // is transcribed once, in the taxonomy module, rather than restated here.
  const known = mainCategoryForCourse(course);
  if (known) return known;
  const category = normalizeName(str(productCategory));
  if (category.includes("non-engineering")) return "Non-Engineering";
  if (category.includes("engineering")) return "Engineering";
  return "";
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

/**
 * Stages that must never enter the reportable lead population, whichever tab
 * they arrive on. Compared against the lower-cased `Cleaned Stage`.
 *
 * `lost` — the business definition of a loss is an archived opportunity, and
 *   those live in Lost Analysis. A CRM row carrying stage Lost is the same deal
 *   counted twice. The upstream sync is supposed to withhold these rows, but it
 *   has shipped them twice now (4,227 reappeared on 2026-07-27), so the guard
 *   lives here as well: one wrong workflow edit must not move a headline number.
 * `old auto dialer` — automated dialler residue, not commercial leads. Excluded
 *   from the total on the data analyst's instruction.
 */
const EXCLUDED_STAGES = new Set(["lost", "old auto dialer"]);

function isExcludedCrmStage(stage: string): boolean {
  const normalized = normalizeName(stage)
    .replace(/[_–—/\\().?:]+/g, " ")
    .replace(/\s+/g, " ");
  if (EXCLUDED_STAGES.has(normalized)) return true;
  if (normalized === "closed lost" || normalized === "close lost") return true;
  if (/(^|\s)lost($|\s)/.test(normalized)) return true;
  return /مفقود|خاسر|ضائع|خسارة/.test(normalized);
}

/**
 * The same rule on the archived side, minus `lost` — every Lost Analysis row is
 * archived by definition, so excluding stage `lost` there would delete the
 * population it exists to describe.
 */
const EXCLUDED_ARCHIVED_STAGES = new Set(["old auto dialer"]);

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
  // The Google Visualization endpoint omits rows hidden by a sheet filter.
  // Lost Analysis is an audit population, so it must include every sheet row.
  // The standard CSV export includes hidden rows and reconciles with the
  // authenticated Google Sheets API used by n8n.
  if (tab === TAB.lost) {
    return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${LOST_SHEET_GID}&_cb=${bust}`;
  }

  // gviz serves through Google's CDN, which caches the CSV and ignores a
  // no-cache request header — so a plain refresh keeps returning the old data.
  // A unique query param per fetch forces a fresh copy. gviz ignores unknown
  // params, so this is safe.
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}&_cb=${bust}`;
}

type Raw = Record<string, string>;

const ACCOUNTING_VOLATILE_FIELDS = new Set([
  "__odoo_write_date",
  "__synced_at",
  "Synced At",
  "Last Sync",
]);

function accountingMovement(row: Raw): string {
  return str(firstPresent(row["Move"], row["Movement"], row["حركة"]));
}

function accountingMoveType(row: Raw): string {
  return normalizeName(
    str(
      firstPresent(row["Move Type"], row["move_type"], row["__odoo_move_type"], row["نوع الحركة"]),
    ),
  );
}

function accountingExplicitLineId(row: Raw): string {
  return str(
    firstPresent(
      row["__odoo_line_id"],
      row["Invoice Line ID"],
      row["Move Line ID"],
      row["Line ID"],
    ),
  );
}

function accountingStableLineId(row: Raw): string {
  return accountingExplicitLineId(row) || str(row["__odoo_id"]);
}

function accountingLineIdentity(row: Raw): string {
  return [
    accountingMovement(row),
    str(firstPresent(row["Product ID"], row["المنتج /ID"])),
    str(firstPresent(row["Product Code"], row["Product Reference"], row["الرقم المرجعي"])),
    str(firstPresent(row["Product"], row["المنتج"], row["Course Name"], row["Course"])),
  ].join("\u001f");
}

/** Detect Odoo customer credit notes so they can be signed and dated correctly. */
function isAccountingRefund(row: Raw): boolean {
  const movement = accountingMovement(row);
  const moveType = accountingMoveType(row);
  return (
    /^RINV/i.test(movement) ||
    moveType === "out_refund" ||
    moveType === "refund" ||
    moveType === "credit note" ||
    moveType === "customer credit note" ||
    moveType.includes("إشعار دائن")
  );
}

/**
 * Full business-row fingerprint used only when the export has no trustworthy
 * line id. Including every non-volatile populated column preserves legitimate
 * repeated products whenever quantity, amount, order, event, attribution or
 * another business dimension differs; it is deliberately much stricter than
 * the unsafe old `Move + Product` fallback.
 */
function accountingComposite(row: Raw): string {
  return Object.keys(row)
    .filter((key) => !ACCOUNTING_VOLATILE_FIELDS.has(key) && str(row[key]) !== "")
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${key}=${str(row[key])}`)
    .join("\u001f");
}

interface CanonicalAccountingRows {
  rows: Raw[];
  refundRowsExcluded: number;
  creditNoteRowsIncluded: number;
  duplicateRowsExcluded: number;
}

/**
 * Canonicalise before both completeness comparison and parsing. The two-pass
 * id check protects exports where `__odoo_id` unexpectedly identifies an
 * invoice rather than an invoice line: an id that maps to different business
 * rows is demoted to the full composite instead of collapsing its products.
 */
function canonicalizeAccountingRows(input: Raw[]): CanonicalAccountingRows {
  const composites = input.map(accountingComposite);
  const identitiesByGenericId = new Map<string, Set<string>>();

  input.forEach((row) => {
    if (accountingExplicitLineId(row)) return;
    const id = str(row["__odoo_id"]);
    if (!id) return;
    let identities = identitiesByGenericId.get(id);
    if (!identities) {
      identities = new Set<string>();
      identitiesByGenericId.set(id, identities);
    }
    identities.add(accountingLineIdentity(row));
  });

  const selected = new Map<string, { row: Raw; writeDate: string }>();
  input.forEach((row, index) => {
    const id = accountingStableLineId(row);
    const explicitLineId = accountingExplicitLineId(row);
    const idIsLineLevel = !!explicitLineId || (!!id && identitiesByGenericId.get(id)?.size === 1);
    const key = idIsLineLevel ? `id:${id}` : `row:${composites[index]}`;
    const writeDate = str(row["__odoo_write_date"]);
    const prior = selected.get(key);
    if (!prior) {
      selected.set(key, { row, writeDate });
      return;
    }
    // A duplicate id can be an older snapshot of the same Odoo line. Prefer
    // the newest write timestamp; when neither row is timestamped, retain the
    // first deterministic occurrence.
    if (writeDate && (!prior.writeDate || writeDate > prior.writeDate)) {
      selected.set(key, { row, writeDate });
    }
  });
  const rows = [...selected.values()].map((entry) => entry.row);

  return {
    rows,
    refundRowsExcluded: 0,
    creditNoteRowsIncluded: rows.filter(isAccountingRefund).length,
    duplicateRowsExcluded: input.length - rows.length,
  };
}

/**
 * True when `rows` genuinely look like an ads-tab export rather than another
 * tab gviz served in its place (see `safeFetch`). Content-based rather than
 * position-based: gviz's fallback target is whichever tab sits first in the
 * workbook, which is an accident of sheet order, not a guarantee.
 */
function looksLikeAdsExport(rows: Raw[]): boolean {
  if (!rows.length) return true;
  const header = new Set(Object.keys(rows[0]));
  const hasAdsColumn = ["Spend (Cost)", "Cost", "Spend", "Impressions"].some((c) => header.has(c));
  const hasCrmOnlyColumn = ["Cleaned Stage", "سبب الضياع", "__odoo_write_date"].some((c) =>
    header.has(c),
  );
  return hasAdsColumn && !hasCrmOnlyColumn;
}

/**
 * gviz returns the workbook's first tab when a requested tab does not exist.
 * Require both an invoice identifier and the accounting date/value dimensions
 * before accepting a response as Accounting (or its legacy Sales fallback).
 */
function looksLikeAccountingExport(rows: Raw[]): boolean {
  if (!rows.length) return true;
  const header = new Set(Object.keys(rows[0]));
  const hasMove = ["Move", "Movement", "حركة", "__odoo_id", "__odoo_line_id"].some((c) =>
    header.has(c),
  );
  const hasPaymentDate = ["Payment Date", "Payment date", "تاريخ الدفع"].some((c) => header.has(c));
  const hasPaidValue = [
    "USD Paid",
    "$ paid",
    "$ Paid",
    "$ Sales",
    "Total in Currency",
    "الإجمالي بالعملة",
  ].some((c) => header.has(c));
  return hasMove && hasPaymentDate && hasPaidValue;
}

/** Attempts per tab. Google drops roughly one request in a burst of seven. */
const FETCH_ATTEMPTS = 3;
const RETRY_BASE_MS = 400;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchOnce(sheetId: string, tab: string, bust: number): Promise<Raw[]> {
  const res = await fetch(csvUrl(sheetId, tab, bust), {
    headers: { "cache-control": "no-cache", pragma: "no-cache" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

/**
 * Google serves these CSVs best-effort. Pulling seven tabs at once reliably
 * loses one to a dropped connection or a rate limit, and a single lost tab used
 * to blank a whole page for the length of the cache TTL. Each tab now gets its
 * own retries with a widening gap; only a tab that fails every attempt is
 * reported as failed.
 */
async function fetchTab(sheetId: string, tab: string, bust: number): Promise<Raw[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      return await fetchOnce(sheetId, tab, bust + attempt);
    } catch (e) {
      lastError = e;
      if (attempt < FETCH_ATTEMPTS) await sleep(RETRY_BASE_MS * attempt);
    }
  }
  throw new Error(
    `Failed to fetch tab "${tab}" after ${FETCH_ATTEMPTS} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
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

function classifyCampaign(name: string, account: string): CampaignObjective {
  if (isWebsiteConversionCampaignName(name)) {
    return "website_conversion";
  }
  return classifyAccount(account);
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

/**
 * The snapshot every server-side computation reads.
 *
 * Refreshing it is expensive in a way the aggregation on top of it is not.
 * Every dataset is stored one `jsonb` row per record and read whole — 18,405
 * rows and ~28 MB for CRM alone, before the other ten datasets — while the
 * aggregation that follows costs tens of milliseconds.
 *
 * That refresh used to run *inside* whichever request first arrived after the
 * TTL expired. One visitor per five-minute window therefore paid for the entire
 * reload while everyone else was served from memory instantly. That is the
 * "the page hangs sometimes" report: not a slow page, a slow request landing on
 * an unlucky user at random.
 *
 * So a stale snapshot is served immediately and the refresh runs behind it.
 * Nobody waits for data already in memory, and the next request gets the fresh
 * copy. `force` — the Refresh button — still waits, because seeing the new
 * numbers is the entire point of pressing it.
 */
export async function loadAllData(force = false): Promise<Snapshot> {
  const now = Date.now();
  const action = decideSnapshotRead(
    {
      hasCache: cache !== null,
      cacheAgeMs: cache ? now - cache.lastAttemptAt : Number.POSITIVE_INFINITY,
      refreshRunning: inflight !== null,
      refreshAgeMs: inflight ? now - inflightStartedAt : 0,
      force,
    },
    { ttlMs: TTL_MS, maxStaleMs: MAX_STALE_MS, stuckRefreshMs: REFRESH_STUCK_MS },
  );

  if (action === "serve-cached" && cache) return cache;
  if (action === "serve-cached-refresh-behind" && cache) {
    // Nothing awaits this promise, so its rejection has to be swallowed here or
    // it surfaces as an unhandled rejection. A failed background refresh leaves
    // the previous snapshot standing, exactly as a failed foreground one does,
    // and still reports itself through `fetchErrors`.
    void refreshSnapshot(false).catch(() => {});
    return cache;
  }
  if (action === "join-refresh" && inflight) return inflight;
  return refreshSnapshot(force);
}

async function refreshSnapshot(refreshRemoteSources: boolean): Promise<Snapshot> {
  const sheetId = process.env.SHEET_ID || DEFAULT_SHEET_ID;
  const revisionAtStart = cacheRevision;

  inflightStartedAt = Date.now();
  inflight = (async () => {
    const fetchErrors: string[] = [];
    const staleTabs: string[] = [];
    // One token for the whole load, so all tabs come from the same fresh
    // pull and bypass Google's CDN cache together.
    const bust = Date.now();

    // Every stored dataset that was read, so their sync ages can be judged
    // together once all reads have landed.
    const storedStates: StoredDatasetState[] = [];
    const readStored = async (dataset: DashboardDataset): Promise<DatasetSnapshot | null> => {
      try {
        const snapshot = await readDashboardDataset(dataset);
        storedStates.push({
          dataset,
          status: snapshot.status,
          syncedAt: snapshot.syncedAt,
          error: snapshot.error,
        });
        return snapshot;
      } catch {
        fetchErrors.push(`PostgreSQL ${dataset}: last-good read failed.`);
        return null;
      }
    };
    // Read durable sources first. Once a dataset has landed in PostgreSQL its
    // Google tab is no longer fetched at all; Sheets remains a migration-only
    // bootstrap for installations that have not run the new n8n path yet.
    const storedDatasets = [
      "meta_ads",
      "snap_ads",
      "accounting",
      "accounting_legacy",
      "ads_legacy",
      "crm",
      "lost",
      "invoiced",
      "website_sales",
    ] as const;
    let storedSnapshots: Array<DatasetSnapshot | null>;
    try {
      storedSnapshots = await readDashboardDatasets(storedDatasets);
      for (const snapshot of storedSnapshots) {
        if (!snapshot) continue;
        storedStates.push({
          dataset: snapshot.dataset,
          status: snapshot.status,
          syncedAt: snapshot.syncedAt,
          error: snapshot.error,
        });
      }
    } catch {
      // Preserve the old per-dataset isolation as a recovery path. The common
      // healthy path is two queries total; a partial database fault can still
      // recover whichever datasets remain readable.
      storedSnapshots = await Promise.all(storedDatasets.map(readStored));
    }
    const storedByDataset = new Map(
      storedSnapshots
        .filter((snapshot): snapshot is DatasetSnapshot => snapshot !== null)
        .map((snapshot) => [snapshot.dataset, snapshot]),
    );
    const [
      metaStored,
      snapStored,
      accountingStored,
      accountingLegacyStored,
      adsLegacyStored,
      crmStored,
      lostStored,
      invoicedStored,
      websiteSalesStored,
    ] = storedDatasets.map((dataset) => storedByDataset.get(dataset) ?? null);

    /**
     * A tab is only allowed to reach the parser as empty when it has *never*
     * held rows. Otherwise an empty read is treated as a failed read and the
     * last good copy is served instead.
     *
     * Both failure modes this guards against are real and observed: a dropped
     * request (the tab throws) and a read that lands while the upstream job is
     * mid-rewrite — it clears the tab, writes the new snapshot, and anything
     * fetched in between returns 200 with zero rows. Without this, one unlucky
     * read blanked a page for the full 30-minute TTL.
     */
    const safeFetch = async (
      tab: string,
      // gviz does not error on an unknown `sheet=` name — verified directly:
      // a nonexistent tab returns HTTP 200 with the workbook's *first* tab's
      // rows instead. A tab that has never been created (TikTok Ads Daily,
      // today) must not be mistaken for whatever tab happens to sit first, so
      // an optional caller supplies a shape check the rows must pass before
      // they are trusted or cached.
      isExpectedShape: (rows: Raw[]) => boolean = () => true,
    ): Promise<Raw[]> => {
      // Keyed by workbook too: pointing SHEET_ID at a different sheet must not
      // resurrect rows from the previous one.
      const cacheKey = `${sheetId}::${tab}`;
      const previous = lastGoodRaw.get(cacheKey);
      try {
        const rows = await fetchTab(sheetId, tab, bust);
        if (rows.length > 0 && isExpectedShape(rows)) {
          lastGoodRaw.set(cacheKey, rows);
          return rows;
        }
        if (rows.length > 0) {
          // Rows arrived but from the wrong tab. A tab that has never existed
          // correctly is not "gone stale", and misrouted rows must never enter
          // the last-good cache — caching them would keep serving another
          // tab's data back as this one's on every future empty/failed read.
          return [];
        }
        if (previous?.length) {
          staleTabs.push(tab);
          return previous;
        }
        return rows;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (previous?.length) {
          staleTabs.push(tab);
          return previous;
        }
        // An optional tab that does not exist yet is a known gap, reported
        // through data health. Raising it as a fetch error would paint a red
        // banner across every page for a tab nobody has created yet.
        if (!OPTIONAL_TABS.has(tab)) fetchErrors.push(`${tab}: ${message}`);
        return [];
      }
    };

    // CRM keeps the canonical Power BI tab as its stable reporting boundary,
    // while Archived Lost is audited directly in Odoo on every cache refresh.
    // The direct read starts beside the other remote work so it does not add a
    // second serial wait to page loading.
    const directCrmWithTimeout = async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          loadDirectCrm(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error("Odoo CRM direct timed out after 90 seconds")),
              90_000,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
    const loadDirectCrmCandidate = (): Promise<{
      value?: Awaited<ReturnType<typeof loadDirectCrm>>;
      error?: string;
    }> =>
      odooConfigured()
        ? directCrmWithTimeout()
            .then((value) => ({ value }))
            .catch((error: unknown) => ({
              error: error instanceof Error ? error.message : String(error),
            }))
        : Promise.resolve({
            error: "Odoo CRM is not configured; using Google Sheets fallback.",
          });
    const storedIsFresh = (snapshot: DatasetSnapshot | null, maxAgeMs: number): boolean => {
      const syncedAt = Date.parse(snapshot?.syncedAt ?? "");
      return (
        !!snapshot?.rows.length &&
        snapshot.status === "success" &&
        Number.isFinite(syncedAt) &&
        Date.now() - syncedAt < maxAgeMs
      );
    };
    const directCrmAttempted =
      odooConfigured() &&
      (refreshRemoteSources ||
        !storedIsFresh(crmStored, DIRECT_ODOO_REFRESH_MS) ||
        !storedIsFresh(lostStored, DIRECT_ODOO_REFRESH_MS));
    const directCrmPromise: Promise<{
      value?: Awaited<ReturnType<typeof loadDirectCrm>>;
      error?: string;
    }> = directCrmAttempted ? loadDirectCrmCandidate() : Promise.resolve({ error: "" });

    // Accounting follows the same fail-closed contract as CRM: start the Odoo
    // read while Google is loading, cap its wall time, and never turn an Odoo
    // failure into an empty financial population.  A later reconciliation gate
    // decides whether these rows are safe to prefer over the canonical sheet.
    const directAccountingWithTimeout = async (): Promise<DirectAccountingSnapshot> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          loadDirectAccounting(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error("Odoo Accounting direct timed out after 90 seconds")),
              90_000,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
    // Accounting is owned by the hardened n8n -> PostgreSQL workflow. Once a
    // durable snapshot exists, do not launch the lower-privilege direct reader;
    // it cannot see the full invoice population. Dashboard live-sync requests
    // trigger the authoritative n8n workflow itself.
    const directAccountingAttempted = !accountingStored?.rows.length && odooConfigured();
    const directAccountingPromise: Promise<
      { value: DirectAccountingSnapshot; error?: never } | { value?: never; error: string }
    > = directAccountingAttempted
      ? directAccountingWithTimeout()
          .then((value) => ({ value }))
          .catch((error: unknown) => ({
            error: error instanceof Error ? error.message : String(error),
          }))
      : Promise.resolve({
          error: accountingStored?.rows.length
            ? ""
            : "Odoo Accounting is not configured; using the migration fallback.",
        });

    // Seven simultaneous requests to one document is what triggers Google's
    // rate limiting in the first place. Two smaller waves cost a few hundred
    // milliseconds and remove the burst.
    const [metaSheetRaw, snapSheetRaw, crmSheetRaw, invoicedSheetRaw] = await Promise.all([
      metaStored?.rows.length ? Promise.resolve([]) : safeFetch(TAB.meta),
      snapStored?.rows.length ? Promise.resolve([]) : safeFetch(TAB.snap),
      crmStored?.rows.length ? Promise.resolve([]) : safeFetch(TAB.crm),
      invoicedStored?.rows.length ? Promise.resolve([]) : safeFetch(TAB.invoiced),
    ]);
    const currentMetaRaw = metaStored?.rows.length ? metaStored.rows : metaSheetRaw;
    const currentSnapRaw = snapStored?.rows.length ? snapStored.rows : snapSheetRaw;
    // Historical spend lives under its own dataset, so the scheduled Meta and
    // Snapchat `replace` jobs can rebuild their current snapshots without ever
    // deleting 2025. Imports must identify their source with `__platform`,
    // `platform`, `Platform`, or `المنصة`; unknown rows fail closed below.
    const legacyAdsRaw = (adsLegacyStored?.rows ?? []).filter(
      // Operational state is current truth and must never be restored from a
      // historical workbook even if it happens to carry a reserved state row.
      (row) => !str(row["__meta_key"]).startsWith("state|"),
    );
    const metaRaw = currentMetaRaw;
    const snapRaw = currentSnapRaw;
    // A historical accounting import must carry a source-calculated USD value.
    // Rows without it are excluded rather than silently re-priced by today's
    // emergency FX table, which would rewrite 2025 every time rates change.
    const accountingLegacyRaw = (accountingLegacyStored?.rows ?? [])
      .map((row) => ({
        ...row,
        __legacy_usd_locked: lockedLegacyAccountingUsd(row),
        __odoo_write_date: "",
      }))
      .filter((row) => str(row.__legacy_usd_locked) !== "");
    const crmFallbackRaw = crmStored?.rows.length ? crmStored.rows : crmSheetRaw;
    const invRaw = invoicedStored?.rows.length ? invoicedStored.rows : invoicedSheetRaw;
    const safeTikTok = () =>
      fetchTikTokAds(refreshRemoteSources).catch((error: unknown) => ({
        configured: Boolean(
          process.env.TIKTOK_ACCESS_TOKEN?.trim() && process.env.TIKTOK_ADVERTISER_IDS?.trim(),
        ),
        rows: [],
        syncedAt: "",
        errors: [error instanceof Error ? error.message : String(error)],
      }));
    const safeGoogle = () =>
      fetchGoogleAds(refreshRemoteSources).catch((error: unknown) => ({
        configured: Boolean(
          process.env.GOOGLE_ADS_CLIENT_ID?.trim() &&
          process.env.GOOGLE_ADS_CLIENT_SECRET?.trim() &&
          process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim() &&
          process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim() &&
          process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim() &&
          process.env.GOOGLE_ADS_CUSTOMER_IDS?.trim(),
        ),
        rows: [],
        syncedAt: "",
        errors: [error instanceof Error ? error.message : String(error)],
      }));
    const [
      accountingPrimaryRaw,
      websiteSalesRawFromSheet,
      lostSheetRaw,
      tiktokRaw,
      tiktokResult,
      googleResult,
    ] = await Promise.all([
      accountingStored?.rows.length
        ? Promise.resolve([])
        : safeFetch(TAB.accounting, looksLikeAccountingExport),
      websiteSalesStored?.rows.length ? Promise.resolve([]) : safeFetch(TAB.websiteSales),
      // Archived Lost is an Odoo/PostgreSQL fact table. The old Sheet did not
      // carry a reliable Close Date, so it is never used as a reporting fallback.
      lostStored?.rows.length ? Promise.resolve(lostStored.rows) : Promise.resolve([]),
      safeFetch(TAB.tiktok, looksLikeAdsExport),
      safeTikTok(),
      safeGoogle(),
    ]);
    const websiteSalesRaw = websiteSalesStored?.rows.length
      ? websiteSalesStored.rows
      : websiteSalesRawFromSheet;

    // One-time migration bootstrap. A deployment that already has the new
    // PostgreSQL schema but has not yet had its n8n writers switched over must
    // not keep serving Google forever. Preserve each accepted raw snapshot
    // once, then every later load reads the durable copy above. Keep the
    // original source timestamp so an import never makes old data look fresh.
    const sourceSyncedAt = (rows: Raw[]): string => {
      let latest = 0;
      for (const row of rows) {
        const raw = str(
          firstPresent(row["__synced_at"], row["__odoo_write_date"], row["__source_updated_at"]),
        );
        if (!raw) continue;
        const parsed = Date.parse(raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`);
        if (Number.isFinite(parsed) && parsed > latest) latest = parsed;
      }
      return latest ? new Date(latest).toISOString() : new Date().toISOString();
    };
    const bootstrapStoredDataset = async (
      dataset: DashboardDataset,
      stored: DatasetSnapshot | null,
      rows: Raw[],
      sourceTab: string,
    ) => {
      if (!databaseConfigured() || stored?.rows.length || !rows.length) return;
      await writeDashboardDataset(dataset, rows, {
        mode: "replace",
        syncedAt: sourceSyncedAt(rows),
        metadata: { source: "google-migration-bootstrap", sourceTab },
      }).catch(() => {
        fetchErrors.push(`PostgreSQL ${dataset}: migration bootstrap write failed.`);
      });
    };
    await Promise.all([
      bootstrapStoredDataset("meta_ads", metaStored, metaSheetRaw, TAB.meta),
      bootstrapStoredDataset("snap_ads", snapStored, snapSheetRaw, TAB.snap),
      bootstrapStoredDataset("invoiced", invoicedStored, invoicedSheetRaw, TAB.invoiced),
      bootstrapStoredDataset(
        "website_sales",
        websiteSalesStored,
        websiteSalesRawFromSheet,
        TAB.websiteSales,
      ),
    ]);
    fetchErrors.push(...tiktokResult.errors.map((error) => `TikTok Ads: ${error}`));
    const tiktokApiUsable = tiktokResult.configured && tiktokResult.errors.length === 0;
    fetchErrors.push(...googleResult.errors.map((error) => `Google Ads: ${error}`));
    const googleApiUsable = googleResult.configured && googleResult.errors.length === 0;
    // Existing deployments still expose the same paid invoice lines as `Sales`.
    // Always read it as an acceptance baseline: a newly-created Accounting tab
    // may contain a valid header and only part of the year. Switching on the
    // first valid row would silently cut recognised revenue.
    const legacySalesRaw = accountingStored?.rows.length
      ? []
      : await safeFetch(TAB.legacySales, looksLikeAccountingExport);
    // Compare like with like: invoices and credit notes are canonicalised
    // together before deciding whether Accounting can replace legacy Sales.
    const primaryCanonical = canonicalizeAccountingRows(accountingPrimaryRaw);
    const legacyCanonical = canonicalizeAccountingRows(legacySalesRaw);
    const distinctMoves = (rows: Raw[]): number =>
      new Set(rows.map(accountingMovement).filter(Boolean)).size;
    const primaryMoves = distinctMoves(primaryCanonical.rows);
    const legacyMoves = distinctMoves(legacyCanonical.rows);
    const NEAR_COMPLETE_RATIO = 0.98;
    const accountingPrimaryComplete =
      primaryCanonical.rows.length > 0 &&
      (legacyCanonical.rows.length === 0 ||
        (primaryCanonical.rows.length >= legacyCanonical.rows.length * NEAR_COMPLETE_RATIO &&
          primaryMoves >= legacyMoves * NEAR_COMPLETE_RATIO));
    const sheetAccountingSelection = accountingPrimaryComplete ? primaryCanonical : legacyCanonical;
    const sheetAccountingSourceRaw = accountingPrimaryComplete
      ? accountingPrimaryRaw
      : legacySalesRaw;
    // A complete paid-invoice fallback is a valid Accounting authority, not a
    // missing source. The reconciliation details stay in diagnostics; they must
    // not create a red "numbers exclude this source" banner.

    const rawAccountingRevenue = (rows: Raw[]): number =>
      rows.reduce(
        (sum, row) =>
          sum +
          signedCreditAmount(
            usdValue(
              authoritativeAccountingUsd(row),
              firstPresent(row["Total in Currency"], row["Ø§Ù„Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø¨Ø§Ù„Ø¹Ù…Ù„Ø©"]),
              firstPresent(row["Currency"], row["Ø§Ù„Ø¹Ù…Ù„Ø©"]),
            ),
            isAccountingRefund(row),
          ),
        0,
      );
    const storedAccountingCanonical = canonicalizeAccountingRows(accountingStored?.rows ?? []);
    // PostgreSQL is the durable n8n authority. It must be the reconciliation
    // baseline whenever it exists; using the intentionally skipped Google read
    // here produced a zero-row baseline and let a six-row Odoo response replace
    // thousands of good accounting lines.
    // Reconcile a direct Odoo candidate against the replaceable current
    // snapshot only. Legacy history is intentionally outside this gate: its
    // purpose is to retain rows the current sync can no longer reproduce.
    const accountingReference = storedAccountingCanonical.rows.length
      ? storedAccountingCanonical
      : sheetAccountingSelection;
    const referenceRows = accountingReference.rows.length;
    const referenceMoves = distinctMoves(accountingReference.rows);
    const referenceRevenue = rawAccountingRevenue(accountingReference.rows);
    const directAccounting = await directAccountingPromise;
    const directCanonical = canonicalizeAccountingRows(directAccounting.value?.rows ?? []);
    const directRows = directCanonical.rows.length;
    const directMoves = distinctMoves(directCanonical.rows);
    const directRevenue = rawAccountingRevenue(directCanonical.rows);
    const rowRatio = referenceRows > 0 ? directRows / referenceRows : 0;
    const moveRatio = referenceMoves > 0 ? directMoves / referenceMoves : 0;
    const revenueDelta = directRevenue - referenceRevenue;
    // One dollar protects small test datasets; 0.1% is tight enough to catch a
    // missing/duplicated invoice while allowing harmless cent-level rounding.
    const revenueTolerance = Math.max(1, Math.abs(referenceRevenue) * 0.001);
    const accountingDirectAccepted =
      !!directAccounting.value &&
      directAccountingPassesCompletenessGate({
        directRows,
        directMoves,
        directRevenue,
        missingCurrencyRate: directAccounting.value.diagnostics.missingCurrencyRate,
        referenceRows,
        referenceMoves,
        referenceRevenue,
        nearCompleteRatio: NEAR_COMPLETE_RATIO,
        revenueTolerance,
      });

    // Enrichment must come only from the replaceable current snapshot.
    // Historical rows have source-row keys rather than Odoo line ids; allowing
    // an empty id into this map could attach an arbitrary 2025 row to a direct
    // Odoo row that is also missing its id.
    const accountingEnrichmentRaw = accountingStored?.rows.length
      ? accountingStored.rows
      : sheetAccountingSelection.rows;
    const sheetAccountingById = new Map(
      accountingEnrichmentRaw
        .map((row) => [accountingStableLineId(row), row] as const)
        .filter(([id]) => !!id),
    );
    const directAccountingRows = directCanonical.rows.map((row) => {
      const prior = sheetAccountingById.get(accountingStableLineId(row));
      if (!prior) return row;
      // Odoo owns dates and dimensions, but n8n/PostgreSQL owns the recognised
      // USD value because it uses Odoo's current FX lookup. Preserve that value
      // explicitly so the direct reader's emergency static-rate value cannot
      // win merely because both column names exist after the merge.
      const recognisedUsd = authoritativeAccountingUsd(prior);
      return {
        ...prior,
        ...row,
        ...(String(recognisedUsd).trim() === "" ? {} : { "USD Paid": recognisedUsd }),
      };
    });
    // A successful direct read becomes the durable financial last-good copy.
    // Persist the enriched rows so campaign attribution also survives after the
    // Google migration fallback is removed.
    if (accountingDirectAccepted && databaseConfigured()) {
      await writeDashboardDataset("accounting", directAccountingRows, {
        mode: "replace",
        syncedAt: new Date().toISOString(),
        metadata: {
          source: "odoo-direct",
          moves: directMoves,
          revenue: directRevenue,
        },
      }).catch(() => {
        fetchErrors.push("PostgreSQL accounting: last-good write failed.");
      });
    } else if (!accountingStored?.rows.length && sheetAccountingSelection.rows.length) {
      await bootstrapStoredDataset(
        "accounting",
        accountingStored,
        sheetAccountingSelection.rows,
        accountingPrimaryComplete ? TAB.accounting : TAB.legacySales,
      );
    }
    const accountingStoredAvailable =
      !accountingDirectAccepted && storedAccountingCanonical.rows.length > 0;
    const storedAccountingRows = storedAccountingCanonical.rows.map((row) => {
      const prior = sheetAccountingById.get(accountingStableLineId(row));
      return prior ? { ...prior, ...row } : row;
    });
    const accountingCurrentSourceRaw = accountingDirectAccepted
      ? directAccounting.value!.rows
      : accountingStoredAvailable
        ? accountingStored!.rows
        : sheetAccountingSourceRaw;
    const accountingCurrentRaw = accountingDirectAccepted
      ? directAccountingRows
      : accountingStoredAvailable
        ? storedAccountingRows
        : sheetAccountingSelection.rows;
    const accountingStoredIsFresh = (() => {
      const synced = Date.parse(accountingStored?.syncedAt ?? "");
      return Number.isFinite(synced) && Date.now() - synced <= 45 * 60_000;
    })();
    // Merge only at read time. `accounting` remains the n8n-owned replaceable
    // snapshot, while `accounting_legacy` is a durable archive. Historical rows
    // have source-row keys and current rows have Odoo line ids, so ids alone
    // cannot reveal overlap. A movement already present in the authoritative
    // current snapshot is therefore current-owned and its legacy lines are
    // excluded as one complete invoice/credit-note unit.
    const currentMovements = new Set(
      accountingCurrentRaw.map(accountingMovement).filter((movement) => movement !== ""),
    );
    const nonOverlappingLegacyAccounting = accountingLegacyRaw.filter((row) => {
      const movement = accountingMovement(row);
      return movement === "" || !currentMovements.has(movement);
    });
    const accountingSelection = canonicalizeAccountingRows([
      ...accountingCurrentRaw,
      ...nonOverlappingLegacyAccounting,
    ]);
    const accountingRaw = accountingSelection.rows;
    const accountingSourceRaw = [...accountingCurrentSourceRaw, ...nonOverlappingLegacyAccounting];
    const hasLegacyAccounting = accountingLegacyRaw.length > 0;
    const currentAccountingLabel = accountingDirectAccepted
      ? "Paid Invoices (Odoo direct)"
      : accountingStoredAvailable
        ? accountingStoredIsFresh
          ? "Paid Invoices (PostgreSQL live sync)"
          : "Paid Invoices (Postgres last-good)"
        : "Paid Invoices (Payment Date — migration fallback)";
    const accountingTab = hasLegacyAccounting
      ? `${currentAccountingLabel.replace(/\)$/, "")} + history)`
      : currentAccountingLabel;
    const accountingAuthority: DataHealth["accountingAuthority"] = accountingDirectAccepted
      ? "odoo-direct"
      : accountingStoredAvailable
        ? accountingStoredIsFresh
          ? "postgres-live"
          : "postgres-last-good"
        : hasLegacyAccounting
          ? "postgres-last-good"
          : "google-sheet-fallback";
    const accountingDirectError = directAccounting.error
      ? /not configured/i.test(directAccounting.error)
        ? "Direct Odoo Accounting is not configured."
        : /timed out/i.test(directAccounting.error)
          ? "Direct Odoo Accounting timed out after 90 seconds."
          : "Direct Odoo Accounting request failed."
      : directAccounting.value && !accountingDirectAccepted
        ? referenceRows > 0
          ? `Direct Odoo Accounting failed the completeness gate (${directRows}/${referenceRows} rows, ${directMoves}/${referenceMoves} invoices).`
          : "Direct Odoo Accounting returned no usable paid rows or unresolved currency."
        : "";
    const accountingDirectHealth: DataHealth["accountingDirect"] = {
      attempted: directAccountingAttempted,
      accepted: accountingDirectAccepted,
      reportCandidates: directAccounting.value?.diagnostics.reportCandidates ?? 0,
      acceptedRows: directAccounting.value?.diagnostics.acceptedRows ?? 0,
      acceptedMoves: directAccounting.value?.diagnostics.acceptedMoves ?? 0,
      missingPaymentDate: directAccounting.value?.diagnostics.missingPaymentDate ?? 0,
      missingCurrencyRate: directAccounting.value?.diagnostics.missingCurrencyRate ?? 0,
      revenue: directAccounting.value?.diagnostics.revenue ?? 0,
      referenceRows,
      referenceMoves,
      referenceRevenue,
      rowRatio,
      moveRatio,
      revenueDelta,
      revenueTolerance,
      unresolvedFields: directAccounting.value?.diagnostics.unresolvedFields ?? [],
      error: accountingDirectError,
    };
    // A rejected direct-Odoo candidate does not make Accounting unavailable:
    // the canonical paid-invoice sheet above remains complete and authoritative.
    // Keep the reason in `health.accountingDirect.error` for engineering audit,
    // but do not mislabel the financial totals as incomplete.

    const blankExclusions = (): CrmExclusionDiagnostics => ({
      candidates: 0,
      accepted: 0,
      unassigned: 0,
      technicalIdentity: 0,
      nonInternalUser: 0,
      noEmployee: 0,
      excludedStage: 0,
      wrongType: 0,
      missingLostReason: 0,
    });
    const enrichDirectRows = (direct: CrmRawRow[], sheet: Raw[]): Raw[] => {
      const sheetById = new Map(sheet.map((row) => [str(row["__odoo_id"]), row]));
      return direct.map((row) => {
        const prior = sheetById.get(str(row["__odoo_id"]));
        if (!prior) return row;
        const merged: Raw = { ...prior, ...row };

        // Odoo decides population/state. The lookup tabs may still provide the
        // friendly course taxonomy and cleaned stage label for the same record.
        const sameStage =
          normalizeName(str(prior["Stage"]) || str(prior["المرحلة"])) ===
          normalizeName(str(row["Stage"]) || str(row["المرحلة"]));
        if (sameStage && str(prior["Cleaned Stage"]))
          merged["Cleaned Stage"] = str(prior["Cleaned Stage"]);
        if (str(prior["Course"])) merged["Course"] = str(prior["Course"]);
        if (str(prior["Main Category"])) merged["Main Category"] = str(prior["Main Category"]);
        return merged;
      });
    };

    let crmRaw: Raw[] = crmFallbackRaw;
    // Archived Lost is fail-closed. Direct Odoo owns the live population and
    // PostgreSQL retains the last successful archive when Odoo is unavailable.
    let lostRaw: Raw[] = lostStored?.rows.length ? lostStored.rows : [];
    const directCrm = await directCrmPromise;
    let crmAuthority: DataHealth["crmAuthority"] = crmStored?.rows.length
      ? "postgres-last-good"
      : crmSheetRaw.length
        ? "google-sheet"
        : "google-sheet-fallback";
    let lostAuthority: DataHealth["lostAuthority"] = lostStored?.rows.length
      ? "postgres-last-good"
      : "unavailable";
    let crmExclusions = blankExclusions();
    let lostExclusions = blankExclusions();
    const directCrmComplete = !!directCrm.value && directCrm.value.crm.length > 0;
    // Comparing the legacy sheet and Odoo row counts is not a valid completeness
    // test. A successful non-empty Odoo read is the direct archive authority.
    const directLostComplete = !!directCrm.value && directCrm.value.lost.length > 0;

    // Odoo now owns the CRM population. PostgreSQL holds its last successful
    // snapshot; Google is only the one-time migration fallback/enrichment.
    if (directCrm.value && directCrmComplete) {
      crmRaw = enrichDirectRows(directCrm.value.crm, crmFallbackRaw);
      crmAuthority = "odoo-direct";
      crmExclusions = directCrm.value.diagnostics.crm;
      if (databaseConfigured()) {
        await writeDashboardDataset("crm", crmRaw, {
          mode: "replace",
          syncedAt: new Date().toISOString(),
          metadata: { source: "odoo-direct", rows: crmRaw.length },
        }).catch(() => {
          fetchErrors.push("PostgreSQL CRM: last-good write failed.");
        });
      }
    } else if (crmSheetRaw.length) {
      await bootstrapStoredDataset("crm", crmStored, crmSheetRaw, TAB.crm);
    } else if (!crmFallbackRaw.length) {
      fetchErrors.push(
        directCrm.value
          ? "CRM unavailable: direct Odoo returned no usable rows and no last-good copy exists."
          : `CRM unavailable: ${directCrm.error}`,
      );
    }

    // Lost is an operational archive, so only Odoo's current population is
    // reportable. The Google tab remains available for reconciliation only;
    // it is never promoted into dashboard facts because it has no Close Date.
    if (directCrm.value && directLostComplete) {
      lostRaw = enrichDirectRows(directCrm.value.lost, lostSheetRaw);
      lostAuthority = "odoo-direct";
      lostExclusions = directCrm.value.diagnostics.lost;
      if (databaseConfigured()) {
        await writeDashboardDataset("lost", lostRaw, {
          mode: "replace",
          syncedAt: new Date().toISOString(),
          metadata: {
            source: "odoo-direct",
            rows: lostRaw.length,
            dateBasis: "creation_date",
            movementDate: "close_date",
          },
        }).catch(() => {
          fetchErrors.push("PostgreSQL Archived Lost: last-good write failed.");
        });
      }
    } else if (!lostStored?.rows.length) {
      fetchErrors.push(
        directCrm.value
          ? "Archived Lost unavailable: direct Odoo returned no reportable closed opportunities. No legacy fallback was shown."
          : "Archived Lost unavailable: direct Odoo is not configured or could not be reached. No legacy fallback was shown.",
      );
    }

    /* -- pass 1: learn keys from the ads tabs ----------------------------- */
    const keys = new CampaignKeyResolver();
    const adsets = new AdSetIndex();

    // The live n8n workflow writes its Google fallback into reserved state rows
    // in the existing Meta tab. They must never enter ad aggregates: doing so
    // would move adsDateMax and source freshness despite carrying zero spend.
    const metaStateRaw = metaRaw.filter((row) => str(row["__meta_key"]).startsWith("state|"));
    const metaHistoryRaw = metaRaw.filter((row) => !str(row["__meta_key"]).startsWith("state|"));

    for (const r of metaRaw) {
      keys.learn(str(r["__campaign_id"]), str(r["اسم الكامبين"]));
      adsets.learn(str(r["__ad_id"]), str(r["Ad Name"]), str(r["Ad set name"]));
    }
    for (const r of snapRaw) {
      keys.learn(str(r["__campaign_id"]), str(r["اسم الكامبين"]));
      adsets.learn(str(r["__ad_id"]), str(r["Ad Name"]), str(r["Ad set name"]));
    }
    for (const r of tiktokRaw) {
      keys.learn(str(r["__campaign_id"]), str(r["اسم الكامبين"]) || str(r["Campaign name"]));
      adsets.learn(
        str(r["__ad_id"]),
        str(r["Ad Name"]) || str(r["Ad name"]),
        str(r["Ad set name"]) || str(r["Ad Set Name"]),
      );
    }
    for (const r of legacyAdsRaw) {
      keys.learn(
        str(firstPresent(r["__campaign_id"], r["Campaign ID"])),
        str(firstPresent(r["اسم الكامبين"], r["Campaign name"], r["Campaign Name"])),
      );
      adsets.learn(
        str(firstPresent(r["__ad_id"], r["Ad ID"])),
        str(firstPresent(r["Ad Name"], r["Ad name"])),
        str(firstPresent(r["Ad set name"], r["Ad Set Name"])),
      );
    }
    for (const r of tiktokResult.rows) {
      keys.learn(r.campaignId, r.campaign);
      adsets.learn(r.adId, r.ad, r.adset);
    }
    for (const r of googleResult.rows) {
      keys.learn(r.campaignId, r.campaign);
      adsets.learn(r.adId, r.ad, r.adset);
    }
    // CRM and invoices also pair ids with names; learning from them lets a
    // name-only row on one tab join an id-bearing row on another.
    for (const r of crmRaw) keys.learn(str(r["Campaign ID"]), str(r["Campaign Name"]));
    for (const r of invRaw)
      keys.learn(str(r["الفرصة /Campaign ID"]) || str(r["Campaign ID"]), str(r["Campaign Name"]));
    for (const r of lostRaw) keys.learn(str(r["Campaign ID"]), str(r["Campaign Name"]));
    for (const r of accountingRaw) {
      const campaignId = str(r["Campaign ID"]) || str(r["الفرصة /Campaign ID"]);
      const campaignName = str(r["Campaign Name"]) || str(r["الفرصة /Campaign Name"]);
      const adId = str(r["Ad ID"]) || str(r["الفرصة /Ad ID"]);
      const adName = str(r["Ad Name"]) || str(r["AD Name"]) || str(r["الفرصة /Ad Name"]);
      const adset = str(r["Ad Set Name"]) || str(r["AD Set Name"]) || str(r["الفرصة /Ad Set Name"]);
      keys.learn(campaignId, campaignName);
      adsets.learn(adId, adName, adset);
    }
    adsets.finalize();

    /* -- ads --------------------------------------------------------------- */
    const objectiveByAccount = new Map<string, CampaignObjective>();

    const meta: AdRow[] = metaHistoryRaw.map((r) => {
      const account = str(r["اسم الحساب الإعلاني"]) || str(r["__account_name"]);
      const objective = classifyCampaign(str(r["اسم الكامبين"]), account);
      objectiveByAccount.set(account, classifyAccount(account));
      return {
        platform: "meta" as Platform,
        date: parseDate(r["التاريخ"]),
        account,
        accountId: str(r["__account_id"]),
        objective,
        campaign: str(r["اسم الكامبين"]),
        campaignId: str(r["__campaign_id"]),
        campaignKey: keys.key(str(r["__campaign_id"]), str(r["اسم الكامبين"])),
        // The sync already resolves the course for every Meta row and writes it
        // to `Course` — `Automotive - Riyadh - 4/7/26 - CBO - sh` → `Auto`,
        // `web-con-all-1/7/26-sa` → `Web`. Reading it makes the name-based
        // inference a fallback for feeds that have no such column (TikTok's API)
        // rather than the primary path for every row.
        courseHint: adCourseHint(str(r["Course"])),
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

    const campaignStates: CampaignOperationalState[] = metaStateRaw.flatMap((r) => {
      let state: Record<string, unknown> = {};
      try {
        state = JSON.parse(str(r["__lead_types"]) || "{}");
      } catch {
        return [];
      }
      const campaignId = str(r["__campaign_id"]);
      const name = str(r["اسم الكامبين"]);
      if (!campaignId || state.rowType !== "campaign_state") return [];
      const deliveryState = state.deliveryState === "active" ? "active" : "unknown";
      // Old paused/unknown rows may remain after an upsert-only backup run. The
      // dashboard lists the platform's current Active campaigns only.
      if (deliveryState !== "active") return [];
      const rawPlatform = str(state.platform);
      const platform: Platform = ["meta", "snapchat", "tiktok", "google"].includes(rawPlatform)
        ? (rawPlatform as Platform)
        : "meta";
      return [
        {
          platform,
          accountId: str(r["__account_id"]),
          account: str(r["__account_name"]) || str(r["اسم الحساب الإعلاني"]),
          accountTimezone: str(state.accountTimezone),
          campaignId,
          campaignKey: keys.key(campaignId, name),
          name,
          configuredStatus: str(state.campaignStatus) || "UNKNOWN",
          effectiveStatus: str(state.campaignEffectiveStatus) || "UNKNOWN",
          servingStatus: str(state.servingStatus),
          statusReason: str(state.statusReason),
          startTime: str(state.campaignStartTime),
          stopTime: str(state.campaignStopTime),
          updatedTime: str(state.campaignUpdatedTime),
          activeAdsets: num(state.activeAdsets),
          activeAds: num(state.activeAds),
          spend24h: num(state.spend24h),
          impressions24h: num(state.impressions24h),
          clicks24h: num(state.clicks24h),
          platformLeads24h: num(state.platformLeads24h),
          deliveryState,
          checkedAt: str(state.checkedAt) || str(r["__synced_at"]),
          source: "google_snapshot" as const,
        },
      ];
    });

    const snap: AdRow[] = snapRaw.map((r) => {
      const account = str(r["اسم الحساب الإعلاني"]) || str(r["__account_name"]);
      const objective = classifyCampaign(str(r["اسم الكامبين"]), account);
      const snapLeads = str(r["Leads (Native)"]) || str(r["Leads"]) || str(r["On-Facebook leads"]);
      objectiveByAccount.set(account, classifyAccount(account));
      return {
        platform: "snapchat" as Platform,
        date: parseDate(r["التاريخ"]),
        account,
        accountId: str(r["__account_id"]),
        objective,
        campaign: str(r["اسم الكامبين"]),
        campaignId: str(r["__campaign_id"]),
        campaignKey: keys.key(str(r["__campaign_id"]), str(r["اسم الكامبين"])),
        // Snap's export has no `Course` column today; read it anyway so the
        // column starts counting the day the sync adds it.
        courseHint: adCourseHint(str(r["Course"])),
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

    // TikTok is read tolerantly. The tab does not exist yet, and when it is
    // created it will most likely be a Supermetrics export with English headers
    // rather than a copy of the Arabic-headed Meta sheet — so both spellings are
    // accepted and a missing column stays null instead of becoming a zero.
    const pick = (r: Raw, ...cols: string[]): string => {
      for (const c of cols) {
        const v = str(r[c]);
        if (v !== "") return v;
      }
      return "";
    };
    const legacyAds: AdRow[] = legacyAdsRaw.flatMap((r) => {
      const platform = legacyAdPlatform(r);
      if (!platform) return [];
      const account =
        pick(r, "اسم الحساب الإعلاني", "__account_name", "Account name", "Account Name") ||
        (platform === "meta"
          ? "Meta Ads"
          : platform === "snapchat"
            ? "Snapchat Ads"
            : "TikTok Ads");
      const campaign = pick(r, "اسم الكامبين", "Campaign name", "Campaign Name");
      const campaignId = pick(r, "__campaign_id", "Campaign ID");
      const objective = classifyCampaign(campaign, account);
      objectiveByAccount.set(account, classifyAccount(account));

      // TikTok exports in the supplied historical workbook carry a misleading
      // `On-Facebook leads` value. Keep the original cell in `ads_legacy`
      // unchanged for audit, but never turn it into a reportable TikTok lead.
      const leadValue = legacyAdLeadValue(r, platform);
      return [
        {
          platform,
          date: parseDate(pick(r, "التاريخ", "Date", "date")),
          account,
          accountId: pick(r, "__account_id", "Account ID"),
          objective,
          campaign,
          campaignId,
          campaignKey: keys.key(campaignId, campaign),
          courseHint: adCourseHint(legacyAdCourseValue(r)),
          adset: pick(r, "Ad set name", "Ad Set Name"),
          adsetId: pick(r, "__adset_id", "Ad Set ID"),
          ad: pick(r, "Ad Name", "Ad name"),
          adId: pick(r, "__ad_id", "Ad ID"),
          spend: num(pick(r, "Spend (Cost)", "Cost", "Spend")),
          impressions: num(pick(r, "Impressions")),
          clicksAll: num(pick(r, "Clicks (all)", "Ad clicks", "Clicks")),
          linkClicks: platform === "meta" ? num(pick(r, "Link Clicks", "Link clicks")) : null,
          platformLeads: leadValue === null ? null : num(leadValue),
          viewCompletions:
            platform === "snapchat"
              ? num(pick(r, "View Completions", "Video views at 100%"))
              : null,
          syncedAt: pick(r, "__synced_at", "Synced At"),
        },
      ];
    });
    const tiktokFromSheet: AdRow[] = tiktokRaw.map((r) => {
      const account =
        pick(r, "اسم الحساب الإعلاني", "__account_name", "Account name") || "TikTok Ads";
      const campaign = pick(r, "اسم الكامبين", "Campaign name", "Campaign Name");
      const objective = classifyCampaign(campaign, account);
      const leads = pick(r, "Leads (Native)", "Leads", "On-Facebook leads", "Leads (Total)");
      objectiveByAccount.set(account, classifyAccount(account));
      const campaignId = pick(r, "__campaign_id", "Campaign ID");
      return {
        platform: "tiktok" as Platform,
        date: parseDate(pick(r, "التاريخ", "Date")),
        account,
        accountId: pick(r, "__account_id", "Account ID"),
        objective,
        campaign,
        campaignId,
        campaignKey: keys.key(campaignId, campaign),
        courseHint: adCourseHint(pick(r, "Course", "Course Name")),
        adset: pick(r, "Ad set name", "Ad Set Name"),
        adsetId: pick(r, "__adset_id", "Ad Set ID"),
        ad: pick(r, "Ad Name", "Ad name"),
        adId: pick(r, "__ad_id", "Ad ID"),
        spend: num(pick(r, "Spend (Cost)", "Cost", "Spend")),
        impressions: num(pick(r, "Impressions")),
        clicksAll: num(pick(r, "Clicks (all)", "Ad clicks", "Clicks")),
        linkClicks: null,
        platformLeads: leads === "" ? null : num(leads),
        viewCompletions: null,
        syncedAt: str(r["__synced_at"]),
      };
    });
    const tiktokFromApi: AdRow[] = tiktokResult.rows.map((r) => {
      const objective = classifyCampaign(r.campaign, r.account);
      objectiveByAccount.set(r.account, classifyAccount(r.account));
      return {
        platform: "tiktok" as Platform,
        date: r.date,
        account: r.account,
        accountId: r.accountId,
        objective,
        campaign: r.campaign,
        campaignId: r.campaignId,
        campaignKey: keys.key(r.campaignId, r.campaign),
        adset: r.adset,
        adsetId: r.adsetId,
        ad: r.ad,
        adId: r.adId,
        spend: r.spend,
        impressions: r.impressions,
        clicksAll: r.clicks,
        // TikTok exposes one general click measure in this report, not a
        // dedicated link-click field comparable to Meta's export.
        linkClicks: null,
        // Lead-form submissions are preferred when present. The authorised
        // Engosoft accounts currently report website conversions instead.
        platformLeads: r.formLeads > 0 ? r.formLeads : r.conversions,
        viewCompletions: r.viewCompletions,
        syncedAt: r.syncedAt,
      };
    });
    const tiktok = tiktokApiUsable ? tiktokFromApi : tiktokFromSheet;

    const googleLeadCampaigns = new Set(
      googleResult.rows.filter((r) => r.conversions > 0).map((r) => r.campaignId || r.campaign),
    );
    const google: AdRow[] = googleResult.rows.map((r) => {
      // Google uses one website account for mixed campaign goals. A campaign
      // that has produced conversions is a lead campaign even though the
      // account name itself contains "Website".
      const namedObjective = classifyCampaign(r.campaign, r.account);
      const objective =
        namedObjective === "website_conversion"
          ? namedObjective
          : googleLeadCampaigns.has(r.campaignId || r.campaign)
            ? ("leads" as CampaignObjective)
            : namedObjective;
      objectiveByAccount.set(r.account, classifyAccount(r.account));
      return {
        platform: "google" as Platform,
        date: r.date,
        account: r.account,
        accountId: r.accountId,
        objective,
        campaign: r.campaign,
        campaignId: r.campaignId,
        campaignKey: keys.key(r.campaignId, r.campaign),
        adset: r.adset,
        adsetId: r.adsetId,
        ad: r.ad,
        adId: r.adId,
        spend: r.spend,
        impressions: r.impressions,
        clicksAll: r.clicks,
        // Google reports clicks for this query, not the Meta-specific link-click metric.
        linkClicks: null,
        platformLeads: r.conversions,
        viewCompletions: null,
        syncedAt: r.syncedAt,
      };
    });

    const currentAds = [...meta, ...snap, ...tiktok, ...google];
    const adFactKey = (row: AdRow) =>
      [
        row.platform,
        row.date,
        row.accountId || normalizeName(row.account),
        row.campaignId || normalizeName(row.campaign),
        row.adsetId || normalizeName(row.adset),
        row.adId || normalizeName(row.ad),
      ].join("\u001f");
    // Current API/n8n facts win on overlap; the archive only fills dates the
    // replaceable snapshots no longer retain.
    const adsByFact = new Map(legacyAds.map((row) => [adFactKey(row), row] as const));
    for (const row of currentAds) adsByFact.set(adFactKey(row), row);
    const ads = [...adsByFact.values()];

    /* -- CRM --------------------------------------------------------------- */
    // What the stage guard removed, so the number is explainable on the page
    // instead of leaving people to wonder why the tab and the total disagree.
    const excludedStageCounts = new Map<string, number>();
    const noteExcluded = (stage: string) =>
      excludedStageCounts.set(stage, (excludedStageCounts.get(stage) ?? 0) + 1);

    const crm: CrmLeadRow[] = crmRaw
      .filter((r) => str(r["__odoo_id"]))
      .map((r) => {
        const createdAt = parseDate(r["أنشئ في"]);
        const closedAt = parseDate(r["التاريخ المقفل"]) || parseDate(r["Closing Date"]);
        const adName = str(r["Ad Name"]);
        const adId = str(r["Ad ID"]);
        const resolvedAdset = adsets.resolve(adId, adName);
        const directAdset = str(r["Ad Set Name"]);
        const adset = directAdset || resolvedAdset.adset;
        const origin: AdSetOrigin = directAdset ? "exact" : resolvedAdset.origin;
        const campaignName = str(r["Campaign Name"]);
        const campaignId = str(r["Campaign ID"]);
        const cleanedStage = str(r["Cleaned Stage"]) || str(r["Stage"]);
        const source = str(r["cleaned Source"]) || str(r["Source"]);
        const course = canonicalCourse(str(r["Course"]) || str(r["Course Categories"]));
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
          salesTeam: str(r["Sales Team"]) || str(r["فريق المبيعات"]),
          subTeam: str(r["فريق المبيعات"]),
          stage: str(r["Stage"]),
          cleanedStage,
          lastStageUpdate: parseDate(r["آخر تحديث للمرحلة"]),
          callingReply: str(r["Calling reply?"]),
          // Not `=== "won"`: that relies on the `Cleaned Stage` helper column
          // being present, and the raw Odoo stage is `Won / ربح`. A workbook
          // shipped without that column would silently zero every win.
          isWon: isArchivedWonStage(cleanedStage),
          isLost: cleanedStage.toLowerCase() === "lost",
          source,
          sourceKey: normalizeSource(source),
          course,
          mainCategory: canonicalMainCategory(str(r["Main Category"]), course),
          priority: str(r["Priority"]),
          fromCampaign: !!campaignName || !!campaignId,
        };
      })
      // Lost Analysis is the only authoritative source for lost opportunities,
      // and dialler residue is not a commercial lead. Both are dropped here so
      // the reportable population is correct even when the upstream sync ships
      // them — which it has done twice.
      .filter((row) => {
        const stage = row.cleanedStage.trim().toLowerCase();
        if (!isExcludedCrmStage(stage)) return true;
        noteExcluded(row.cleanedStage.trim() || stage);
        return false;
      });

    /* -- invoiced ---------------------------------------------------------- */
    const invoiced: InvoicedRow[] = invRaw
      .filter((r) => str(r["__odoo_id"]))
      .map((r) => {
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
        const resolvedAdset = adsets.resolve(adId, adName);
        const directAdset = str(r["AD Set Name"]) || str(r["الفرصة /Ad Set Name"]);
        const adset = directAdset || resolvedAdset.adset;
        const origin: AdSetOrigin = directAdset ? "exact" : resolvedAdset.origin;
        const source = str(r["Cleaned Source"]) || str(r["Source"]) || str(r["الفرصة /المصدر"]);
        const product = str(r["بنود الطلب /المنتج"]);
        const productCategory = str(r["بنود الطلب /المنتج/فئة المنتج"]);
        const course = canonicalCourse(
          str(r["Course"]) || str(r["الفرصة /Course Categories"]),
          product,
          productCategory,
        );
        return {
          orderRef: str(r["بنود الطلب /مرجع الطلب"]),
          campaignName,
          campaignId,
          campaignKey: keys.key(campaignId, campaignName),
          adName,
          adId,
          adset,
          adsetOrigin: origin,
          product,
          customer: str(r["بنود الطلب /العميل"]),
          course,
          mainCategory: canonicalMainCategory(str(r["Main Category"]), course, productCategory),
          // Only ~16% of rows carry a team, so this must never be used as a
          // revenue filter on its own — see health.revenueTeamCoverage.
          salesTeam: str(r["Sales Team"]) || str(r["Team"]),
          salesperson: str(r["بنود الطلب /مندوب المبيعات"]),
          source,
          sourceKey: normalizeSource(source),
          invoiceDate,
          revenueDate,
          localTotal: num(r["بنود الطلب /الإجمالي"]),
          // The workflow writes USD directly. The currency-rate calculation is a
          // guard for a partially refreshed sheet where that derived cell is blank.
          usdSales: usdValue(r["$ Sales"], r["بنود الطلب /الإجمالي"], r["بنود الطلب /العملة"]),
        };
      });

    /* -- order → campaign bridge ------------------------------------------- */
    /**
     * Compatibility-only order attribution. The canonical Accounting schema
     * carries campaign/ad/source columns directly. Older Sales exports did not,
     * so their labels can temporarily be filled from the order's opportunity.
     * Money always remains on the Accounting row; this bridge cannot change it.
     */
    interface OrderAttribution {
      campaignName: string;
      campaignId: string;
      campaignKey: string;
      adName: string;
      adId: string;
      adset: string;
      adsetOrigin: AdSetOrigin;
      source: string;
      sourceKey: string;
    }
    const attributionByOrder = new Map<string, OrderAttribution>();
    for (const row of invoiced) {
      const ref = normalizeName(row.orderRef);
      if (!ref) continue;
      const existing = attributionByOrder.get(ref);
      // One order spans many invoice lines. Prefer the first line that actually
      // carries a campaign, so a blank line cannot mask an attributed one.
      if (existing && existing.campaignKey) continue;
      attributionByOrder.set(ref, {
        campaignName: row.campaignName,
        campaignId: row.campaignId,
        campaignKey: row.campaignKey,
        adName: row.adName,
        adId: row.adId,
        adset: row.adset,
        adsetOrigin: row.adsetOrigin,
        source: row.source,
        sourceKey: row.sourceKey,
      });
    }
    const NO_ATTRIBUTION: OrderAttribution = {
      campaignName: "",
      campaignId: "",
      campaignKey: "",
      adName: "",
      adId: "",
      adset: "",
      adsetOrigin: "none",
      source: "",
      sourceKey: "",
    };
    /** `Sales Order #` can join several orders with a comma. */
    const attributionFor = (rawRef: string): { hit: OrderAttribution; matched: boolean } => {
      const refs = rawRef
        .split(",")
        .map((s) => normalizeName(s))
        .filter(Boolean);
      let fallback: OrderAttribution | null = null;
      for (const ref of refs) {
        const hit = attributionByOrder.get(ref);
        if (!hit) continue;
        if (hit.campaignKey) return { hit, matched: true };
        if (!fallback) fallback = hit;
      }
      return fallback ? { hit: fallback, matched: true } : { hit: NO_ATTRIBUTION, matched: false };
    };

    /* -- accounting -------------------------------------------------------- */
    const accountingCandidates = accountingRaw.filter((r) => {
      const movement = accountingMovement(r);
      const id = accountingStableLineId(r);
      return !!(movement || id);
    });
    const accountingMissingPaymentDate = accountingCandidates.filter((r) => {
      const paymentDate =
        parseDate(r["Payment Date"]) || parseDate(r["Payment date"]) || parseDate(r["تاريخ الدفع"]);
      const reversalDate = parseDate(r["Invoice Date"]) || parseDate(r["تاريخ الفاتورة"]);
      return isAccountingRefund(r) ? !(reversalDate || paymentDate) : !paymentDate;
    }).length;
    const accounting: AccountingRow[] = accountingCandidates
      .filter((r) => {
        // Paid invoices require Payment Date. Credit notes are recognised on
        // their Odoo reversal (Invoice) Date and may have no payment event.
        const paymentDate =
          parseDate(r["Payment Date"]) ||
          parseDate(r["Payment date"]) ||
          parseDate(r["تاريخ الدفع"]);
        const reversalDate = parseDate(r["Invoice Date"]) || parseDate(r["تاريخ الفاتورة"]);
        return isAccountingRefund(r) ? !!(reversalDate || paymentDate) : !!paymentDate;
      })
      .map((r) => {
        const paymentDate =
          parseDate(r["Payment Date"]) ||
          parseDate(r["Payment date"]) ||
          parseDate(r["تاريخ الدفع"]);
        const movement = accountingMovement(r);
        const isCreditNote = isAccountingRefund(r);
        const moveType = accountingMoveType(r) || (isCreditNote ? "out_refund" : "out_invoice");
        const invoiceDate = parseDate(r["Invoice Date"]) || parseDate(r["تاريخ الفاتورة"]);
        const orderRef =
          str(r["Sales Order #"]) || str(r["Sales Order"]) || str(r["Order #"]) || str(r["SO #"]);
        const fallback = attributionFor(orderRef);

        const directCampaignName = str(r["Campaign Name"]) || str(r["الفرصة /Campaign Name"]);
        const directCampaignId = str(r["Campaign ID"]) || str(r["الفرصة /Campaign ID"]);
        const directAdName = str(r["Ad Name"]) || str(r["AD Name"]) || str(r["الفرصة /Ad Name"]);
        const directAdId = str(r["Ad ID"]) || str(r["الفرصة /Ad ID"]);
        const directAdset =
          str(r["Ad Set Name"]) || str(r["AD Set Name"]) || str(r["الفرصة /Ad Set Name"]);
        const directSource = str(r["Cleaned Source"]) || str(r["Source"]) || str(r["المصدر"]);
        const hasDirectAttribution = !!(
          directCampaignName ||
          directCampaignId ||
          directAdName ||
          directAdId ||
          directAdset ||
          directSource
        );
        const hasDirectAdContext = !!(directAdset || directAdId || directAdName);
        const resolvedAdset = adsets.resolve(directAdId, directAdName);
        const campaignName = directCampaignName || fallback.hit.campaignName;
        const campaignId = directCampaignId || fallback.hit.campaignId;
        const adName = directAdName || fallback.hit.adName;
        const adId = directAdId || fallback.hit.adId;
        const adset = directAdset || resolvedAdset.adset || fallback.hit.adset;
        const source = directSource || fallback.hit.source;
        const product =
          str(r["Product"]) || str(r["المنتج"]) || str(r["Course Name"]) || str(r["Course"]);
        const productCategory =
          str(r["Product Category"]) || str(r["فئة المنتج"]) || str(r["Category"]);
        const totalInCurrency = signedCreditAmount(
          num(firstPresent(r["Total in Currency"], r["الإجمالي بالعملة"])),
          isCreditNote,
        );
        const currency = str(firstPresent(r["Currency"], r["العملة"]));
        const lockedLegacyUsd = str(r["__legacy_usd_locked"]);
        const usdPaid = signedCreditAmount(
          lockedLegacyUsd !== ""
            ? num(lockedLegacyUsd)
            : usdValue(authoritativeAccountingUsd(r), totalInCurrency, currency),
          isCreditNote,
        );
        const untaxedTotal = signedCreditAmount(
          num(firstPresent(r["Untaxed Total"], r["الإجمالي دون الضريبة"])),
          isCreditNote,
        );
        const course = canonicalCourse(
          str(r["Course Name"]) || str(r["Course"]),
          product,
          productCategory,
        );

        return {
          id: accountingStableLineId(r) || `${movement}:${accountingComposite(r)}`,
          movement,
          moveType,
          isCreditNote,
          paymentDate,
          invoiceDate,
          orderRef,
          product,
          productCategory,
          mainCategory: canonicalMainCategory(str(r["Main Category"]), course, productCategory),
          productCode:
            str(r["Product Code"]) || str(r["Product Reference"]) || str(r["الرقم المرجعي"]),
          quantity: num(firstPresent(r["Quantity"], r["الكمية"])),
          company: str(r["Company"]) || str(r["الشركة"]),
          companyCurrency: str(r["Company Currency"]) || str(r["عملة الشركة"]),
          country: str(r["Country"]) || str(r["الدولة"]),
          code: str(r["Code"]) || str(r["Employee Reg. No"]) || str(r["Employee Code"]),
          website: str(r["Website"]) || str(r["الموقع"]),
          untaxedTotal,
          totalInCurrency,
          usdPaid,
          reportingUsdLocked: lockedLegacyUsd !== "",
          // Existing marketing/course analysis reads these compatibility names.
          course,
          category: productCategory,
          partner: str(r["Partner"]) || str(r["الشريك"]),
          salesperson: str(r["Salesperson"]) || str(r["مندوب المبيعات"]),
          teamLeader: str(r["Team Leader"]) || str(r["قائد الفريق"]),
          salesTeam: str(r["Sales Team"]) || str(r["فريق المبيعات"]),
          usdSales: usdPaid,
          currency,
          event: str(r["Event"]),
          eventStage: str(r["Event Stage"]),
          month: accountingReportingDate(
            { paymentDate, invoiceDate, isCreditNote },
            "payment",
          ).slice(0, 7),
          campaignName,
          campaignId,
          campaignKey: keys.key(campaignId, campaignName),
          adName,
          adId,
          adset,
          adsetOrigin: directAdset
            ? "exact"
            : hasDirectAdContext
              ? resolvedAdset.origin
              : fallback.hit.adsetOrigin,
          source,
          sourceKey: normalizeSource(source),
          orderMatched: hasDirectAttribution || fallback.matched,
        };
      });

    /* -- website sales (Odoo sale.order, never Meta attribution) ----------- */
    const websiteSales: WebsiteSaleRow[] = websiteSalesRaw
      .filter((r) => str(r["__odoo_id"]))
      .map((r) => {
        const product = str(r["Product"]);
        const productCategory = str(r["Product Category"]);
        const course = canonicalCourse(str(r["Course"]), product, productCategory);
        return {
          id: str(r["__odoo_id"]),
          writeDate: str(r["__odoo_write_date"]),
          orderRef: str(r["Order #"]),
          orderDate: parseDate(r["Order Date"]),
          website: str(r["Website"]),
          status: str(r["Status"]),
          customer: str(r["Customer"]),
          salesperson: str(r["Salesperson"]),
          salesTeam: str(r["Sales Team"]),
          currency: str(r["Currency"]),
          product,
          productCategory,
          course,
          mainCategory: canonicalMainCategory(str(r["Main Category"]), course, productCategory),
          quantity: num(r["Quantity"]),
          untaxedTotal: num(r["Untaxed Total"]),
          localTotal: num(r["Total in Currency"]),
          usdSales: usdValue(r["$ Sales"], r["Total in Currency"], r["Currency"]),
          opportunityId: str(r["Opportunity ID"]),
          opportunitySource: str(r["Opportunity Source"]),
          invoiceStatus: str(r["Invoice Status"]),
          paymentDate: parseDate(r["Payment Date"]),
          recordSource: str(r["Record Source"]) || "Odoo",
          revenueBasis: str(r["Revenue Basis"]) || "Odoo line total",
          externalSheetPrice: num(r["External Sheet Price"]),
          externalCurrency: str(r["External Currency"]),
          externalSalesSource: str(r["External Sales Source"]),
          externalPhone: str(r["External Phone"]),
          externalSourceDate: parseDate(r["External Source Date"]),
          reconciliationStatus: str(r["Reconciliation Status"]) || "Odoo only",
          priceDifference: str(r["Price Difference"]) === "" ? null : num(r["Price Difference"]),
        };
      });

    /* -- lost -------------------------------------------------------------- */
    const lost: LostRow[] = lostRaw
      .filter((r) => str(r["__odoo_id"]))
      .map((r) => {
        const campaignName = str(r["Campaign Name"]);
        const campaignId = str(r["Campaign ID"]);
        const adName = str(r["Ad Name"]);
        const adId = str(r["Ad ID"]);
        const resolvedAdset = adsets.resolve(adId, adName);
        const source = str(r["cleaned Source"]) || str(r["المصدر"]);
        const course = canonicalCourse(str(r["Course"]) || str(r["Course Categories"]));
        return {
          id: str(r["__odoo_id"]),
          contact: str(r["اسم جهة الاتصال"]),
          campaignName,
          campaignId,
          campaignKey: keys.key(campaignId, campaignName),
          adName,
          adId,
          adset: str(r["Ad Set Name"]) || resolvedAdset.adset,
          lossReason: str(r["سبب الضياع"]),
          course,
          mainCategory: canonicalMainCategory(str(r["Main Category"]), course),
          salesTeam: str(r["فريق المبيعات"]),
          salesperson: str(r["مندوب المبيعات"]),
          source,
          sourceKey: normalizeSource(source),
          stage: str(r["Cleaned Stage"]) || str(r["المرحلة"]),
          createdAt: parseDate(r["أنشئ في"]),
          closeDate: parseDate(r["Closing Date"]) || parseDate(r["التاريخ المقفل"]),
        };
      })
      // Dialler residue is excluded from the lead total on both tabs, otherwise
      // the same rule would apply to active leads and not to archived ones.
      .filter((row) => {
        const stage = row.stage.trim().toLowerCase();
        if (!EXCLUDED_ARCHIVED_STAGES.has(stage)) return true;
        noteExcluded(row.stage.trim() || stage);
        return false;
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
    // Campaign names often carry the course explicitly. When they do not, the
    // modal course of the campaign's CRM leads is a safe fallback. Ad and ad-set
    // names are evaluated later per ad row because a single campaign can contain
    // several courses.
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
          courseSource: "",
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
    for (const state of campaignStates)
      touchCampaign(state.campaignKey, state.name, state.campaignId, state.platform);
    for (const c of crm) touchCampaign(c.campaignKey, c.campaignName, c.campaignId);
    for (const i of invoiced) touchCampaign(i.campaignKey, i.campaignName, i.campaignId);
    for (const l of lost) touchCampaign(l.campaignKey, l.campaignName, l.campaignId);

    for (const e of campaigns.values()) {
      const namedCourse = knownCourseFromText(e.name);
      if (namedCourse) {
        e.course = namedCourse;
        e.courseSource = "campaign_name";
        e.courseDominance = 1;
        continue;
      }

      const counts = courseCounts.get(e.key);
      if (!counts) continue;
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
      e.courseSource = top ? "crm_leads" : "";
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
    // Paid invoices follow Payment Date; credit notes follow their reversal date.
    const revRange = range(accounting.map((row) => accountingReportingDate(row, "payment")));

    const yearSet = new Set<number>();
    for (const d of [
      ...ads.map((a) => a.date),
      ...crm.map((c) => c.createdAt),
      ...invoiced.map((i) => i.revenueDate),
      ...accounting.map((row) => accountingReportingDate(row, "payment")),
      ...websiteSales.map((s) => s.orderDate),
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

    // A source that stopped syncing has to say so. Reporting only its age left
    // a dataset that had failed twenty-six times in a row looking identical to
    // one that had simply not been touched since lunchtime.
    for (const alert of datasetFreshnessAlerts(storedStates, Date.now())) {
      fetchErrors.push(alert.message);
    }

    const tabSyncs: SourceFreshness[] = [
      {
        key: "meta",
        label: metaStored?.rows.length
          ? "Meta Ads (PostgreSQL)"
          : `${TAB.meta} — migration fallback`,
        syncedAt: metaStored?.rows.length
          ? metaStored.syncedAt
          : maxOf(metaHistoryRaw, "__synced_at"),
      },
      // `campaignStates` is only a recovery snapshot for the official live-status
      // endpoint. Its age must not make fresh PostgreSQL ad facts look stale.
      {
        key: "snap",
        label: snapStored?.rows.length
          ? "Snapchat Ads (PostgreSQL)"
          : `${TAB.snap} — migration fallback`,
        syncedAt: snapStored?.rows.length ? snapStored.syncedAt : maxOf(snapRaw, "__synced_at"),
      },
      {
        key: "tiktok",
        label: tiktokApiUsable ? "TikTok Marketing API" : TAB.tiktok,
        syncedAt: tiktokApiUsable ? tiktokResult.syncedAt : maxOf(tiktokRaw, "__synced_at"),
      },
      ...(googleResult.configured
        ? [
            {
              key: "google",
              label: "Google Ads API",
              syncedAt: googleApiUsable ? googleResult.syncedAt : "",
            },
          ]
        : []),
      {
        key: "crm",
        label:
          crmAuthority === "odoo-direct"
            ? "Odoo CRM (direct)"
            : crmAuthority === "postgres-last-good"
              ? "Odoo CRM (Postgres last-good)"
              : `${TAB.crm} — migration fallback`,
        syncedAt:
          crmAuthority === "odoo-direct"
            ? new Date().toISOString()
            : crmAuthority === "postgres-last-good"
              ? crmStored!.syncedAt
              : asIso(maxOf(crmRaw, "__odoo_write_date")),
      },
      {
        key: "accounting",
        label: accountingTab,
        syncedAt: accountingDirectAccepted
          ? new Date().toISOString()
          : accountingStoredAvailable
            ? accountingStored!.syncedAt
            : asIso(maxOf(accountingRaw, "__odoo_write_date")),
      },
      {
        key: "invoiced",
        label: invoicedStored?.rows.length
          ? "Full Invoiced Orders (PostgreSQL)"
          : `${TAB.invoiced} — migration fallback`,
        syncedAt: invoicedStored?.rows.length
          ? invoicedStored.syncedAt
          : asIso(maxOf(invRaw, "__odoo_write_date")),
      },
      {
        key: "websiteSales",
        label: websiteSalesStored?.rows.length
          ? "Website Sales (PostgreSQL)"
          : `${TAB.websiteSales} — migration fallback`,
        syncedAt: websiteSalesStored?.rows.length
          ? websiteSalesStored.syncedAt
          : asIso(maxOf(websiteSalesRaw, "__odoo_write_date")),
      },
      {
        key: "lost",
        label:
          lostAuthority === "odoo-direct"
            ? "Odoo Archived CRM (direct)"
            : "Odoo Archived CRM (PostgreSQL last-good)",
        syncedAt:
          lostAuthority === "odoo-direct"
            ? new Date().toISOString()
            : lostStored?.syncedAt || asIso(maxOf(lostRaw, "__odoo_write_date")),
      },
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
      accounting.filter((row) => row.adsetOrigin === o).length;
    const adsetExact = countOrigin("exact");
    const adsetDerived = countOrigin("derived");
    const adsetAmbiguous = countOrigin("ambiguous");
    const adsetUnknown = countOrigin("unknown");
    const adsetNoAd = countOrigin("none");
    const adBearing = adsetExact + adsetDerived + adsetAmbiguous + adsetUnknown;

    const totalRevenue = accounting.reduce((s, r) => s + r.usdPaid, 0);
    const campaignRevenueRows = accounting.filter((row) => !!row.campaignKey);
    const campaignRevenue = campaignRevenueRows.reduce((sum, row) => sum + row.usdPaid, 0);
    // Attribution is measured on paid Accounting lines, not on sales orders,
    // because that is the number every ratio on the dashboard divides.
    const attributedRevenue = accounting
      .filter((r) => r.campaignKey && adCampaignKeys.has(r.campaignKey))
      .reduce((s, r) => s + r.usdPaid, 0);
    const matchedRevenue = accounting
      .filter((r) => r.orderMatched)
      .reduce((s, r) => s + r.usdPaid, 0);
    const accountingCampaignRevenue = accounting
      .filter((r) => !!r.campaignKey)
      .reduce((s, r) => s + r.usdPaid, 0);

    // A platform that generates CRM leads but has no spend tab is invisible cost.
    // Naming it is the difference between a wrong ROAS and a known-incomplete one.
    const platformsWithSpendTab = new Set<string>();
    for (const a of ads)
      if (a.spend > 0)
        for (const key of PLATFORM_SOURCE_KEYS[a.platform] ?? []) platformsWithSpendTab.add(key);
    const platformLeadCounts = new Map<string, number>();
    for (const key of Object.keys(PLATFORM_SOURCE_KEYS) as Platform[]) {
      if (platformsWithSpendTab.has(PLATFORM_SOURCE_KEYS[key][0])) continue;
      const wanted = new Set(PLATFORM_SOURCE_KEYS[key]);
      const leads =
        crm.filter((c) => wanted.has(c.sourceKey)).length +
        lost.filter((l) => wanted.has(l.sourceKey)).length;
      if (leads > 0) platformLeadCounts.set(key, leads);
    }
    const platformsWithoutSpendTab = [...platformLeadCounts.entries()]
      .map(([platform, leads]) => ({ platform, leads }))
      .sort((a, b) => b.leads - a.leads);

    const crmWithCampaign = crm.filter((c) => c.fromCampaign);
    const crmMatched = crmWithCampaign.filter((c) => adCampaignKeys.has(c.campaignKey));

    // A source stops being "unpriced" the moment its platform has a spend tab,
    // so adding TikTok Ads Daily silently removes TikTok from this note instead
    // of leaving a stale claim that its leads are free.
    const unpricedCounts = new Map<string, number>();
    for (const c of crm) {
      if (!c.sourceKey) continue;
      if (!SOURCES_WITHOUT_SPEND.has(c.sourceKey)) continue;
      if (platformsWithSpendTab.has(c.sourceKey)) continue;
      unpricedCounts.set(c.sourceKey, (unpricedCounts.get(c.sourceKey) ?? 0) + 1);
    }
    const unpricedSources = [...unpricedCounts.entries()]
      .map(([label, count]) => ({ label: sourceLabels.get(label) ?? label, count }))
      .sort((a, b) => b.count - a.count);

    const closable = crm.filter((c) => c.daysToClose !== null && c.daysToClose >= 0);
    const negativeRows = accounting.filter((r) => r.usdPaid < 0);

    const health: DataHealth = {
      crmAuthority,
      lostAuthority,
      lostDateBasis:
        lostAuthority === "odoo-direct" || lostAuthority === "postgres-last-good"
          ? "creation_date"
          : "unavailable",
      accountingAuthority,
      accountingDirect: accountingDirectHealth,
      crmExclusions,
      lostExclusions,
      crmRows: crm.length,
      invoicedRows: invoiced.length,
      accountingSourceRows: accountingSourceRaw.length,
      accountingRefundRowsExcluded: accountingSelection.refundRowsExcluded,
      accountingCreditNoteRowsIncluded: accountingSelection.creditNoteRowsIncluded,
      accountingDuplicateRowsExcluded: accountingSelection.duplicateRowsExcluded,
      accountingRows: accounting.length,
      salesRows: accounting.length,
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
      accountingAdCoverage:
        accounting.length > 0
          ? accounting.filter((row) => row.adName || row.adId).length / accounting.length
          : 0,
      invoicedAdCoverage:
        accounting.length > 0
          ? accounting.filter((row) => row.adName || row.adId).length / accounting.length
          : 0,
      revenueCampaignCoverage:
        accounting.length > 0 ? campaignRevenueRows.length / accounting.length : 0,
      revenueCampaignShare: totalRevenue > 0 ? campaignRevenue / totalRevenue : 0,
      attributedRevenueShare: totalRevenue > 0 ? attributedRevenue / totalRevenue : 0,
      campaignMatchRate:
        crmWithCampaign.length > 0 ? crmMatched.length / crmWithCampaign.length : 0,
      leadsWithoutSpendSource: [...unpricedCounts.values()].reduce((a, b) => a + b, 0),
      unpricedSources,
      platformsWithoutSpendTab,
      excludedStages: [...excludedStageCounts.entries()]
        .map(([stage, rows]) => ({ stage, rows }))
        .sort((a, b) => b.rows - a.rows),
      salesOrderMatchRate: totalRevenue > 0 ? matchedRevenue / totalRevenue : 0,
      salesCampaignShare: totalRevenue > 0 ? accountingCampaignRevenue / totalRevenue : 0,
      closeSample: closable.length,
      closeCoverage: crm.length > 0 ? closable.length / crm.length : 0,
      invoicedMissingDate: invoiced.filter((i) => !i.revenueDate).length,
      crmMissingDate: crm.filter((c) => !c.createdAt).length,
      accountingMissingDate: accountingMissingPaymentDate,
      salesMissingDate: accountingMissingPaymentDate,
      negativeRevenueRows: negativeRows.length,
      negativeRevenue: negativeRows.reduce((s, r) => s + r.usdPaid, 0),
    };

    return {
      fetchedAt: Date.now(),
      lastAttemptAt: Date.now(),
      ads,
      campaignStates,
      crm,
      invoiced,
      accounting,
      // Temporary API compatibility. All first-party computation uses
      // `accounting`; this alias can be removed after downstream migration.
      sales: accounting,
      websiteSales,
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
      staleTabs,
    };
  })();

  // Captured so a refresh that finishes after being declared stuck cannot clear
  // the pointer to the one that replaced it.
  const mine = inflight;
  const previous = cache;
  try {
    const next = await mine;
    // If a tab came back empty but a good snapshot is still held, keep serving
    // the stale one rather than blanking the dashboard.
    //
    // This used to test only ads/crm/invoiced/accounting, so a wiped Website Sales or
    // Lost Analysis tab passed as a healthy load and cached zeros for the full
    // TTL — the Website Analysis page reading empty was exactly this. Any tab
    // that previously carried rows and now carries none fails the check.
    const emptied = (rows: unknown[], key: string) =>
      !rows.length && !!previous && (previous[key as keyof Snapshot] as unknown[]).length > 0;
    const empty =
      (!next.ads.length && !next.crm.length && !next.invoiced.length && !next.accounting.length) ||
      emptied(next.websiteSales, "websiteSales") ||
      emptied(next.lost, "lost") ||
      emptied(next.crm, "crm") ||
      emptied(next.invoiced, "invoiced") ||
      emptied(next.accounting, "accounting") ||
      emptied(next.ads, "ads");
    if (empty && previous) {
      // Dataset-level fallbacks above already preserve every healthy source.
      // A named non-critical error (for example Archived Lost being temporarily
      // unavailable) must not freeze Meta, Accounting and every other source at
      // the previous snapshot. Only reject the reload when a previously
      // populated critical dataset actually became empty.
      // Leave `fetchedAt` alone so the rejected attempt is never shown as fresh.
      cache = {
        ...previous,
        lastAttemptAt: Date.now(),
        fetchErrors: next.fetchErrors,
        staleTabs: [...new Set([...previous.staleTabs, ...next.staleTabs])],
      };
      return cache;
    }
    // An ingest committed after this rebuild began. Publishing `next` would
    // stamp a pre-ingest read as fresh for another five minutes. Keep the
    // snapshot stale so the next request starts one clean rebuild instead.
    if (cacheRevision !== revisionAtStart) {
      // On a cold process there is no previous snapshot to retain. The rebuild
      // is still usable, but it must not masquerade as including the ingest.
      cache = { ...(previous ?? next), lastAttemptAt: Date.now() - TTL_MS };
      return cache;
    }
    cache = next;
    return cache;
  } catch (e) {
    if (previous) return previous;
    throw e;
  } finally {
    if (inflight === mine) inflight = null;
  }
}

export function invalidateCache() {
  invalidateDataCache();
}

export { parseDate, daysBetween, SOURCES_WITHOUT_SPEND };
