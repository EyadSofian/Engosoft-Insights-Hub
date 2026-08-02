// Server-only TikTok Marketing API reader.
//
// TikTok's synchronous daily report accepts at most 30 days per request. This
// module hides that constraint, pages through ad-level results, and joins the
// report rows to /ad/get so campaign/ad-group/ad IDs remain authoritative even
// when display names are reused.

const API = "https://business-api.tiktok.com/open_api/v1.3";
const REPORT_PAGE_SIZE = 1000;
const MAX_REPORT_DAYS = 30;
const MAX_PAGES = 100;
// The app's Basic quota is 10 QPS. Report pages are fetched concurrently, so
// space request starts far enough apart to leave headroom for retries and any
// other TikTok call made by the same process.
const MIN_REQUEST_GAP_MS = 150;
const MAX_RATE_LIMIT_RETRIES = 5;

let requestSchedule: Promise<void> = Promise.resolve();
let nextRequestAt = 0;

interface TikTokConfig {
  accessToken: string;
  advertiserIds: string[];
  appId: string;
  appSecret: string;
  startDate: string;
  endDate: string;
}

interface ApiEnvelope<T> {
  code?: number;
  message?: string;
  request_id?: string;
  data?: T;
}

interface PageInfo {
  page?: number;
  page_size?: number;
  total_page?: number;
  total_number?: number;
}

interface AuthorizedAccount {
  advertiser_id: string;
  advertiser_name: string;
}

interface AdInfo {
  ad_id: string;
  ad_name?: string;
  adgroup_id?: string;
  campaign_id?: string;
}

interface ReportRow {
  dimensions?: {
    ad_id?: string;
    stat_time_day?: string;
  };
  metrics?: Record<string, string | number | null | undefined>;
}

export interface TikTokAdDaily {
  date: string;
  account: string;
  accountId: string;
  campaign: string;
  campaignId: string;
  adset: string;
  adsetId: string;
  ad: string;
  adId: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  formLeads: number;
  viewCompletions: number;
  syncedAt: string;
}

export interface TikTokFetchResult {
  configured: boolean;
  rows: TikTokAdDaily[];
  syncedAt: string;
  errors: string[];
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function validIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

function parseIds(value: string | undefined): string[] {
  return [
    ...new Set(
      (value ?? "")
        .split(/[\s,]+/)
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
}

function config(): TikTokConfig | null {
  const accessToken = process.env.TIKTOK_ACCESS_TOKEN?.trim() ?? "";
  const advertiserIds = parseIds(process.env.TIKTOK_ADVERTISER_IDS);
  if (!accessToken || !advertiserIds.length) return null;

  const today = iso(new Date());
  const defaultStart = `${today.slice(0, 4)}-01-01`;
  const configuredStart = process.env.TIKTOK_START_DATE?.trim() ?? "";
  const configuredEnd = process.env.TIKTOK_END_DATE?.trim() ?? "";

  return {
    accessToken,
    advertiserIds,
    appId: process.env.TIKTOK_APP_ID?.trim() ?? "",
    appSecret: process.env.TIKTOK_APP_SECRET?.trim() ?? "",
    startDate: validIsoDate(configuredStart) ? configuredStart : defaultStart,
    endDate: validIsoDate(configuredEnd) ? configuredEnd : today,
  };
}

function numberOf(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function safeMessage(path: string, body: ApiEnvelope<unknown>, status?: number): string {
  const detail = body.message?.trim() || (status ? `HTTP ${status}` : "unknown error");
  return `TikTok ${path}: ${detail}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Serialize request starts without serializing the network responses. */
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

function isRateLimited(response: Response, body: ApiEnvelope<unknown>): boolean {
  return (
    response.status === 429 ||
    /(?:qps|rate) limit|too many requests/i.test(body.message?.trim() ?? "")
  );
}

async function getApi<T>(
  path: string,
  params: Record<string, string>,
  accessToken: string,
): Promise<T> {
  const url = new URL(`${API}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
    await waitForRequestSlot();
    const response = await fetch(url, {
      headers: { "Access-Token": accessToken },
      cache: "no-store",
    });
    const body = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
    if (response.ok && body.code === 0 && body.data) return body.data;

    if (isRateLimited(response, body) && attempt < MAX_RATE_LIMIT_RETRIES) {
      // TikTok's quota is a rolling window. Exponential backoff lets that
      // window drain even if another deployment instance is also refreshing.
      await delay(Math.min(8_000, 750 * 2 ** attempt) + Math.floor(Math.random() * 250));
      continue;
    }
    throw new Error(safeMessage(path, body, response.status));
  }

  throw new Error(`TikTok ${path}: request failed after rate-limit retries`);
}

function dateChunks(from: string, to: string): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  let cursor = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(cursor) || !Number.isFinite(end) || cursor > end) return out;

  while (cursor <= end) {
    const chunkEnd = Math.min(end, cursor + (MAX_REPORT_DAYS - 1) * 86_400_000);
    out.push({ from: iso(new Date(cursor)), to: iso(new Date(chunkEnd)) });
    cursor = chunkEnd + 86_400_000;
  }
  return out;
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

async function authorizedAccounts(cfg: TikTokConfig): Promise<Map<string, string>> {
  const names = new Map(cfg.advertiserIds.map((id) => [id, id]));
  if (!cfg.appId || !cfg.appSecret) return names;

  const data = await getApi<{ list?: AuthorizedAccount[] }>(
    "/oauth2/advertiser/get/",
    { app_id: cfg.appId, secret: cfg.appSecret },
    cfg.accessToken,
  );
  for (const account of data.list ?? []) {
    if (account.advertiser_id && account.advertiser_name) {
      names.set(account.advertiser_id, account.advertiser_name);
    }
  }
  return names;
}

async function reportPage(
  cfg: TikTokConfig,
  advertiserId: string,
  from: string,
  to: string,
  page: number,
): Promise<{ rows: ReportRow[]; pageInfo: PageInfo }> {
  const data = await getApi<{ list?: ReportRow[]; page_info?: PageInfo }>(
    "/report/integrated/get/",
    {
      advertiser_id: advertiserId,
      service_type: "AUCTION",
      report_type: "BASIC",
      data_level: "AUCTION_AD",
      dimensions: JSON.stringify(["ad_id", "stat_time_day"]),
      metrics: JSON.stringify([
        "campaign_name",
        "adgroup_name",
        "ad_name",
        "spend",
        "impressions",
        "clicks",
        "form",
        "conversion",
        "video_views_p100",
      ]),
      start_date: from,
      end_date: to,
      // TikTok otherwise defaults ad-level reports to STATUS_NOT_DELETE. That
      // silently drops historical spend from deleted ads and makes ad-level
      // totals disagree with the advertiser-level total.
      filtering: JSON.stringify([
        {
          field_name: "ad_status",
          filter_type: "IN",
          filter_value: JSON.stringify(["STATUS_ALL"]),
        },
      ]),
      page: String(page),
      page_size: String(REPORT_PAGE_SIZE),
    },
    cfg.accessToken,
  );
  return { rows: data.list ?? [], pageInfo: data.page_info ?? {} };
}

async function reportChunk(
  cfg: TikTokConfig,
  advertiserId: string,
  from: string,
  to: string,
): Promise<ReportRow[]> {
  const first = await reportPage(cfg, advertiserId, from, to, 1);
  const pages = Math.min(MAX_PAGES, Math.max(1, first.pageInfo.total_page ?? 1));
  if (pages === 1) return first.rows;

  const rest = await mapLimit(
    Array.from({ length: pages - 1 }, (_, index) => index + 2),
    4,
    async (page) => (await reportPage(cfg, advertiserId, from, to, page)).rows,
  );
  return [first.rows, ...rest].flat();
}

async function adIndex(cfg: TikTokConfig, advertiserId: string): Promise<Map<string, AdInfo>> {
  const out = new Map<string, AdInfo>();
  let page = 1;
  while (page <= MAX_PAGES) {
    const data = await getApi<{ list?: AdInfo[]; page_info?: PageInfo }>(
      "/ad/get/",
      {
        advertiser_id: advertiserId,
        fields: JSON.stringify(["ad_id", "ad_name", "adgroup_id", "campaign_id"]),
        page: String(page),
        page_size: String(REPORT_PAGE_SIZE),
      },
      cfg.accessToken,
    );
    for (const ad of data.list ?? []) if (ad.ad_id) out.set(ad.ad_id, ad);
    const totalPages = Math.max(1, data.page_info?.total_page ?? 1);
    if (page >= totalPages) break;
    page++;
  }
  return out;
}

export async function fetchTikTokAds(): Promise<TikTokFetchResult> {
  const cfg = config();
  if (!cfg) return { configured: false, rows: [], syncedAt: "", errors: [] };

  const syncedAt = new Date().toISOString();
  const errors: string[] = [];
  const names = await authorizedAccounts(cfg);
  const jobs = cfg.advertiserIds.flatMap((advertiserId) =>
    dateChunks(cfg.startDate, cfg.endDate).map((range) => ({ advertiserId, ...range })),
  );

  const chunks = await mapLimit(jobs, 4, async (job) => {
    try {
      const rows = await reportChunk(cfg, job.advertiserId, job.from, job.to);
      return { advertiserId: job.advertiserId, rows };
    } catch (error) {
      if (errors.length < 8) {
        errors.push(
          `${names.get(job.advertiserId) ?? job.advertiserId} ${job.from}..${job.to}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return { advertiserId: job.advertiserId, rows: [] as ReportRow[] };
    }
  });

  const activeIds = [
    ...new Set(chunks.filter((chunk) => chunk.rows.length).map((chunk) => chunk.advertiserId)),
  ];
  const indexes = new Map<string, Map<string, AdInfo>>();
  await mapLimit(activeIds, 3, async (advertiserId) => {
    try {
      indexes.set(advertiserId, await adIndex(cfg, advertiserId));
    } catch (error) {
      if (errors.length < 8) {
        errors.push(
          `${names.get(advertiserId) ?? advertiserId} hierarchy: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  });

  const rows: TikTokAdDaily[] = [];
  for (const chunk of chunks) {
    const account = names.get(chunk.advertiserId) ?? chunk.advertiserId;
    const index = indexes.get(chunk.advertiserId);
    for (const raw of chunk.rows) {
      const adId = String(raw.dimensions?.ad_id ?? "");
      const meta = index?.get(adId);
      const metrics = raw.metrics ?? {};
      rows.push({
        date: String(raw.dimensions?.stat_time_day ?? "").slice(0, 10),
        account,
        accountId: chunk.advertiserId,
        campaign: String(metrics.campaign_name ?? ""),
        campaignId: meta?.campaign_id ?? "",
        adset: String(metrics.adgroup_name ?? ""),
        adsetId: meta?.adgroup_id ?? "",
        ad: String(metrics.ad_name ?? meta?.ad_name ?? ""),
        adId,
        spend: numberOf(metrics.spend),
        impressions: numberOf(metrics.impressions),
        clicks: numberOf(metrics.clicks),
        conversions: numberOf(metrics.conversion),
        formLeads: numberOf(metrics.form),
        viewCompletions: numberOf(metrics.video_views_p100),
        syncedAt,
      });
    }
  }

  return { configured: true, rows, syncedAt, errors };
}
