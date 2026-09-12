// Server-only Meta creative enrichment.
//
// Delivery facts already arrive in PostgreSQL as `meta_ads`. They deliberately
// carry only stable IDs and metrics. This module uses those real Ad IDs to read
// the slowly-changing visual/copy resource directly from Meta, then stores a
// last-good copy in Railway PostgreSQL as `meta_ad_creatives`.
import { databaseConfigured, writeDashboardDataset } from "./dashboard-db.server";
import type { AdCreative } from "./types";

const DEFAULT_API_VERSION = "v25.0";
const GRAPH_BATCH_SIZE = 40;
const MAX_ADS_PER_READ = 600;
const REQUEST_TIMEOUT_MS = 30_000;
const CACHE_MS = 20 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 2 * 60 * 1000;

const AD_FIELDS = [
  "id",
  "name",
  "account_id",
  "configured_status",
  "effective_status",
  "created_time",
  "updated_time",
  "campaign{id,name}",
  "adset{id,name}",
  "creative{id,name,title,body,thumbnail_url,image_url,image_hash,video_id,object_story_spec,asset_feed_spec,effective_object_story_id,instagram_permalink_url,effective_instagram_media_id,url_tags,call_to_action_type}",
].join(",");

type JsonObject = Record<string, unknown>;

export interface MetaCreativeSyncResult {
  configured: boolean;
  ok: boolean;
  creatives: AdCreative[];
  requested: number;
  fetched: number;
  failed: number;
  persisted: boolean;
  syncedAt: string;
  message: string;
}

const memory = new Map<string, { expiresAt: number; creative: AdCreative }>();
const inflight = new Map<string, Promise<MetaCreativeSyncResult>>();
let retryAllowedAt = 0;

const object = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
const list = (value: unknown): JsonObject[] =>
  Array.isArray(value) ? value.map(object).filter((entry) => Object.keys(entry).length > 0) : [];
const text = (value: unknown): string => (value == null ? "" : String(value).trim());

const firstText = (values: JsonObject[], keys = ["text"]): string => {
  for (const entry of values) {
    for (const key of keys) {
      const value = text(entry[key]);
      if (value) return value;
    }
  }
  return "";
};

const httpUrl = (...values: unknown[]): string => {
  for (const value of values) {
    const candidate = text(value);
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.toString();
    } catch {
      // An opaque Meta identifier is not a browser-safe URL.
    }
  }
  return "";
};

export function metaCreativeHasContent(creative: AdCreative): boolean {
  return Boolean(
    creative.imageUrl ||
      creative.thumbnailUrl ||
      creative.videoUrl ||
      creative.videoId ||
      creative.headline ||
      creative.body ||
      creative.permalinkUrl,
  );
}

function freshCreative(creative: AdCreative, now: number): boolean {
  if (!metaCreativeHasContent(creative)) return false;
  const syncedAt = Date.parse(creative.syncedAt);
  return Number.isFinite(syncedAt) && now - syncedAt < CACHE_MS;
}

/** Pure normalizer kept exported so Meta response changes are fixture-tested. */
export function normalizeMetaGraphAd(
  rawValue: unknown,
  fallback: AdCreative,
  syncedAt: string,
): AdCreative | null {
  const raw = object(rawValue);
  const adId = text(raw.id) || fallback.adId;
  const creative = object(raw.creative);
  const creativeId = text(creative.id) || fallback.creativeId;
  if (!adId || !creativeId) return null;

  const campaign = object(raw.campaign);
  const adset = object(raw.adset);
  const story = object(creative.object_story_spec);
  const link = Object.keys(object(story.link_data)).length
    ? object(story.link_data)
    : object(story.template_data);
  const video = object(story.video_data);
  const photo = object(story.photo_data);
  const assets = object(creative.asset_feed_spec);
  const assetImages = list(assets.images);
  const assetVideos = list(assets.videos);
  const children = list(link.child_attachments);

  const videoId =
    text(creative.video_id) || text(video.video_id) || text(assetVideos[0]?.video_id);
  const imageUrl = httpUrl(
    creative.image_url,
    link.picture,
    link.image_url,
    video.image_url,
    photo.url,
    assetImages[0]?.url,
    creative.thumbnail_url,
  );
  const thumbnailUrl = httpUrl(
    creative.thumbnail_url,
    assetVideos[0]?.thumbnail_url,
    video.image_url,
    imageUrl,
  );
  const isCarousel = children.length > 1 || assetImages.length + assetVideos.length > 1;
  const mediaType = isCarousel ? "carousel" : videoId ? "video" : imageUrl ? "image" : "text";
  const headline =
    text(creative.title) || text(link.name) || text(video.title) || firstText(list(assets.titles));
  const body =
    text(creative.body) ||
    text(link.message) ||
    text(video.message) ||
    text(photo.caption) ||
    firstText(list(assets.bodies));
  const campaignId = text(campaign.id) || fallback.campaignId;

  return {
    platform: "meta",
    account: fallback.account,
    accountId: fallback.accountId || (text(raw.account_id) ? `act_${text(raw.account_id)}` : ""),
    campaign: text(campaign.name) || fallback.campaign,
    campaignId,
    campaignKey: fallback.campaignKey || (campaignId ? `id:${campaignId}` : ""),
    adset: text(adset.name) || fallback.adset,
    adsetId: text(adset.id) || fallback.adsetId,
    ad: text(raw.name) || fallback.ad,
    adId,
    creativeId,
    creativeName: text(creative.name) || fallback.creativeName || text(raw.name),
    creativeType: isCarousel ? "carousel" : mediaType,
    mediaType,
    headline,
    body,
    price: fallback.price,
    imageUrl,
    thumbnailUrl,
    videoUrl: "",
    videoId,
    permalinkUrl: httpUrl(creative.instagram_permalink_url),
    landingPageUrl: httpUrl(
      link.link,
      object(video.call_to_action).value && object(object(video.call_to_action).value).link,
      object(link.call_to_action).value && object(object(link.call_to_action).value).link,
      firstText(list(assets.link_urls), ["website_url", "url"]),
    ),
    status: text(raw.effective_status) || text(raw.configured_status) || fallback.status,
    reviewStatus: fallback.reviewStatus,
    reviewReason: fallback.reviewReason,
    createdAt: text(raw.created_time) || fallback.createdAt,
    updatedAt: text(raw.updated_time) || fallback.updatedAt,
    syncedAt,
  };
}

function storageRow(creative: AdCreative): Record<string, unknown> {
  return {
    __creative_key: `${creative.accountId}|${creative.adId}|${creative.creativeId}`,
    __account_id: creative.accountId,
    "Account Name": creative.account,
    __campaign_id: creative.campaignId,
    "Campaign Name": creative.campaign,
    __adset_id: creative.adsetId,
    "Ad Set Name": creative.adset,
    __ad_id: creative.adId,
    "Ad ID": creative.adId,
    "Ad Name": creative.ad,
    __creative_id: creative.creativeId,
    "Creative ID": creative.creativeId,
    "Creative Name": creative.creativeName,
    "Creative Type": creative.creativeType,
    "Media Type": creative.mediaType,
    "Creative Headline": creative.headline,
    "Creative Body": creative.body,
    "Creative Image URL": creative.imageUrl,
    "Creative Thumbnail URL": creative.thumbnailUrl,
    "Creative Video URL": creative.videoUrl,
    "Creative Video ID": creative.videoId,
    "Creative Permalink URL": creative.permalinkUrl,
    "Creative Landing Page URL": creative.landingPageUrl,
    "Creative Status": creative.status,
    "Review Status": creative.reviewStatus,
    "Review Reason": creative.reviewReason,
    "Creative Created At": creative.createdAt,
    "Creative Updated At": creative.updatedAt,
    __synced_at: creative.syncedAt,
  };
}

function safeError(error: unknown, token: string): string {
  return (error instanceof Error ? error.message : String(error))
    .replaceAll(token, "<redacted>")
    .replace(/access[_-]?token[=:][^&\s]+/gi, "access_token=<redacted>")
    .replace(/\s+/g, " ")
    .slice(0, 280);
}

async function fetchBatch(
  candidates: AdCreative[],
  token: string,
  apiVersion: string,
  syncedAt: string,
): Promise<{ creatives: AdCreative[]; failures: number; errors: string[] }> {
  const url = new URL(`https://graph.facebook.com/${apiVersion}/`);
  url.searchParams.set("ids", candidates.map((row) => row.adId).join(","));
  url.searchParams.set("fields", AD_FIELDS);
  url.searchParams.set("access_token", token);

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload = object(await response.json());
    const rootError = object(payload.error);
    if (!response.ok || Object.keys(rootError).length) {
      throw new Error(text(rootError.message) || `Meta returned HTTP ${response.status}`);
    }

    const creatives: AdCreative[] = [];
    const errors: string[] = [];
    let failures = 0;
    for (const candidate of candidates) {
      const entry = object(payload[candidate.adId]);
      const entryError = object(entry.error);
      if (!Object.keys(entry).length || Object.keys(entryError).length) {
        failures += 1;
        const message = text(entryError.message);
        if (message) errors.push(message.slice(0, 180));
        continue;
      }
      const normalized = normalizeMetaGraphAd(entry, candidate, syncedAt);
      if (normalized) creatives.push(normalized);
      else failures += 1;
    }
    return { creatives, failures, errors };
  } catch (error) {
    return {
      creatives: [],
      failures: candidates.length,
      errors: [safeError(error, token)],
    };
  }
}

const emptyResult = (configured: boolean, message: string): MetaCreativeSyncResult => ({
  configured,
  ok: false,
  creatives: [],
  requested: 0,
  fetched: 0,
  failed: 0,
  persisted: false,
  syncedAt: "",
  message,
});

export async function syncMetaCreativesDirect(
  input: readonly AdCreative[],
): Promise<MetaCreativeSyncResult> {
  const token = process.env.META_ACCESS_TOKEN?.trim() ?? "";
  if (!token) return emptyResult(false, "META_ACCESS_TOKEN is not configured on Railway.");

  const now = Date.now();
  const unique = new Map<string, AdCreative>();
  for (const candidate of input) {
    if (candidate.platform !== "meta" || !candidate.adId) continue;
    const previous = unique.get(candidate.adId);
    if (!previous || (!metaCreativeHasContent(previous) && metaCreativeHasContent(candidate))) {
      unique.set(candidate.adId, candidate);
    }
  }

  const cached: AdCreative[] = [];
  const targets: AdCreative[] = [];
  for (const candidate of [...unique.values()].slice(0, MAX_ADS_PER_READ)) {
    const hit = memory.get(candidate.adId);
    if (hit && hit.expiresAt > now) {
      cached.push(hit.creative);
    } else if (!freshCreative(candidate, now)) {
      targets.push(candidate);
    }
  }

  if (!targets.length) {
    return {
      configured: true,
      ok: true,
      creatives: cached,
      requested: 0,
      fetched: 0,
      failed: 0,
      persisted: false,
      syncedAt: cached[0]?.syncedAt ?? "",
      message: "Meta creative media and copy are current.",
    };
  }
  if (now < retryAllowedAt) {
    return {
      ...emptyResult(true, "Meta creative refresh is cooling down after a failed request."),
      creatives: cached,
      requested: targets.length,
    };
  }

  const key = targets
    .map((row) => row.adId)
    .sort()
    .join("\u001f");
  const existing = inflight.get(key);
  if (existing) return existing;

  const task = (async (): Promise<MetaCreativeSyncResult> => {
    const syncedAt = new Date().toISOString();
    const apiVersion = process.env.META_API_VERSION?.trim() || DEFAULT_API_VERSION;
    const batches: AdCreative[][] = [];
    for (let index = 0; index < targets.length; index += GRAPH_BATCH_SIZE) {
      batches.push(targets.slice(index, index + GRAPH_BATCH_SIZE));
    }

    const fetched: AdCreative[] = [];
    const errors: string[] = [];
    let failed = 0;
    // Three batches in flight keeps a full library quick without turning one
    // dashboard visit into an API burst against every Engosoft ad account.
    for (let index = 0; index < batches.length; index += 3) {
      const settled = await Promise.all(
        batches.slice(index, index + 3).map((batch) =>
          fetchBatch(batch, token, apiVersion, syncedAt),
        ),
      );
      for (const result of settled) {
        fetched.push(...result.creatives);
        failed += result.failures;
        errors.push(...result.errors);
      }
    }

    for (const creative of fetched) {
      memory.set(creative.adId, { expiresAt: now + CACHE_MS, creative });
    }
    if (!fetched.length && failed) retryAllowedAt = Date.now() + RETRY_AFTER_MS;

    let persisted = false;
    if (fetched.length && databaseConfigured()) {
      try {
        await writeDashboardDataset(
          "meta_ad_creatives",
          fetched.map(storageRow),
          {
            mode: "upsert",
            syncedAt,
            metadata: {
              source: "meta-graph-api-direct",
              grain: "ad-creative",
              requested: targets.length,
              fetched: fetched.length,
              failed,
            },
          },
        );
        persisted = true;
      } catch (error) {
        errors.push(`PostgreSQL last-good write failed: ${safeError(error, token)}`);
      }
    }

    const available = [...cached, ...fetched];
    const ok = fetched.length > 0 && failed === 0;
    const message = errors.length
      ? `${fetched.length} Meta creatives loaded; ${failed} failed. ${errors[0]}`
      : `${fetched.length} Meta creatives loaded directly from Meta.`;
    return {
      configured: true,
      ok,
      creatives: available,
      requested: targets.length,
      fetched: fetched.length,
      failed,
      persisted,
      syncedAt: fetched.length ? syncedAt : cached[0]?.syncedAt ?? "",
      message,
    };
  })().finally(() => inflight.delete(key));

  inflight.set(key, task);
  return task;
}

export function resetMetaCreativeCacheForTests(): void {
  memory.clear();
  inflight.clear();
  retryAllowedAt = 0;
}
