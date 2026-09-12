// Server-only OpenAI Ads reporting and creative reader.
//
// Each Ads API key is scoped to exactly one ad account. OPENAI_ADS_API_KEYS
// therefore accepts several keys without requiring account ids in source code.
// Delivery is read at one-ad x one-day grain; mutable creative metadata stays
// in its own dataset and joins through the account/ad ids.
import {
  databaseConfigured,
  readDashboardDatasets,
  writeDashboardDataset,
  type DashboardRow,
} from "./dashboard-db.server";
import type {
  AdCreative,
  CampaignObjective,
  CampaignOperationalState,
  CampaignPlatformHealth,
} from "./types";

const API = "https://api.ads.openai.com/v1";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 4;
const MAX_PAGES = 1_000;
const LIST_PAGE_SIZE = 500;
const INSIGHTS_PAGE_SIZE = 2_000;
const REPORT_CACHE_MS = 30 * 60 * 1_000;
const MIN_REQUEST_GAP_MS = 105;

interface OpenAIAdsConfig {
  apiKeys: string[];
  startDate: string;
  endDate: string;
}

interface Page<T> {
  data?: T[];
  has_more?: boolean;
  last_id?: string | null;
}

interface ApiErrorBody {
  error?: { message?: string; type?: string; code?: string } | string;
  message?: string;
}

interface AdAccountResource {
  id: string;
  name: string;
  status?: string;
  timezone: string;
  currency_code: string;
}

interface CampaignResource {
  id: string;
  name: string;
  status: string;
  objective?: string;
  start_time?: number | null;
  end_time?: number | null;
  updated_at?: number;
}

interface AdGroupResource {
  id: string;
  name: string;
  status: string;
  created_at?: number;
  updated_at?: number;
}

interface AdResource {
  id: string;
  name: string;
  status: string;
  review_status?: string;
  created_at?: number;
  updated_at?: number;
  creative?: {
    type?: string;
    title?: string;
    body?: string;
    price?: string;
    file_id?: string | null;
    image_url?: string | null;
    target_url?: string | null;
  };
  review?: { status?: string; reason?: string; screenshot_url?: string };
}

interface InsightResource {
  id?: string;
  readable_time?: string;
  timezone?: string;
  campaign_id?: string | null;
  campaign_name?: string | null;
  campaign_status?: string | null;
  ad_group_id?: string | null;
  ad_group_name?: string | null;
  ad_group_status?: string | null;
  ad_id?: string | null;
  ad_name?: string | null;
  ad_status?: string | null;
  ad_review_status?: string | null;
  impressions?: number | string | null;
  clicks?: number | string | null;
  spend?: number | string | null;
}

interface ConversionResource {
  entity_id?: string;
  date?: string;
  conversions?: number | string | null;
  click_through_conversions?: number | string | null;
  view_through_conversions?: number | string | null;
}

export interface OpenAIAdsDaily {
  date: string;
  account: string;
  accountId: string;
  objective: CampaignObjective;
  campaign: string;
  campaignId: string;
  adset: string;
  adsetId: string;
  ad: string;
  adId: string;
  spend: number;
  impressions: number;
  clicks: number;
  /** OpenAI click-through conversions. Null when conversion reporting failed. */
  conversions: number | null;
  syncedAt: string;
}

export type OpenAIAdsSource = "api" | "postgres-last-good" | "none";

export interface OpenAIAdsFetchResult {
  configured: boolean;
  rows: OpenAIAdsDaily[];
  creatives: AdCreative[];
  campaigns: CampaignOperationalState[];
  syncedAt: string;
  source: OpenAIAdsSource;
  errors: string[];
  warnings: string[];
  health: CampaignPlatformHealth;
}

interface AccountRead {
  accountId: string;
  rows: OpenAIAdsDaily[];
  creatives: AdCreative[];
  campaigns: CampaignOperationalState[];
  warnings: string[];
  totalCampaigns: number;
}

let requestSchedule: Promise<void> = Promise.resolve();
let nextRequestAt = 0;
let cache: { value: OpenAIAdsFetchResult; expiresAt: number } | null = null;
let inflight: Promise<OpenAIAdsFetchResult> | null = null;

function env(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (value.length >= 2 && value[0] === value[value.length - 1] && /["']/.test(value[0])) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function validIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

function parseApiKeys(): string[] {
  const values: string[] = [];
  const single = env("OPENAI_ADS_API_KEY");
  if (single) values.push(single);

  const multiple = env("OPENAI_ADS_API_KEYS");
  if (multiple) {
    try {
      const parsed = JSON.parse(multiple) as unknown;
      if (Array.isArray(parsed)) values.push(...parsed.map(String));
      else values.push(multiple);
    } catch {
      values.push(...multiple.split(/[,\n]+/));
    }
  }
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function config(): OpenAIAdsConfig {
  const today = iso(new Date());
  const start = env("OPENAI_ADS_START_DATE");
  const end = env("OPENAI_ADS_END_DATE");
  const startDate = validIsoDate(start) ? start : `${today.slice(0, 4)}-01-01`;
  const endDate = validIsoDate(end) && end <= today ? end : today;
  return {
    apiKeys: parseApiKeys(),
    startDate: startDate <= endDate ? startDate : `${endDate.slice(0, 4)}-01-01`,
    endDate,
  };
}

export function openAIAdsConfigured(): boolean {
  return parseApiKeys().length > 0;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Serialises request starts to remain below the documented 600/min endpoint limit. */
async function waitForRequestSlot(): Promise<void> {
  let release!: () => void;
  const previous = requestSchedule;
  requestSchedule = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    const waitMs = Math.max(0, nextRequestAt - Date.now());
    if (waitMs) await delay(waitMs);
    nextRequestAt = Date.now() + MIN_REQUEST_GAP_MS;
  } finally {
    release();
  }
}

function retryAfterMs(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after")?.trim() ?? "";
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  }
  return Math.min(12_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

function apiErrorMessage(body: ApiErrorBody, response: Response): string {
  const error = body.error;
  const detail =
    typeof error === "string"
      ? error
      : error?.message?.trim() || error?.code?.trim() || body.message?.trim();
  return detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`;
}

async function apiRequest<T>(
  apiKey: string,
  path: string,
  options: {
    method?: "GET" | "POST";
    params?: Record<string, string | number | string[]>;
    body?: Record<string, unknown>;
  } = {},
): Promise<T> {
  let lastError = "request failed";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await waitForRequestSlot();
    const url = new URL(`${API}${path}`);
    for (const [name, raw] of Object.entries(options.params ?? {})) {
      const values = Array.isArray(raw) ? raw : [raw];
      for (const value of values) url.searchParams.append(name, String(value));
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? "GET",
        headers: {
          authorization: `Bearer ${apiKey}`,
          ...(options.body ? { "content-type": "application/json" } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < MAX_RETRIES) {
        await delay(Math.min(12_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250));
        continue;
      }
      throw new Error(`OpenAI Ads ${path}: ${lastError}`);
    }

    const body = (await response.json().catch(() => ({}))) as T & ApiErrorBody;
    if (response.ok) return body;
    lastError = apiErrorMessage(body, response);
    const retryable =
      response.status === 408 ||
      response.status === 409 ||
      response.status === 429 ||
      response.status >= 500;
    if (retryable && attempt < MAX_RETRIES) {
      await delay(retryAfterMs(response, attempt));
      continue;
    }
    throw new Error(`OpenAI Ads ${path}: ${lastError}`);
  }
  throw new Error(`OpenAI Ads ${path}: ${lastError}`);
}

/** Cursor pagination helper exported for contract tests. */
export async function paginateOpenAIAds<T>(
  fetchPage: (after: string) => Promise<Page<T>>,
): Promise<T[]> {
  const out: T[] = [];
  let after = "";
  const seen = new Set<string>();
  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber++) {
    const page = await fetchPage(after);
    out.push(...(page.data ?? []));
    if (!page.has_more) return out;
    const next = page.last_id?.trim() ?? "";
    if (!next || seen.has(next))
      throw new Error("OpenAI Ads pagination returned an invalid cursor.");
    seen.add(next);
    after = next;
  }
  throw new Error(`OpenAI Ads pagination exceeded ${MAX_PAGES} pages.`);
}

async function getList<T>(
  apiKey: string,
  path: string,
  fixedParams: Record<string, string> = {},
): Promise<T[]> {
  return paginateOpenAIAds((after) =>
    apiRequest<Page<T>>(apiKey, path, {
      params: { ...fixedParams, limit: LIST_PAGE_SIZE, ...(after ? { after } : {}) },
    }),
  );
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      out[index] = await work(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

function objective(value: string | undefined): CampaignObjective {
  switch (value?.trim().toLowerCase()) {
    case "conversions":
      return "website_conversion";
    case "clicks":
    case "reach":
      return "traffic";
    default:
      return "unknown";
  }
}

export function assertOpenAIAdsUsdAccount(
  account: Pick<AdAccountResource, "id" | "currency_code">,
): void {
  if (account.currency_code?.trim().toUpperCase() !== "USD") {
    throw new Error(
      `OpenAI Ads account ${account.id} uses ${account.currency_code || "an unknown currency"}; the dashboard requires USD ad spend.`,
    );
  }
}

function unixIso(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return "";
  return new Date(Number(value) * 1_000).toISOString();
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Creative URLs are displayed as links/images; only network URLs are safe. */
function safeHttpUrl(value: string | null | undefined): string {
  const candidate = value?.trim() ?? "";
  if (!candidate) return "";
  try {
    const protocol = new URL(candidate).protocol;
    return protocol === "https:" || protocol === "http:" ? candidate : "";
  } catch {
    return "";
  }
}

function conversionKey(date: string, adId: string): string {
  return `${date}\u001f${adId}`;
}

export function normalizeOpenAIInsight(
  account: Pick<AdAccountResource, "id" | "name">,
  insight: InsightResource,
  campaignObjectives: ReadonlyMap<string, CampaignObjective>,
  conversions: ReadonlyMap<string, number> | null,
  syncedAt: string,
): OpenAIAdsDaily | null {
  const date = insight.readable_time?.trim() ?? "";
  const campaignId = insight.campaign_id?.trim() ?? "";
  const adsetId = insight.ad_group_id?.trim() ?? "";
  const adId = insight.ad_id?.trim() ?? "";
  const spend = finiteNumber(insight.spend);
  const impressions = finiteNumber(insight.impressions);
  const clicks = finiteNumber(insight.clicks);
  if (!validIsoDate(date) || !adId || spend === null || impressions === null || clicks === null) {
    return null;
  }
  return {
    date,
    account: account.name?.trim() || account.id,
    accountId: account.id,
    objective: campaignObjectives.get(campaignId) ?? "unknown",
    campaign: insight.campaign_name?.trim() || `ChatGPT Campaign ${campaignId}`,
    campaignId,
    adset: insight.ad_group_name?.trim() || `ChatGPT Ad Group ${adsetId}`,
    adsetId,
    ad: insight.ad_name?.trim() || `ChatGPT Ad ${adId}`,
    adId,
    spend,
    impressions,
    clicks,
    conversions: conversions ? (conversions.get(conversionKey(date, adId)) ?? 0) : null,
    syncedAt,
  };
}

export function normalizeOpenAICreative(
  account: Pick<AdAccountResource, "id" | "name">,
  campaign: Pick<CampaignResource, "id" | "name">,
  adGroup: Pick<AdGroupResource, "id" | "name">,
  ad: AdResource,
  syncedAt: string,
): AdCreative {
  return {
    platform: "chatgpt",
    account: account.name?.trim() || account.id,
    accountId: account.id,
    campaign: campaign.name?.trim() || `ChatGPT Campaign ${campaign.id}`,
    campaignId: campaign.id,
    campaignKey: `id:${campaign.id}`,
    adset: adGroup.name?.trim() || `ChatGPT Ad Group ${adGroup.id}`,
    adsetId: adGroup.id,
    ad: ad.name?.trim() || `ChatGPT Ad ${ad.id}`,
    adId: ad.id,
    creativeType: ad.creative?.type?.trim() ?? "",
    fileId: ad.creative?.file_id?.trim() || undefined,
    headline: ad.creative?.title?.trim() ?? "",
    body: ad.creative?.body?.trim() ?? "",
    price: ad.creative?.price?.trim() ?? "",
    imageUrl: safeHttpUrl(ad.creative?.image_url),
    landingPageUrl: safeHttpUrl(ad.creative?.target_url),
    status: ad.status?.trim() ?? "",
    reviewStatus: ad.review_status?.trim() || ad.review?.status?.trim() || "",
    reviewReason: ad.review?.reason?.trim() ?? "",
    createdAt: unixIso(ad.created_at),
    updatedAt: unixIso(ad.updated_at),
    syncedAt,
  };
}

async function readAccount(
  apiKey: string,
  cfg: Pick<OpenAIAdsConfig, "startDate" | "endDate">,
  syncedAt: string,
): Promise<AccountRead> {
  const account = await apiRequest<AdAccountResource>(apiKey, "/ad_account");
  if (!account.id) throw new Error("OpenAI Ads /ad_account returned no account id.");
  assertOpenAIAdsUsdAccount(account);

  const rawCampaigns = await getList<CampaignResource>(apiKey, "/campaigns");
  const campaignObjectives = new Map(
    rawCampaigns.map((item) => [item.id, objective(item.objective)]),
  );
  const groupPairs = (
    await mapLimit(rawCampaigns, 5, async (campaign) => ({
      campaign,
      groups: await getList<AdGroupResource>(apiKey, "/ad_groups", {
        campaign_id: campaign.id,
      }),
    }))
  ).flatMap(({ campaign, groups }) => groups.map((group) => ({ campaign, group })));
  const adPairs = (
    await mapLimit(groupPairs, 5, async ({ campaign, group }) => ({
      campaign,
      group,
      ads: await getList<AdResource>(apiKey, "/ads", { ad_group_id: group.id }),
    }))
  ).flatMap(({ campaign, group, ads }) => ads.map((ad) => ({ campaign, group, ad })));

  const creatives = adPairs.map(({ campaign, group, ad }) =>
    normalizeOpenAICreative(account, campaign, group, ad, syncedAt),
  );

  const timeRange = JSON.stringify({
    type: "date_range",
    since: cfg.startDate,
    until: cfg.endDate,
    timezone: account.timezone,
  });
  const fields = [
    "metadata.readable_time",
    "metadata.timezone",
    "campaign.id",
    "campaign.name",
    "campaign.status",
    "ad_group.id",
    "ad_group.name",
    "ad_group.status",
    "ad.id",
    "ad.name",
    "ad.status",
    "ad.review_status",
    "ad.impressions",
    "ad.clicks",
    "ad.spend",
  ];
  const insights = await paginateOpenAIAds((after) =>
    apiRequest<Page<InsightResource>>(apiKey, "/ad_account/insights", {
      params: {
        time_granularity: "daily",
        aggregation_level: "ad",
        limit: INSIGHTS_PAGE_SIZE,
        "fields[]": fields,
        "time_ranges[]": timeRange,
        ...(after ? { after } : {}),
      },
    }),
  );

  const warnings: string[] = [];
  let conversions: Map<string, number> | null = null;
  try {
    const response = await apiRequest<{ data?: ConversionResource[] }>(
      apiKey,
      "/conversions/insights",
      {
        method: "POST",
        body: {
          aggregation_level: "ad",
          time_granularity: "daily",
          time_ranges: [timeRange],
          group_by_entity: true,
          include_zero_rows: true,
        },
      },
    );
    conversions = new Map();
    for (const item of response.data ?? []) {
      const adId = item.entity_id?.trim() ?? "";
      const date = item.date?.trim() ?? "";
      const value = finiteNumber(item.click_through_conversions ?? item.conversions);
      if (adId && validIsoDate(date) && value !== null) {
        conversions.set(conversionKey(date, adId), value);
      }
    }
  } catch (error) {
    warnings.push(
      `Conversion insights unavailable for account ${account.id}; platform conversions remain unavailable (${error instanceof Error ? error.message : String(error)}).`,
    );
  }

  const rows: OpenAIAdsDaily[] = [];
  let rejectedInsights = 0;
  for (const insight of insights) {
    const row = normalizeOpenAIInsight(account, insight, campaignObjectives, conversions, syncedAt);
    if (row) rows.push(row);
    else rejectedInsights++;
  }
  if (rejectedInsights) {
    warnings.push(
      `${rejectedInsights} OpenAI Ads insight rows were excluded because a stable ad id, date, or requested delivery metric was absent.`,
    );
  }

  const groupsByCampaign = new Map<string, typeof groupPairs>();
  for (const pair of groupPairs) {
    const bucket = groupsByCampaign.get(pair.campaign.id) ?? [];
    bucket.push(pair);
    groupsByCampaign.set(pair.campaign.id, bucket);
  }
  const adsByCampaign = new Map<string, typeof adPairs>();
  for (const pair of adPairs) {
    const bucket = adsByCampaign.get(pair.campaign.id) ?? [];
    bucket.push(pair);
    adsByCampaign.set(pair.campaign.id, bucket);
  }
  const reportDay = cfg.endDate;
  const campaigns: CampaignOperationalState[] = rawCampaigns
    .filter((campaign) => campaign.status?.trim().toLowerCase() === "active")
    .map((campaign) => {
      const groups = groupsByCampaign.get(campaign.id) ?? [];
      const ads = adsByCampaign.get(campaign.id) ?? [];
      const delivery = rows.filter(
        (row) => row.campaignId === campaign.id && row.date === reportDay,
      );
      const activeAdsets = groups.filter(
        ({ group }) => group.status?.trim().toLowerCase() === "active",
      ).length;
      const activeAds = ads.filter(
        ({ ad }) =>
          ad.status?.trim().toLowerCase() === "active" &&
          ad.review_status?.trim().toLowerCase() === "approved",
      ).length;
      return {
        platform: "chatgpt" as const,
        accountId: account.id,
        account: account.name?.trim() || account.id,
        accountTimezone: account.timezone,
        campaignId: campaign.id,
        campaignKey: `id:${campaign.id}`,
        name: campaign.name?.trim() || `ChatGPT Campaign ${campaign.id}`,
        configuredStatus: campaign.status.toUpperCase(),
        effectiveStatus: activeAdsets > 0 && activeAds > 0 ? "ACTIVE" : "NO_ACTIVE_CHILDREN",
        servingStatus: activeAdsets > 0 && activeAds > 0 ? "SERVING" : "NOT_SERVING",
        statusReason:
          activeAdsets > 0 && activeAds > 0 ? "" : "No active approved ad is available.",
        startTime: unixIso(campaign.start_time),
        stopTime: unixIso(campaign.end_time),
        updatedTime: unixIso(campaign.updated_at),
        activeAdsets,
        activeAds,
        spend24h: delivery.reduce((sum, row) => sum + row.spend, 0),
        impressions24h: delivery.reduce((sum, row) => sum + row.impressions, 0),
        clicks24h: delivery.reduce((sum, row) => sum + row.clicks, 0),
        platformLeads24h: delivery.every((row) => row.conversions === null)
          ? null
          : delivery.reduce((sum, row) => sum + (row.conversions ?? 0), 0),
        deliveryState: activeAdsets > 0 && activeAds > 0 ? "active" : "paused",
        checkedAt: syncedAt,
        source: "platform_direct" as const,
      };
    });

  return {
    accountId: account.id,
    rows,
    creatives,
    campaigns,
    warnings,
    totalCampaigns: rawCampaigns.length,
  };
}

function rawString(row: DashboardRow, key: string): string {
  return row[key]?.trim() ?? "";
}

function storedDaily(row: DashboardRow): OpenAIAdsDaily | null {
  const spend = finiteNumber(row.spend);
  const impressions = finiteNumber(row.impressions);
  const clicks = finiteNumber(row.clicks);
  const date = rawString(row, "date");
  const adId = rawString(row, "adId");
  if (!validIsoDate(date) || !adId || spend === null || impressions === null || clicks === null) {
    return null;
  }
  const storedObjective = rawString(row, "objective");
  return {
    date,
    account: rawString(row, "account"),
    accountId: rawString(row, "accountId"),
    objective: (["leads", "website_conversion", "traffic", "unknown"].includes(storedObjective)
      ? storedObjective
      : "unknown") as CampaignObjective,
    campaign: rawString(row, "campaign"),
    campaignId: rawString(row, "campaignId"),
    adset: rawString(row, "adset"),
    adsetId: rawString(row, "adsetId"),
    ad: rawString(row, "ad"),
    adId,
    spend,
    impressions,
    clicks,
    conversions: rawString(row, "conversions") === "" ? null : finiteNumber(row.conversions),
    syncedAt: rawString(row, "syncedAt"),
  };
}

function storedCreative(row: DashboardRow): AdCreative | null {
  const adId = rawString(row, "adId");
  if (!adId) return null;
  return {
    platform: "chatgpt",
    account: rawString(row, "account"),
    accountId: rawString(row, "accountId"),
    campaign: rawString(row, "campaign"),
    campaignId: rawString(row, "campaignId"),
    campaignKey: rawString(row, "campaignKey") || `id:${rawString(row, "campaignId")}`,
    adset: rawString(row, "adset"),
    adsetId: rawString(row, "adsetId"),
    ad: rawString(row, "ad"),
    adId,
    creativeType: rawString(row, "creativeType"),
    fileId: rawString(row, "fileId") || undefined,
    headline: rawString(row, "headline"),
    body: rawString(row, "body"),
    price: rawString(row, "price"),
    imageUrl: safeHttpUrl(rawString(row, "imageUrl")),
    landingPageUrl: safeHttpUrl(rawString(row, "landingPageUrl")),
    status: rawString(row, "status"),
    reviewStatus: rawString(row, "reviewStatus"),
    reviewReason: rawString(row, "reviewReason"),
    createdAt: rawString(row, "createdAt"),
    updatedAt: rawString(row, "updatedAt"),
    syncedAt: rawString(row, "syncedAt"),
  };
}

function dailyKey(row: OpenAIAdsDaily): string {
  return [row.date, row.accountId, row.campaignId, row.adsetId, row.adId].join("\u001f");
}

function creativeKey(row: AdCreative): string {
  return `${row.accountId}\u001f${row.adId}`;
}

async function storedLastGood(): Promise<{
  rows: OpenAIAdsDaily[];
  creatives: AdCreative[];
  syncedAt: string;
  warnings: string[];
}> {
  if (!databaseConfigured()) return { rows: [], creatives: [], syncedAt: "", warnings: [] };
  try {
    const [facts, creativeSnapshot] = await readDashboardDatasets([
      "chatgpt_ads",
      "chatgpt_ad_creatives",
    ]);
    return {
      rows: (facts?.rows ?? []).map(storedDaily).filter((row): row is OpenAIAdsDaily => !!row),
      creatives: (creativeSnapshot?.rows ?? [])
        .map(storedCreative)
        .filter((row): row is AdCreative => !!row),
      syncedAt: [facts?.syncedAt ?? "", creativeSnapshot?.syncedAt ?? ""].sort().at(-1) ?? "",
      warnings: [],
    };
  } catch {
    return {
      rows: [],
      creatives: [],
      syncedAt: "",
      warnings: ["OpenAI Ads PostgreSQL last-good data could not be read."],
    };
  }
}

async function fetchOpenAIAdsUncached(): Promise<OpenAIAdsFetchResult> {
  const cfg = config();
  const stored = await storedLastGood();
  const checkedAt = new Date().toISOString();
  if (!cfg.apiKeys.length) {
    const hasStored = stored.rows.length > 0 || stored.creatives.length > 0;
    const message = hasStored
      ? "OpenAI Ads credentials are not configured; serving PostgreSQL last-good data."
      : "OpenAI Ads credentials are not configured.";
    return {
      configured: false,
      rows: stored.rows,
      creatives: stored.creatives,
      campaigns: [],
      syncedAt: stored.syncedAt,
      source: hasStored ? "postgres-last-good" : "none",
      errors: [],
      warnings: stored.warnings,
      health: {
        platform: "chatgpt",
        ok: false,
        active: 0,
        total: 0,
        message,
        checkedAt,
      },
    };
  }

  const errors: string[] = [];
  const warnings = [...stored.warnings];
  const successful: AccountRead[] = [];
  const successfulAccountIds = new Set<string>();
  for (const apiKey of cfg.apiKeys) {
    try {
      const value = await readAccount(apiKey, cfg, checkedAt);
      successful.push(value);
      warnings.push(...value.warnings);
      successfulAccountIds.add(value.accountId);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const liveRows = successful.flatMap((value) => value.rows);
  const liveCreatives = successful.flatMap((value) => value.creatives);
  const rowsByKey = new Map(stored.rows.map((row) => [dailyKey(row), row] as const));
  for (const row of liveRows) rowsByKey.set(dailyKey(row), row);
  const creativeByKey = new Map(
    stored.creatives
      .filter((row) => !successfulAccountIds.has(row.accountId))
      .map((row) => [creativeKey(row), row] as const),
  );
  for (const creative of liveCreatives) creativeByKey.set(creativeKey(creative), creative);
  const rows = [...rowsByKey.values()];
  const creatives = [...creativeByKey.values()];
  const campaigns = successful.flatMap((value) => value.campaigns);
  const liveSucceeded = successful.length > 0;

  if (liveSucceeded && databaseConfigured()) {
    await Promise.all([
      writeDashboardDataset(
        "chatgpt_ads",
        liveRows.map((row) => ({ ...row })),
        {
          mode: "upsert",
          syncedAt: checkedAt,
          metadata: { source: "openai-ads-api", grain: "ad-day" },
        },
      ),
      writeDashboardDataset(
        "chatgpt_ad_creatives",
        creatives.map((row) => ({ ...row })),
        {
          mode: "replace",
          syncedAt: checkedAt,
          metadata: { source: "openai-ads-api", grain: "ad" },
        },
      ),
    ]).catch(() => {
      warnings.push("OpenAI Ads live data loaded, but its PostgreSQL last-good write failed.");
    });
  }

  const totalCampaigns = successful.reduce((sum, value) => sum + value.totalCampaigns, 0);
  const message = errors.length
    ? `${errors.length} OpenAI Ads account connection(s) failed; successful accounts and last-good rows remain available.`
    : warnings.length
      ? warnings.join(" | ")
      : "";
  return {
    configured: true,
    rows,
    creatives,
    campaigns,
    syncedAt: liveSucceeded ? checkedAt : stored.syncedAt,
    source: liveSucceeded ? "api" : rows.length || creatives.length ? "postgres-last-good" : "none",
    errors,
    warnings,
    health: {
      platform: "chatgpt",
      ok: errors.length === 0 && liveSucceeded,
      active: campaigns.filter((campaign) => campaign.deliveryState === "active").length,
      total: totalCampaigns,
      message,
      checkedAt,
    },
  };
}

export async function fetchOpenAIAds(force = false): Promise<OpenAIAdsFetchResult> {
  if (!force && cache && cache.expiresAt > Date.now()) return cache.value;
  if (inflight) return inflight;
  inflight = fetchOpenAIAdsUncached()
    .then((value) => {
      cache = { value, expiresAt: Date.now() + REPORT_CACHE_MS };
      return value;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Tests can reset module process state without ever touching credentials. */
export function resetOpenAIAdsCacheForTests(): void {
  cache = null;
  inflight = null;
  requestSchedule = Promise.resolve();
  nextRequestAt = 0;
}
