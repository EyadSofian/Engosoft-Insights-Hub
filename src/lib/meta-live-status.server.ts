import type { CampaignOperationalState, CampaignPlatformHealth, Platform } from "./types";

const DEFAULT_LIVE_STATUS_URL =
  "https://n8n.engosoft.com/webhook/engosoft-meta-campaign-live-status-v1-4fbe7508";
const DEFAULT_LIVE_STATUS_REFRESH_URL =
  "https://n8n.engosoft.com/webhook/engosoft-meta-campaign-refresh-v1-7d6522755ea8";
const CACHE_MS = 2 * 60 * 1000;
const REFRESH_AFTER_MS = 10 * 60 * 1000;
const READ_TIMEOUT_MS = 12_000;
const REFRESH_TIMEOUT_MS = 30_000;

interface LiveStatusResponse {
  ok: boolean;
  source: "n8n_live";
  definition: "official_status";
  generatedAt: string;
  accountsWithErrors: { accountId?: string; accountName?: string; message: string }[];
  platformHealth: CampaignPlatformHealth[];
  campaigns: Omit<CampaignOperationalState, "campaignKey">[];
}

let cached: { expiresAt: number; value: LiveStatusResponse } | null = null;
let inflight: Promise<LiveStatusResponse | null> | null = null;
let refreshInflight: Promise<void> | null = null;
let nextRefreshAllowedAt = 0;

const text = (value: unknown): string => (value == null ? "" : String(value).trim());
const finite = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const statusAge = (value: LiveStatusResponse): number => {
  const generatedAt = Date.parse(value.generatedAt);
  return Number.isFinite(generatedAt) ? Math.max(0, Date.now() - generatedAt) : Infinity;
};

function parseLiveStatus(raw: Partial<LiveStatusResponse>): LiveStatusResponse | null {
  if (!raw.ok || !Array.isArray(raw.campaigns) || !text(raw.generatedAt)) return null;

  const platforms = new Set<Platform>(["meta", "snapchat", "tiktok", "google"]);
  const campaigns = raw.campaigns
    .map((row) => {
      const platform = platforms.has(row.platform as Platform)
        ? (row.platform as Platform)
        : ("meta" as const);
      return {
        platform,
        accountId: text(row.accountId),
        account: text(row.account),
        accountTimezone: text(row.accountTimezone),
        campaignId: text(row.campaignId),
        name: text(row.name),
        configuredStatus: text(row.configuredStatus) || "UNKNOWN",
        effectiveStatus: text(row.effectiveStatus) || "UNKNOWN",
        servingStatus: text(row.servingStatus),
        statusReason: text(row.statusReason),
        startTime: text(row.startTime),
        stopTime: text(row.stopTime),
        updatedTime: text(row.updatedTime),
        activeAdsets: finite(row.activeAdsets),
        activeAds: finite(row.activeAds),
        spend24h: finite(row.spend24h),
        impressions24h: finite(row.impressions24h),
        clicks24h: finite(row.clicks24h),
        platformLeads24h:
          row.platformLeads24h === null || row.platformLeads24h === undefined
            ? null
            : finite(row.platformLeads24h),
        deliveryState: row.deliveryState === "active" ? ("active" as const) : ("unknown" as const),
        checkedAt: text(row.checkedAt) || text(raw.generatedAt),
        source: "n8n_live" as const,
      };
    })
    .filter((row) => !!row.campaignId && row.deliveryState === "active");

  return {
    ok: true,
    source: "n8n_live",
    definition: "official_status",
    generatedAt: text(raw.generatedAt),
    platformHealth: Array.isArray(raw.platformHealth)
      ? raw.platformHealth
          .map((entry) => ({
            platform: platforms.has(entry.platform as Platform)
              ? (entry.platform as Platform)
              : ("meta" as const),
            ok: entry.ok === true,
            enabled:
              entry.enabled === undefined || entry.enabled === null
                ? undefined
                : finite(entry.enabled),
            active: finite(entry.active),
            total: finite(entry.total),
            message: text(entry.message),
            checkedAt: text(entry.checkedAt) || text(raw.generatedAt),
          }))
          .filter(
            (entry, index, list) =>
              list.findIndex((candidate) => candidate.platform === entry.platform) === index,
          )
      : [],
    accountsWithErrors: Array.isArray(raw.accountsWithErrors)
      ? raw.accountsWithErrors.map((error) => ({
          accountId: text(error.accountId),
          accountName: text(error.accountName),
          message: text(error.message),
        }))
      : [],
    campaigns,
  };
}

async function requestStatus(
  url: string,
  method: "GET" | "POST",
  timeoutMs: number,
): Promise<LiveStatusResponse | null> {
  const response = await fetch(url, {
    method,
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) return null;
  return parseLiveStatus((await response.json()) as Partial<LiveStatusResponse>);
}

function refreshStatusBehindRequest(): void {
  const now = Date.now();
  if (refreshInflight || now < nextRefreshAllowedAt) return;
  // A broken refresh webhook must not turn normal page traffic into a retry
  // storm. The stale state stays excluded during this bounded backoff.
  nextRefreshAllowedAt = now + REFRESH_AFTER_MS;
  refreshInflight = requestStatus(
    process.env.META_LIVE_STATUS_REFRESH_URL || DEFAULT_LIVE_STATUS_REFRESH_URL,
    "POST",
    REFRESH_TIMEOUT_MS,
  )
    .then((refreshed) => {
      if (refreshed) cached = { expiresAt: Date.now() + CACHE_MS, value: refreshed };
    })
    .catch(() => undefined)
    .finally(() => {
      refreshInflight = null;
    });
}

/**
 * Reads n8n's in-memory official-status snapshot for every ad platform. Google
 * Sheets is deliberately not consulted here; it remains a recovery copy only.
 */
export async function loadMetaLiveStatus(): Promise<LiveStatusResponse | null> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const value = await requestStatus(
        process.env.META_LIVE_STATUS_URL || DEFAULT_LIVE_STATUS_URL,
        "GET",
        READ_TIMEOUT_MS,
      );
      if (!value) return null;

      // The n8n cache used to refresh only once an hour, so a campaign paused
      // at 10:16 could remain in an 11:00 popup. Refresh only when the shared
      // snapshot is old; normal requests stay a cheap cache read.
      if (statusAge(value) > REFRESH_AFTER_MS) {
        // Fail closed. A stale "Active" is worse than an unavailable status:
        // it is precisely how already-paused campaigns returned to the popup.
        const stale: LiveStatusResponse = {
          ...value,
          campaigns: [],
          platformHealth: value.platformHealth.map((health) => ({
            ...health,
            ok: false,
            active: 0,
            message: [health.message, "Official status refresh failed; stale state was excluded."]
              .filter(Boolean)
              .join(" | "),
          })),
          accountsWithErrors: [
            ...value.accountsWithErrors,
            { message: "Official status refresh failed; stale state was excluded." },
          ],
        };
        cached = { expiresAt: Date.now() + CACHE_MS, value: stale };
        // A platform scan can take 10–20 seconds. It must not become an
        // Overview latency tax; publish it into the shared cache when ready.
        refreshStatusBehindRequest();
        return stale;
      }

      cached = { expiresAt: Date.now() + CACHE_MS, value };
      return value;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
