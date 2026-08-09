import type { CampaignOperationalState, CampaignPlatformHealth, Platform } from "./types";

const DEFAULT_LIVE_STATUS_URL =
  "https://n8n.engosoft.com/webhook/engosoft-meta-campaign-live-status-v1-4fbe7508";
const CACHE_MS = 2 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12_000;

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

const text = (value: unknown): string => (value == null ? "" : String(value).trim());
const finite = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Reads n8n's in-memory official-status snapshot for every ad platform. Google
 * Sheets is deliberately not consulted here; it remains a recovery copy only.
 */
export async function loadMetaLiveStatus(): Promise<LiveStatusResponse | null> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (inflight) return inflight;

  inflight = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(process.env.META_LIVE_STATUS_URL || DEFAULT_LIVE_STATUS_URL, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const raw = (await response.json()) as Partial<LiveStatusResponse>;
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
            deliveryState:
              row.deliveryState === "active" ? ("active" as const) : ("unknown" as const),
            checkedAt: text(row.checkedAt) || text(raw.generatedAt),
            source: "n8n_live" as const,
          };
        })
        .filter((row) => !!row.campaignId && row.deliveryState === "active");

      const value: LiveStatusResponse = {
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
      cached = { expiresAt: Date.now() + CACHE_MS, value };
      return value;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
      inflight = null;
    }
  })();

  return inflight;
}
