// Server-only Google Ads reporting reader.
//
// OAuth access tokens live for about one hour, so Railway stores only the
// refresh token and app credentials. This module refreshes and reuses the
// short-lived token, then reads daily ad-level facts through GAQL.

const API_VERSION = "v25";
const API = `https://googleads.googleapis.com/${API_VERSION}`;
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_RETRIES = 3;

interface GoogleAdsConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  developerToken: string;
  loginCustomerId: string;
  customerIds: string[];
  startDate: string;
  endDate: string;
}

interface OAuthResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GoogleAdsApiError {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: Array<{
      errors?: Array<{
        errorCode?: Record<string, string>;
        message?: string;
      }>;
      requestId?: string;
    }>;
  };
}

interface GoogleAdsResultRow {
  customer?: {
    id?: string;
    descriptiveName?: string;
    currencyCode?: string;
  };
  campaign?: {
    id?: string;
    name?: string;
    advertisingChannelType?: string;
  };
  adGroup?: {
    id?: string;
    name?: string;
  };
  adGroupAd?: {
    ad?: {
      id?: string;
      name?: string;
      type?: string;
    };
  };
  segments?: {
    date?: string;
  };
  metrics?: {
    costMicros?: string | number;
    impressions?: string | number;
    clicks?: string | number;
    conversions?: string | number;
    allConversions?: string | number;
    videoViews?: string | number;
  };
}

interface SearchStreamBatch {
  results?: GoogleAdsResultRow[];
  requestId?: string;
  error?: GoogleAdsApiError["error"];
}

export interface GoogleAdsDaily {
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
  videoViews: number;
  syncedAt: string;
}

export interface GoogleAdsFetchResult {
  configured: boolean;
  rows: GoogleAdsDaily[];
  syncedAt: string;
  errors: string[];
}

let cachedAccessToken: { value: string; expiresAt: number } | null = null;
let accessTokenInflight: Promise<string> | null = null;

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function validIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

function env(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (value.length >= 2 && value[0] === value[value.length - 1] && /["']/.test(value[0])) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function ids(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\s,]+/)
        .map((id) => id.replace(/-/g, "").trim())
        .filter(Boolean),
    ),
  ];
}

function config(): GoogleAdsConfig | null {
  const clientId = env("GOOGLE_ADS_CLIENT_ID");
  const clientSecret = env("GOOGLE_ADS_CLIENT_SECRET");
  const refreshToken = env("GOOGLE_ADS_REFRESH_TOKEN");
  const developerToken = env("GOOGLE_ADS_DEVELOPER_TOKEN");
  const loginCustomerId = env("GOOGLE_ADS_LOGIN_CUSTOMER_ID").replace(/-/g, "");
  const customerIds = ids(env("GOOGLE_ADS_CUSTOMER_IDS"));
  if (
    !clientId ||
    !clientSecret ||
    !refreshToken ||
    !developerToken ||
    !loginCustomerId ||
    !customerIds.length
  ) {
    return null;
  }

  const today = iso(new Date());
  const configuredStart = env("GOOGLE_ADS_START_DATE");
  const configuredEnd = env("GOOGLE_ADS_END_DATE");
  return {
    clientId,
    clientSecret,
    refreshToken,
    developerToken,
    loginCustomerId,
    customerIds,
    startDate: validIsoDate(configuredStart) ? configuredStart : `${today.slice(0, 4)}-01-01`,
    endDate: validIsoDate(configuredEnd) ? configuredEnd : today,
  };
}

function numberOf(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function apiErrorMessage(
  body: SearchStreamBatch[] | GoogleAdsApiError,
  status: number,
  rawBody: string,
): string {
  const error = Array.isArray(body) ? body.find((batch) => batch.error)?.error : body.error;
  if (!error) {
    const compact = rawBody.replace(/\s+/g, " ").trim().slice(0, 400);
    return compact ? `HTTP ${status}: ${compact}` : `HTTP ${status}`;
  }

  const reasons = (error.details ?? [])
    .flatMap((detail) => detail.errors ?? [])
    .flatMap((detail) => [...Object.values(detail.errorCode ?? {}), detail.message?.trim() ?? ""])
    .filter(Boolean);
  const summary = error.message?.trim() || error.status?.trim() || `HTTP ${status}`;
  return reasons.length ? `${summary} (${[...new Set(reasons)].join(": ")})` : summary;
}

async function accessToken(cfg: GoogleAdsConfig): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt - Date.now() > 5 * 60_000) {
    return cachedAccessToken.value;
  }
  if (accessTokenInflight) return accessTokenInflight;

  accessTokenInflight = (async () => {
    const response = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: cfg.refreshToken,
        grant_type: "refresh_token",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => ({}))) as OAuthResponse;
    if (!response.ok || !body.access_token) {
      throw new Error(
        `Google OAuth: ${body.error_description?.trim() || body.error?.trim() || `HTTP ${response.status}`}`,
      );
    }
    cachedAccessToken = {
      value: body.access_token,
      expiresAt: Date.now() + Math.max(60, body.expires_in ?? 3_600) * 1_000,
    };
    return body.access_token;
  })();

  try {
    return await accessTokenInflight;
  } finally {
    accessTokenInflight = null;
  }
}

function gaql(from: string, to: string): string {
  return `
    SELECT
      customer.id,
      customer.descriptive_name,
      customer.currency_code,
      campaign.id,
      campaign.name,
      campaign.advertising_channel_type,
      ad_group.id,
      ad_group.name,
      ad_group_ad.ad.id,
      ad_group_ad.ad.name,
      ad_group_ad.ad.type,
      segments.date,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.all_conversions,
      metrics.video_views
    FROM ad_group_ad
    WHERE segments.date BETWEEN '${from}' AND '${to}'
    ORDER BY segments.date
  `;
}

async function searchCustomer(
  cfg: GoogleAdsConfig,
  customerId: string,
): Promise<GoogleAdsResultRow[]> {
  let lastError = "unknown error";
  let useManagerHeader = true;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const token = await accessToken(cfg);
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      "developer-token": cfg.developerToken,
      "content-type": "application/json",
    };
    if (useManagerHeader) headers["login-customer-id"] = cfg.loginCustomerId;
    const response = await fetch(`${API}/customers/${customerId}/googleAds:searchStream`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: gaql(cfg.startDate, cfg.endDate) }),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const rawBody = await response.text();
    const body = (() => {
      try {
        return JSON.parse(rawBody) as SearchStreamBatch[] | GoogleAdsApiError;
      } catch {
        return {} as GoogleAdsApiError;
      }
    })();

    if (response.ok && Array.isArray(body)) {
      return body.flatMap((batch) => batch.results ?? []);
    }

    lastError = apiErrorMessage(body, response.status, rawBody);
    // A user can have direct access to the client account without access
    // through the configured manager. Google explicitly supports omitting the
    // login-customer-id in that case, so retry directly only for this error.
    if (useManagerHeader && lastError.includes("USER_PERMISSION_DENIED")) {
      useManagerHeader = false;
      continue;
    }
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === MAX_RETRIES - 1) break;
    await sleep(750 * 2 ** attempt + Math.floor(Math.random() * 250));
  }
  throw new Error(`Google Ads customer ${customerId}: ${lastError}`);
}

export async function fetchGoogleAds(): Promise<GoogleAdsFetchResult> {
  const cfg = config();
  if (!cfg) return { configured: false, rows: [], syncedAt: "", errors: [] };

  const syncedAt = new Date().toISOString();
  const errors: string[] = [];
  const rows: GoogleAdsDaily[] = [];

  // Explorer Access allows 2,880 production operations per rolling day. One
  // streamed query per customer retrieves the complete configured date range.
  for (const customerId of cfg.customerIds) {
    try {
      const rawRows = await searchCustomer(cfg, customerId);
      const currency = rawRows.find((row) => row.customer?.currencyCode)?.customer?.currencyCode;
      if (currency && currency !== "USD") {
        throw new Error(
          `Google Ads customer ${customerId} uses ${currency}; dashboard ad spend is USD and no conversion rate is configured.`,
        );
      }

      for (const raw of rawRows) {
        const accountId = String(raw.customer?.id ?? customerId);
        const campaignId = String(raw.campaign?.id ?? "");
        const adsetId = String(raw.adGroup?.id ?? "");
        const adId = String(raw.adGroupAd?.ad?.id ?? "");
        const metrics = raw.metrics ?? {};
        rows.push({
          date: String(raw.segments?.date ?? ""),
          account: String(raw.customer?.descriptiveName ?? "") || accountId,
          accountId,
          campaign: String(raw.campaign?.name ?? "") || `Google Campaign ${campaignId}`,
          campaignId,
          adset: String(raw.adGroup?.name ?? "") || `Google Ad Group ${adsetId}`,
          adsetId,
          ad: String(raw.adGroupAd?.ad?.name ?? "") || `Google Ad ${adId}`,
          adId,
          spend: numberOf(metrics.costMicros) / 1_000_000,
          impressions: numberOf(metrics.impressions),
          clicks: numberOf(metrics.clicks),
          conversions: numberOf(metrics.conversions),
          videoViews: numberOf(metrics.videoViews),
          syncedAt,
        });
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return { configured: true, rows, syncedAt, errors };
}
