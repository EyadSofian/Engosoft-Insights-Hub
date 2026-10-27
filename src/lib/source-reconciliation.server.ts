// Checks dashboard numbers against the systems they claim to come from.
//
// The point of this module is that internal agreement is not evidence. Before
// it existed, every health indicator on this dashboard compared one internal
// surface to another: `/api/overview` against `/api/ads`, a stored snapshot
// against the snapshot it was copied from. Those can agree perfectly while
// both are wrong, and in September 2026 they did -- two invoice lines worth
// $5,324.93 were missing from the PostgreSQL accounting dataset and both
// surfaces reported the same understated total.
//
// So a check here is only green when it has asked the original system. A
// metric that cannot be asked is SOURCE_UNAVAILABLE, never green.
import { metaOfficialDelivery } from "./meta-insights.server";
import { odooConfig, searchRead, type Domain } from "./odoo.server";
import { odooCall } from "./odoo.server";
import { computeTotals, getFiltered } from "./metrics.server";
import { accountingReportingDate } from "./accounting-policy";
import { DEFAULT_FX_RATES } from "./fx-rates";
import type { GlobalFilters } from "./types";

export type ReconciliationStatus =
  "MATCHED" | "SMALL_DIFFERENCE" | "MISMATCH" | "SOURCE_UNAVAILABLE" | "STALE" | "NOT_VALIDATED";

export type ReconciliationUnit = "usd" | "count";

export interface ReconciliationCheck {
  metricId: string;
  label: { ar: string; en: string };
  /** Plain-language answer to "what does this number mean?" */
  note: { ar: string; en: string };
  period: { from: string; to: string };
  filters: Record<string, string>;
  sourceSystem: string;
  sourceEntity: string;
  sourceValue: number | null;
  dashboardValue: number | null;
  difference: number | null;
  differencePercent: number | null;
  unit: ReconciliationUnit;
  status: ReconciliationStatus;
  lastCheckedAt: string;
  /** Why a source could not be read, when that is the outcome. */
  unavailableReason: string;
  /** Dashboard routes whose figures depend on this check. */
  affectedPages: string[];
}

export interface SourceGroup {
  key: string;
  system: string;
  label: { ar: string; en: string };
  status: ReconciliationStatus;
  checks: ReconciliationCheck[];
  /** Freshness of the data the dashboard serves for this system, if known. */
  syncedAt: string;
  unavailableReason: string;
}

export interface SourceReconciliation {
  period: { from: string; to: string };
  generatedAt: string;
  durationMs: number;
  groups: SourceGroup[];
  summary: Record<ReconciliationStatus, number>;
  /** Worst status across every check; what the navigation badge should show. */
  worst: ReconciliationStatus;
}

/* -- thresholds ------------------------------------------------------------ */

// Money moves under us: a platform's last reporting day is still settling and
// a payment recorded a minute ago is real. A dollar either way is not a
// finding; a percent either way is worth a look; more than that is wrong.
const MONEY_EXACT_USD = 1;
const MONEY_EXACT_RATIO = 0.0005;
const MONEY_SMALL_RATIO = 0.01;
// A count is a count. Nothing legitimately changes it by a fraction.
const COUNT_SMALL_RATIO = 0.005;

const STATUS_RANK: Record<ReconciliationStatus, number> = {
  MATCHED: 0,
  SMALL_DIFFERENCE: 1,
  STALE: 2,
  NOT_VALIDATED: 3,
  SOURCE_UNAVAILABLE: 4,
  MISMATCH: 5,
};

export function worstStatus(statuses: ReconciliationStatus[]): ReconciliationStatus {
  return statuses.reduce<ReconciliationStatus>(
    (worst, status) => (STATUS_RANK[status] > STATUS_RANK[worst] ? status : worst),
    "MATCHED",
  );
}

export function classify(
  sourceValue: number | null,
  dashboardValue: number | null,
  unit: ReconciliationUnit,
): { status: ReconciliationStatus; difference: number | null; differencePercent: number | null } {
  if (sourceValue === null || dashboardValue === null) {
    return { status: "SOURCE_UNAVAILABLE", difference: null, differencePercent: null };
  }
  const difference = dashboardValue - sourceValue;
  const scale = Math.abs(sourceValue);
  const differencePercent = scale > 0 ? (difference / scale) * 100 : difference === 0 ? 0 : null;
  const size = Math.abs(difference);
  if (unit === "count") {
    if (size === 0) return { status: "MATCHED", difference, differencePercent };
    if (scale > 0 && size / scale <= COUNT_SMALL_RATIO) {
      return { status: "SMALL_DIFFERENCE", difference, differencePercent };
    }
    return { status: "MISMATCH", difference, differencePercent };
  }
  if (size <= MONEY_EXACT_USD || (scale > 0 && size / scale <= MONEY_EXACT_RATIO)) {
    return { status: "MATCHED", difference, differencePercent };
  }
  if (scale > 0 && size / scale <= MONEY_SMALL_RATIO) {
    return { status: "SMALL_DIFFERENCE", difference, differencePercent };
  }
  return { status: "MISMATCH", difference, differencePercent };
}

/* -- helpers --------------------------------------------------------------- */

const now = () => new Date().toISOString();

const cairoDay = (value: unknown): string => {
  if (value === false || value === null || value === undefined) return "";
  const raw = String(value).trim();
  if (!raw || raw.toLowerCase() === "false") return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const instant = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(raw) ? raw : `${raw.replace(" ", "T")}Z`);
  if (!Number.isFinite(instant.getTime())) return raw.slice(0, 10);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

function check(
  input: Omit<
    ReconciliationCheck,
    "difference" | "differencePercent" | "status" | "lastCheckedAt"
  > & { status?: ReconciliationStatus },
): ReconciliationCheck {
  const verdict = classify(input.sourceValue, input.dashboardValue, input.unit);
  return {
    ...input,
    difference: verdict.difference,
    differencePercent: verdict.differencePercent,
    status: input.status ?? verdict.status,
    lastCheckedAt: now(),
  };
}

/* -- Odoo ------------------------------------------------------------------ */

/** Minutes Africa/Cairo is ahead of UTC at a given instant (handles DST). */
function cairoOffsetMinutes(at: Date): number {
  const name =
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Africa/Cairo",
      timeZoneName: "longOffset",
    })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT+00:00";
  const match = /GMT([+-])(\d{1,2}):?(\d{2})?/.exec(name);
  if (!match) return 0;
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

/** The UTC instant of Cairo local midnight on `day`, as Odoo writes datetimes. */
function cairoStartUtc(day: string): string {
  const naive = Date.parse(`${day}T00:00:00Z`);
  // Two passes so a day that begins either side of a DST change settles.
  let instant = new Date(naive);
  for (let pass = 0; pass < 2; pass += 1) {
    instant = new Date(naive - cairoOffsetMinutes(instant) * 60_000);
  }
  return instant.toISOString().slice(0, 19).replace("T", " ");
}

function nextDay(day: string): string {
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/**
 * How many CRM records Odoo itself counted in the window.
 *
 * This is deliberately `search_count`, not a row read: Odoo's own SQL answers,
 * so the number is independent of how this app classifies the rows it loads.
 * Its dashboard counterpart is the reportable population plus the sources the
 * dashboard excludes from it, which is what makes the exclusion bookkeeping
 * checkable rather than merely asserted.
 */
async function odooCrmRecordsCreated(from: string, to: string): Promise<number> {
  const domain: Domain = [
    ["inventory_bucket", "=", false],
    ["type", "in", ["lead", "opportunity"]],
    // Odoo stores create_date in UTC and the dashboard buckets by Cairo day,
    // so the window has to be converted or the count is wrong at both edges.
    // Passing the dates through unconverted counted 10 extra September records
    // -- leads created in the last Cairo-evening hours of 30 September, which
    // are 1 October in Cairo -- and reported the dashboard as 10 short.
    ["create_date", ">=", cairoStartUtc(from)],
    ["create_date", "<", cairoStartUtc(nextDay(to))],
  ];
  return odooCall<number>("crm.lead", "search_count", [domain], {
    context: { active_test: false },
  });
}

interface OdooCollections {
  usd: number;
  invoices: number;
  rows: number;
}

/**
 * Collections and invoice count read from Odoo's own invoice analysis.
 *
 * Every rule the dashboard applies is applied here too, from the same source
 * of record: posted customer invoices and refunds, the reporting companies,
 * the invoice's `payment_date`, each line's own sign, the business FX rates,
 * and credit notes recognised on their reversal date. The one thing this does
 * not share is the PostgreSQL snapshot in between, which is exactly the thing
 * being checked.
 */
async function odooCollections(from: string, to: string): Promise<OdooCollections> {
  const cfg = odooConfig();
  const rows = await searchRead<{
    id: number;
    move_id: [number, string] | false;
    move_type: string | false;
    invoice_date: string | false;
    payment_date: string | false;
    currency_id: [number, string] | false;
    price_total: number;
  }>(
    "account.invoice.report",
    [
      ["move_type", "in", ["out_invoice", "out_refund"]],
      ["state", "=", "posted"],
      ["invoice_date", ">=", cfg.startDate],
      ["company_id", "in", cfg.companyIds],
    ],
    ["move_id", "move_type", "invoice_date", "payment_date", "currency_id", "price_total"],
    { context: { active_test: false } },
  );

  const fx: Record<string, number> = {
    USD: 1,
    EGP: 1 / DEFAULT_FX_RATES.EGP,
    SAR: 1 / DEFAULT_FX_RATES.SAR,
    // Matches the emergency AED rate the readers apply.
    AED: 0.27,
  };

  // Credit notes are anchored to their document, exactly as the live pipeline
  // does, so a reversal that gives a discount back is not subtracted twice.
  const netByMove = new Map<string, number>();
  for (const row of rows) {
    if (row.move_type !== "out_refund") continue;
    const move = Array.isArray(row.move_id) ? row.move_id[1] : "";
    if (!move) continue;
    netByMove.set(move, (netByMove.get(move) ?? 0) + Number(row.price_total || 0));
  }

  let usd = 0;
  let counted = 0;
  const invoices = new Set<string>();
  for (const row of rows) {
    const isCreditNote = row.move_type === "out_refund";
    const move = Array.isArray(row.move_id) ? row.move_id[1] : "";
    const reportedOn = isCreditNote
      ? cairoDay(row.invoice_date) || cairoDay(row.payment_date)
      : cairoDay(row.payment_date);
    if (!reportedOn || reportedOn < from || reportedOn > to) continue;
    const currency = String(Array.isArray(row.currency_id) ? row.currency_id[1] : "").toUpperCase();
    const flip = isCreditNote && (netByMove.get(move) ?? 0) > 0 ? -1 : 1;
    usd += flip * Number(row.price_total || 0) * (fx[currency] ?? 0);
    counted += 1;
    if (!isCreditNote && move) invoices.add(move);
  }
  return { usd, invoices: invoices.size, rows: counted };
}

/* -- TikTok ---------------------------------------------------------------- */

/**
 * Advertiser-level TikTok delivery, which is a real second opinion on the
 * ad-level report the dashboard sums: if ad rows are lost or double counted on
 * the way in, the two totals part company.
 */
async function tiktokOfficialSpend(
  from: string,
  to: string,
): Promise<{ ok: boolean; spend: number; impressions: number; clicks: number; error: string }> {
  const token = process.env.TIKTOK_ACCESS_TOKEN?.trim() ?? "";
  const ids = (process.env.TIKTOK_ADVERTISER_IDS ?? "")
    .split(/[,\s]+/)
    .map((id) => id.trim())
    .filter(Boolean);
  if (!token || ids.length === 0) {
    return { ok: false, spend: 0, impressions: 0, clicks: 0, error: "TikTok is not configured." };
  }
  let spend = 0;
  let impressions = 0;
  let clicks = 0;
  const errors: string[] = [];
  for (const advertiserId of ids) {
    const url = new URL("https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/");
    url.searchParams.set("advertiser_id", advertiserId);
    url.searchParams.set("report_type", "BASIC");
    url.searchParams.set("data_level", "AUCTION_ADVERTISER");
    url.searchParams.set("dimensions", JSON.stringify(["advertiser_id"]));
    url.searchParams.set("metrics", JSON.stringify(["spend", "impressions", "clicks"]));
    url.searchParams.set("start_date", from);
    url.searchParams.set("end_date", to);
    url.searchParams.set("page_size", "1000");
    try {
      const response = await fetch(url, {
        headers: { "Access-Token": token },
        cache: "no-store",
        signal: AbortSignal.timeout(60_000),
      });
      const body = (await response.json().catch(() => ({}))) as {
        code?: number;
        message?: string;
        data?: { list?: { metrics?: Record<string, unknown> }[] };
      };
      if (body.code !== 0) {
        errors.push(`${advertiserId}: ${String(body.message ?? "TikTok error").slice(0, 160)}`);
        continue;
      }
      for (const row of body.data?.list ?? []) {
        spend += Number(row.metrics?.spend ?? 0);
        impressions += Number(row.metrics?.impressions ?? 0);
        clicks += Number(row.metrics?.clicks ?? 0);
      }
    } catch (error) {
      errors.push(
        `${advertiserId}: ${error instanceof Error ? error.message.slice(0, 160) : "request failed"}`,
      );
    }
  }
  return { ok: errors.length === 0, spend, impressions, clicks, error: errors.join(" | ") };
}

/* -- Google Ads ------------------------------------------------------------ */

async function googleAccessToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_ADS_CLIENT_ID?.trim() ?? "",
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET?.trim() ?? "",
    refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim() ?? "",
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await response.json().catch(() => ({}))) as { access_token?: string };
  if (!json.access_token) throw new Error("Google OAuth did not return an access token.");
  return json.access_token;
}

/**
 * Customer-level Google Ads cost and lead-category conversions.
 *
 * `FROM customer` is a different aggregation than the `FROM ad_group_ad` report
 * the dashboard sums, so this catches lost or duplicated ad rows. Leads are
 * asked for by conversion-action category: the unsegmented `metrics.conversions`
 * on this account is overwhelmingly YouTube channel subscriptions.
 */
interface GoogleOfficial {
  spendOk: boolean;
  leadsOk: boolean;
  spend: number;
  leads: number;
  error: string;
  spendError: string;
  leadsError: string;
}

async function googleOfficial(from: string, to: string): Promise<GoogleOfficial> {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim() ?? "";
  const customerIds = (process.env.GOOGLE_ADS_CUSTOMER_IDS ?? "")
    .split(/[,\s]+/)
    .map((id) => id.replace(/-/g, "").trim())
    .filter(Boolean);
  const loginCustomerId = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? "").replace(/-/g, "").trim();
  if (!developerToken || customerIds.length === 0) {
    const reason = "Google Ads is not configured.";
    return {
      spendOk: false,
      leadsOk: false,
      spend: 0,
      leads: 0,
      error: reason,
      spendError: reason,
      leadsError: reason,
    };
  }
  let token: string;
  try {
    token = await googleAccessToken();
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 200) : "Google OAuth failed";
    return {
      spendOk: false,
      leadsOk: false,
      spend: 0,
      leads: 0,
      error: reason,
      spendError: reason,
      leadsError: reason,
    };
  }

  const run = async (customerId: string, query: string) => {
    const response = await fetch(
      `https://googleads.googleapis.com/v25/customers/${customerId}/googleAds:searchStream`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "developer-token": developerToken,
          ...(loginCustomerId ? { "login-customer-id": loginCustomerId } : {}),
          "content-type": "application/json",
        },
        body: JSON.stringify({ query }),
        cache: "no-store",
        signal: AbortSignal.timeout(120_000),
      },
    );
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
    const batches = JSON.parse(text) as { results?: { metrics?: Record<string, unknown> }[] }[];
    return batches.flatMap((batch) => batch.results ?? []);
  };

  const LEAD_CATEGORIES =
    "'SUBMIT_LEAD_FORM','PHONE_CALL_LEAD','CONTACT','BOOK_APPOINTMENT','REQUEST_QUOTE','SIGNUP','IMPORTED_LEAD'";
  let spend = 0;
  let leads = 0;
  // Cost and leads are two queries, and one failing must not void the other:
  // reporting a verified spend as unverifiable hides a good check behind a
  // broken one.
  const costErrors: string[] = [];
  const leadErrors: string[] = [];
  for (const customerId of customerIds) {
    try {
      const costRows = await run(
        customerId,
        `SELECT metrics.cost_micros FROM customer WHERE segments.date BETWEEN '${from}' AND '${to}'`,
      );
      for (const row of costRows) spend += Number(row.metrics?.costMicros ?? 0) / 1_000_000;
    } catch (error) {
      costErrors.push(
        `${customerId}: ${error instanceof Error ? error.message.slice(0, 300) : "request failed"}`,
      );
    }
    try {
      // `segments.conversion_action_category` has to appear in SELECT as well
      // as WHERE, or Google answers EXPECTED_REFERENCED_FIELD_IN_SELECT_CLAUSE.
      const leadRows = await run(
        customerId,
        `SELECT segments.conversion_action_category, metrics.conversions FROM customer WHERE segments.date BETWEEN '${from}' AND '${to}' AND segments.conversion_action_category IN (${LEAD_CATEGORIES})`,
      );
      for (const row of leadRows) leads += Number(row.metrics?.conversions ?? 0);
    } catch (error) {
      leadErrors.push(
        `${customerId}: ${error instanceof Error ? error.message.slice(0, 300) : "request failed"}`,
      );
    }
  }
  return {
    spendOk: costErrors.length === 0,
    leadsOk: leadErrors.length === 0,
    spend,
    leads,
    error: [...costErrors, ...leadErrors].join(" | "),
    spendError: costErrors.join(" | "),
    leadsError: leadErrors.join(" | "),
  };
}

/* -- the report ------------------------------------------------------------ */

const CACHE_MS = 10 * 60 * 1000;
let cache: { key: string; value: SourceReconciliation; expiresAt: number } | null = null;
let inflight: { key: string; promise: Promise<SourceReconciliation> } | null = null;

export async function sourceReconciliation(
  filters: Pick<GlobalFilters, "from" | "to"> = {},
  options: { force?: boolean } = {},
): Promise<SourceReconciliation> {
  const data = await getFiltered({ ...filters });
  const from = data.applied.from || filters.from || "";
  const to = data.applied.to || filters.to || "";
  const key = `${from}..${to}`;
  if (!options.force && cache && cache.key === key && cache.expiresAt > Date.now()) {
    return cache.value;
  }
  if (inflight && inflight.key === key) return inflight.promise;
  const promise = build(from, to)
    .then((value) => {
      cache = { key, value, expiresAt: Date.now() + CACHE_MS };
      return value;
    })
    .finally(() => {
      inflight = null;
    });
  inflight = { key, promise };
  return promise;
}

async function build(from: string, to: string): Promise<SourceReconciliation> {
  const startedAt = Date.now();
  const generatedAt = now();
  const period = { from, to };
  const filters = { from, to };

  const data = await getFiltered({ from, to });
  const totals = computeTotals(data);
  const platformSources = (data.snapshot.health?.platformSources ?? {}) as Record<
    string,
    { syncedAt?: string; source?: string; configured?: boolean; ok?: boolean }
  >;

  const [crmCount, collections, meta, tiktok, google] = await Promise.all([
    odooCrmRecordsCreated(from, to).catch((error: unknown) => error as Error),
    odooCollections(from, to).catch((error: unknown) => error as Error),
    metaOfficialDelivery(from, to),
    tiktokOfficialSpend(from, to),
    googleOfficial(from, to),
  ]);

  const excluded = data.excludedLeads;
  const dashboardRecordsCreated =
    totals.totalLeads +
    excluded.recommendation +
    excluded.whatsappBroadcast +
    excluded.autodialerBroadcast;

  const odooChecks: ReconciliationCheck[] = [
    check({
      metricId: "crm.records_created",
      label: { ar: "العملاء اللي دخلوا الفترة دي", en: "CRM records created in the period" },
      note: {
        ar: "كل ليد اتفتح في Odoo في الفترة دي، حتى اللي مش محسوب علينا زي الترشيحات والبرودكاست. عدّيناه من Odoo نفسه وقارناه بالرقم اللي الداشبورد بيعرضه زائد اللي بيستثنيه.",
        en: "Every lead opened in Odoo in this window, including the sources the dashboard excludes. Counted by Odoo itself and compared with the dashboard's reportable population plus its exclusions.",
      },
      period,
      filters,
      sourceSystem: "Odoo",
      sourceEntity: "crm.lead / search_count",
      sourceValue: crmCount instanceof Error ? null : crmCount,
      dashboardValue: dashboardRecordsCreated,
      unit: "count",
      unavailableReason: crmCount instanceof Error ? crmCount.message.slice(0, 200) : "",
      affectedPages: ["/", "/leads", "/campaigns", "/teams"],
    }),
    check({
      metricId: "accounting.collections_usd",
      label: { ar: "الفلوس اللي اتحصلت الفترة دي", en: "Collections in the period" },
      note: {
        ar: "مجموع الفواتير المدفوعة بتاريخ الدفع، بالدولار على سعر الشركة المعتمد، وبعد خصم الإشعارات. قريناها من Odoo على طول، من غير النسخة المخزّنة اللي الداشبورد بيقرأ منها.",
        en: "Paid invoices by payment date, in USD at the approved business rate, net of credit notes. Read straight from Odoo, bypassing the stored snapshot the dashboard serves.",
      },
      period,
      filters,
      sourceSystem: "Odoo",
      sourceEntity: "account.invoice.report / payment_date",
      sourceValue: collections instanceof Error ? null : collections.usd,
      dashboardValue: totals.accountingRevenue,
      unit: "usd",
      unavailableReason: collections instanceof Error ? collections.message.slice(0, 200) : "",
      affectedPages: ["/", "/accounting", "/courses", "/teams", "/media-buyers"],
    }),
    check({
      metricId: "accounting.invoices",
      label: { ar: "عدد الفواتير المدفوعة", en: "Paid invoices" },
      note: {
        ar: "عدد الفواتير المختلفة اللي اتدفعت في الفترة. بيتعد بالفاتورة، مش بالبند.",
        en: "Distinct invoices paid in the window, counted per invoice rather than per product line.",
      },
      period,
      filters,
      sourceSystem: "Odoo",
      sourceEntity: "account.invoice.report / distinct move",
      sourceValue: collections instanceof Error ? null : collections.invoices,
      dashboardValue: totals.orders,
      unit: "count",
      unavailableReason: collections instanceof Error ? collections.message.slice(0, 200) : "",
      affectedPages: ["/accounting", "/"],
    }),
  ];

  const metaChecks: ReconciliationCheck[] = [
    check({
      metricId: "meta.spend",
      label: { ar: "صرف Meta", en: "Meta spend" },
      note: {
        ar: "اللي Meta نفسها بتقول إنها حسبته علينا في الفترة، على كل الحسابات. الداشبورد بياخد الرقم ده من نسخة n8n المخزّنة، فده أهم فحص فيهم.",
        en: "What Meta itself says it charged in the window, across every ad account. The dashboard takes this figure from the stored n8n copy, which makes this the most important check of the four.",
      },
      period,
      filters,
      sourceSystem: "Meta",
      sourceEntity: "Graph API /insights (level=account)",
      sourceValue: meta.ok ? meta.spend : null,
      dashboardValue: totals.spendMeta,
      unit: "usd",
      unavailableReason: meta.ok ? "" : meta.errors.join(" | ").slice(0, 200),
      affectedPages: ["/", "/ads", "/campaigns", "/creatives", "/media-buyers"],
    }),
    check({
      metricId: "meta.impressions",
      label: { ar: "مرات ظهور Meta", en: "Meta impressions" },
      note: {
        ar: "عدد مرات ظهور الإعلانات على Meta في الفترة، من Meta نفسها.",
        en: "Ad impressions Meta reports for the window, from Meta itself.",
      },
      period,
      filters,
      sourceSystem: "Meta",
      sourceEntity: "Graph API /insights (level=account)",
      sourceValue: meta.ok ? meta.impressions : null,
      dashboardValue:
        data.ads
          .filter((row) => row.platform === "meta")
          .reduce((total, row) => total + row.impressions, 0) || 0,
      unit: "count",
      unavailableReason: meta.ok ? "" : meta.errors.join(" | ").slice(0, 200),
      affectedPages: ["/ads", "/campaigns"],
    }),
    check({
      metricId: "meta.platform_leads",
      label: { ar: "العملاء اللي Meta بتقول إنها جابتهم", en: "Meta-reported leads" },
      note: {
        ar: "الليدز اللي Meta بتحسبها على الحملة. دي مش نفس عدد العملاء في Odoo: ممكن نفس الشخص يكلمنا مرتين، وفي ليدز بتوصلنا من غير Meta.",
        en: "Leads Meta credits to the ads. This is not the Odoo lead count: one person can message twice, and leads also arrive from outside Meta.",
      },
      period,
      filters,
      sourceSystem: "Meta",
      sourceEntity: "Graph API /insights, onsite_conversion.lead_grouped",
      sourceValue: meta.ok ? meta.leads : null,
      dashboardValue:
        data.ads
          .filter((row) => row.platform === "meta")
          .reduce((total, row) => total + (row.platformLeads ?? 0), 0) || 0,
      unit: "count",
      unavailableReason: meta.ok ? "" : meta.errors.join(" | ").slice(0, 200),
      affectedPages: ["/ads", "/campaigns", "/attribution"],
    }),
  ];

  const tiktokChecks: ReconciliationCheck[] = [
    check({
      metricId: "tiktok.spend",
      label: { ar: "صرف TikTok", en: "TikTok spend" },
      note: {
        ar: "إجمالي الحساب من TikTok نفسها، مقابل مجموع صفوف الإعلانات اللي الداشبورد جمعها. لو اختلفوا يبقى فيه صفوف ضايعة أو مكرّرة.",
        en: "TikTok's own advertiser-level total against the ad rows the dashboard sums. A gap means rows were lost or counted twice on the way in.",
      },
      period,
      filters,
      sourceSystem: "TikTok",
      sourceEntity: "Marketing API v1.3 report/integrated (AUCTION_ADVERTISER)",
      sourceValue: tiktok.ok ? tiktok.spend : null,
      dashboardValue: totals.spendTikTok,
      unit: "usd",
      unavailableReason: tiktok.ok ? "" : tiktok.error.slice(0, 200),
      affectedPages: ["/", "/ads", "/campaigns"],
    }),
  ];

  const googleChecks: ReconciliationCheck[] = [
    check({
      metricId: "google.spend",
      label: { ar: "صرف Google", en: "Google Ads spend" },
      note: {
        ar: "تكلفة الحساب من Google نفسها، مقابل مجموع صفوف الإعلانات في الداشبورد.",
        en: "Google's own customer-level cost against the ad rows the dashboard sums.",
      },
      period,
      filters,
      sourceSystem: "Google Ads",
      sourceEntity: "Google Ads v25 GAQL (FROM customer)",
      sourceValue: google.spendOk ? google.spend : null,
      dashboardValue: totals.spendGoogle,
      unit: "usd",
      unavailableReason: google.spendOk ? "" : google.spendError.slice(0, 300),
      affectedPages: ["/", "/ads", "/campaigns"],
    }),
    check({
      metricId: "google.platform_leads",
      label: { ar: "العملاء اللي Google بتقول إنها جابتهم", en: "Google-reported leads" },
      note: {
        ar: "التحويلات اللي فعلاً معناها عميل: فورم اتعبى، مكالمة، تسجيل. مش الاشتراك في قناة اليوتيوب، اللي كان بيتحسب ليد غلط.",
        en: "Only conversions that mean an actual lead: a submitted form, a lead call, a sign-up. Not a YouTube channel subscription, which used to be counted as one.",
      },
      period,
      filters,
      sourceSystem: "Google Ads",
      sourceEntity: "GAQL segments.conversion_action_category (lead categories)",
      sourceValue: google.leadsOk ? google.leads : null,
      dashboardValue:
        data.ads
          .filter((row) => row.platform === "google")
          .reduce((total, row) => total + (row.platformLeads ?? 0), 0) || 0,
      unit: "count",
      unavailableReason: google.leadsOk ? "" : google.leadsError.slice(0, 300),
      affectedPages: ["/ads", "/campaigns"],
    }),
  ];

  // Snapchat has no API path in this deployment, so its spend is reported but
  // never verified. Saying so is the whole point: a number nobody can check
  // must not sit next to three that were checked wearing the same colour.
  const snapchatChecks: ReconciliationCheck[] = [
    check({
      metricId: "snapchat.spend",
      label: { ar: "صرف Snapchat", en: "Snapchat spend" },
      note: {
        ar: "الرقم ده جاي من n8n/الشيت وبس. مفيش مفاتيح Snapchat على السيرفر، فمحدش يقدر يراجعه على Snapchat نفسها. عايزين Snapchat Marketing API عشان يتأكد.",
        en: "This figure arrives from n8n/the sheet only. No Snapchat credentials are deployed, so nothing can check it against Snapchat itself. Snapchat Marketing API credentials would close it.",
      },
      period,
      filters,
      sourceSystem: "Snapchat",
      sourceEntity: "not reachable — no credentials deployed",
      sourceValue: null,
      dashboardValue: totals.spendSnap,
      unit: "usd",
      status: "SOURCE_UNAVAILABLE",
      unavailableReason:
        "No Snapchat Marketing API credentials are configured, so this number cannot be verified against Snapchat.",
      affectedPages: ["/", "/ads", "/campaigns"],
    }),
  ];

  // The all-channel bill is only as verified as its least verified part.
  const verifiedSpend =
    (meta.ok ? meta.spend : null) !== null && tiktok.ok && google.spendOk
      ? meta.spend + tiktok.spend + google.spend + totals.spendSnap
      : null;
  const crossChecks: ReconciliationCheck[] = [
    check({
      metricId: "marketing.total_spend",
      label: { ar: "صرف الإعلانات كله", en: "All-channel ad spend" },
      note: {
        ar: "Meta + TikTok + Google + Snapchat. تلاتة منهم اتراجعوا على المنصة نفسها، وSnapchat لأ، فالرقم ده مراجع جزئيًا.",
        en: "Meta + TikTok + Google + Snapchat. Three were checked against the platform itself and Snapchat was not, so this total is only partly verified.",
      },
      period,
      filters,
      sourceSystem: "Meta + TikTok + Google Ads (+ unverified Snapchat)",
      sourceEntity: "sum of each platform's own report",
      sourceValue: verifiedSpend,
      dashboardValue: totals.spend,
      unit: "usd",
      status:
        verifiedSpend === null
          ? "SOURCE_UNAVAILABLE"
          : classify(verifiedSpend, totals.spend, "usd").status === "MATCHED"
            ? "SMALL_DIFFERENCE"
            : classify(verifiedSpend, totals.spend, "usd").status,
      unavailableReason:
        verifiedSpend === null
          ? "At least one platform could not be read, so the all-channel total cannot be verified."
          : "Snapchat is included at its dashboard value because it cannot be verified.",
      affectedPages: ["/", "/ads", "/campaigns", "/media-plan"],
    }),
  ];

  const groups: SourceGroup[] = [
    {
      key: "odoo",
      system: "Odoo",
      label: { ar: "Odoo — العملاء والفلوس", en: "Odoo — CRM and money" },
      checks: odooChecks,
      status: worstStatus(odooChecks.map((item) => item.status)),
      syncedAt: String(data.snapshot.syncedAt ?? ""),
      unavailableReason: "",
    },
    {
      key: "meta",
      system: "Meta",
      label: { ar: "Meta", en: "Meta" },
      checks: metaChecks,
      status: worstStatus(metaChecks.map((item) => item.status)),
      syncedAt: String(platformSources.meta?.syncedAt ?? ""),
      unavailableReason: meta.ok ? "" : meta.errors.join(" | ").slice(0, 200),
    },
    {
      key: "tiktok",
      system: "TikTok",
      label: { ar: "TikTok", en: "TikTok" },
      checks: tiktokChecks,
      status: worstStatus(tiktokChecks.map((item) => item.status)),
      syncedAt: String(platformSources.tiktok?.syncedAt ?? ""),
      unavailableReason: tiktok.ok ? "" : tiktok.error.slice(0, 200),
    },
    {
      key: "google",
      system: "Google Ads",
      label: { ar: "Google", en: "Google Ads" },
      checks: googleChecks,
      status: worstStatus(googleChecks.map((item) => item.status)),
      syncedAt: "",
      unavailableReason: google.spendOk && google.leadsOk ? "" : google.error.slice(0, 300),
    },
    {
      key: "snapchat",
      system: "Snapchat",
      label: { ar: "Snapchat", en: "Snapchat" },
      checks: snapchatChecks,
      status: "SOURCE_UNAVAILABLE",
      syncedAt: "",
      unavailableReason:
        "No Snapchat Marketing API credentials are configured in this environment.",
    },
    {
      key: "cross",
      system: "All channels",
      label: { ar: "كل المنصات مع بعض", en: "All channels together" },
      checks: crossChecks,
      status: worstStatus(crossChecks.map((item) => item.status)),
      syncedAt: "",
      unavailableReason: "",
    },
  ];

  const everyCheck = groups.flatMap((group) => group.checks);
  const summary: Record<ReconciliationStatus, number> = {
    MATCHED: 0,
    SMALL_DIFFERENCE: 0,
    MISMATCH: 0,
    SOURCE_UNAVAILABLE: 0,
    STALE: 0,
    NOT_VALIDATED: 0,
  };
  for (const item of everyCheck) summary[item.status] += 1;

  return {
    period,
    generatedAt,
    durationMs: Date.now() - startedAt,
    groups,
    summary,
    worst: worstStatus(everyCheck.map((item) => item.status)),
  };
}

/** Re-exported for the audit script's table and for tests. */
export const RECONCILIATION_STATUSES: ReconciliationStatus[] = [
  "MATCHED",
  "SMALL_DIFFERENCE",
  "MISMATCH",
  "SOURCE_UNAVAILABLE",
  "STALE",
  "NOT_VALIDATED",
];

export function accountingReportedOn(
  row: Parameters<typeof accountingReportingDate>[0],
  basis: Parameters<typeof accountingReportingDate>[1],
): string {
  return accountingReportingDate(row, basis);
}
