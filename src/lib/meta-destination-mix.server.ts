import {
  addSpend,
  buildCoverageMatrix,
  classifyMetaAdDestination,
  extractMetaAdEvidence,
  parseMetaActions,
  type ClassifiedAdPerformance,
  type CoverageRow,
} from "./meta-destination-mix";

/**
 * Meta-reported delivery per destination type for the dashboard's aggregate
 * section. It reads ad-level insights and ad destinations only, returns
 * aggregates only, and has no path into conversation or lead attribution.
 */

const DEFAULT_API_VERSION = "v21.0";
const REQUEST_TIMEOUT_MS = 25_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_PAGES = 60;
const AD_BATCH = 50;
const AD_RETRY_BATCH = 10;
const MAX_ERRORS = 10;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const AD_FIELDS =
  "id,adset{destination_type,optimization_goal},creative{call_to_action_type,link_url,template_url,object_story_spec,asset_feed_spec}";

type Json = Record<string, unknown>;

export interface MetaDestinationMix {
  configured: boolean;
  ok: boolean;
  scope: "meta_reported_aggregate";
  period: { from: string | null; to: string | null; preset: string | null };
  fetchedAt: string;
  accounts: number;
  deliveredAds: number;
  classifiedAds: number;
  unclassifiedAds: number;
  unclassifiedSpendByCurrency: Record<string, number>;
  campaigns: number;
  spendByCurrency: Record<string, number>;
  matrix: CoverageRow[];
  errors: string[];
}

const cache = new Map<string, { at: number; value: MetaDestinationMix }>();
const inflight = new Map<string, Promise<MetaDestinationMix>>();

export function resetMetaDestinationMixCacheForTests(): void {
  cache.clear();
  inflight.clear();
}

const obj = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function redact(error: unknown, token: string): string {
  return (error instanceof Error ? error.message : String(error))
    .replaceAll(token, "<redacted>")
    .replace(/access[_-]?token[=:][^&\s]+/gi, "access_token=<redacted>")
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

async function graph(url: string, token: string): Promise<Json> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = obj(await response.json().catch(() => ({})));
  const error = obj(payload.error);
  if (!response.ok || Object.keys(error).length)
    throw new Error(str(error.message) || `Meta returned HTTP ${response.status}`);
  return payload;
}

async function paged(url: string, token: string, errors: string[], label: string): Promise<Json[]> {
  const rows: Json[] = [];
  let next: string | null = url;
  for (let page = 0; next && page < MAX_PAGES; page += 1) {
    try {
      const payload = await graph(next, token);
      for (const row of Array.isArray(payload.data) ? payload.data : []) rows.push(obj(row));
      next = str(obj(payload.paging).next) || null;
    } catch (error) {
      errors.push(`${label}: ${redact(error, token)}`);
      break;
    }
  }
  return rows;
}

async function fetchAdDetails(
  base: string,
  adIds: string[],
  token: string,
  errors: string[],
): Promise<Map<string, Json>> {
  const details = new Map<string, Json>();
  const request = async (ids: string[]) => {
    const url = new URL(base);
    url.searchParams.set("ids", ids.join(","));
    url.searchParams.set("fields", AD_FIELDS);
    const payload = await graph(url.toString(), token);
    for (const id of ids) {
      const entry = obj(payload[id]);
      if (Object.keys(entry).length && !Object.keys(obj(entry.error)).length)
        details.set(id, entry);
    }
  };
  for (let index = 0; index < adIds.length; index += AD_BATCH) {
    const batch = adIds.slice(index, index + AD_BATCH);
    try {
      await request(batch);
    } catch {
      // Meta occasionally fails a whole batch for one bad ad; retry in smaller slices.
      for (let retry = 0; retry < batch.length; retry += AD_RETRY_BATCH) {
        try {
          await request(batch.slice(retry, retry + AD_RETRY_BATCH));
        } catch (error) {
          errors.push(`ad details: ${redact(error, token)}`);
        }
      }
    }
  }
  return details;
}

function emptyMix(
  configured: boolean,
  period: MetaDestinationMix["period"],
  error: string,
): MetaDestinationMix {
  return {
    configured,
    ok: false,
    scope: "meta_reported_aggregate",
    period,
    fetchedAt: new Date().toISOString(),
    accounts: 0,
    deliveredAds: 0,
    classifiedAds: 0,
    unclassifiedAds: 0,
    unclassifiedSpendByCurrency: {},
    campaigns: 0,
    spendByCurrency: {},
    matrix: buildCoverageMatrix([]),
    errors: [error],
  };
}

async function compute(
  token: string,
  period: MetaDestinationMix["period"],
): Promise<MetaDestinationMix> {
  const version = process.env.META_API_VERSION?.trim() || DEFAULT_API_VERSION;
  const base = `https://graph.facebook.com/${version}/`;
  const errors: string[] = [];
  const accounts = await paged(
    `${base}me/adaccounts?fields=id,currency&limit=100`,
    token,
    errors,
    "ad accounts",
  );

  const delivered = new Map<string, Omit<ClassifiedAdPerformance, "classification">>();
  for (const account of accounts) {
    const accountId = str(account.id);
    if (!accountId) continue;
    const url = new URL(`${base}${accountId}/insights`);
    url.searchParams.set("level", "ad");
    url.searchParams.set("fields", "campaign_id,ad_id,spend,impressions,clicks,actions");
    url.searchParams.set("limit", "500");
    if (period.from && period.to)
      url.searchParams.set("time_range", JSON.stringify({ since: period.from, until: period.to }));
    else url.searchParams.set("date_preset", period.preset ?? "last_90d");
    for (const row of await paged(url.toString(), token, errors, `insights ${accountId}`)) {
      const adId = str(row.ad_id);
      const spend = num(row.spend);
      const impressions = num(row.impressions);
      if (!adId || (spend <= 0 && impressions <= 0)) continue;
      delivered.set(adId, {
        adId,
        campaignId: str(row.campaign_id),
        currency: str(account.currency),
        spend,
        impressions,
        clicks: num(row.clicks),
        actions: parseMetaActions(row.actions),
      });
    }
  }

  const details = await fetchAdDetails(base, [...delivered.keys()], token, errors);
  const classified: ClassifiedAdPerformance[] = [];
  const spendByCurrency: Record<string, number> = {};
  const unclassifiedSpendByCurrency: Record<string, number> = {};
  for (const ad of delivered.values()) {
    addSpend(spendByCurrency, ad.currency, ad.spend);
    const detail = details.get(ad.adId);
    if (!detail) {
      addSpend(unclassifiedSpendByCurrency, ad.currency, ad.spend);
      continue;
    }
    classified.push({
      ...ad,
      classification: classifyMetaAdDestination(extractMetaAdEvidence(detail)),
    });
  }

  return {
    configured: true,
    ok: accounts.length > 0 && errors.length === 0,
    scope: "meta_reported_aggregate",
    period,
    fetchedAt: new Date().toISOString(),
    accounts: accounts.length,
    deliveredAds: delivered.size,
    classifiedAds: classified.length,
    unclassifiedAds: delivered.size - classified.length,
    unclassifiedSpendByCurrency,
    campaigns: new Set([...delivered.values()].map((ad) => ad.campaignId)).size,
    spendByCurrency,
    matrix: buildCoverageMatrix(classified),
    errors: errors.slice(0, MAX_ERRORS),
  };
}

export async function getMetaDestinationMix(
  input: { from?: string; to?: string } = {},
): Promise<MetaDestinationMix> {
  const from = input.from && DATE.test(input.from) ? input.from : null;
  const to = input.to && DATE.test(input.to) ? input.to : null;
  const period: MetaDestinationMix["period"] =
    from && to ? { from, to, preset: null } : { from: null, to: null, preset: "last_90d" };
  const token = process.env.META_ACCESS_TOKEN?.trim() ?? "";
  if (!token) return emptyMix(false, period, "META_ACCESS_TOKEN is not configured.");

  const key = `${period.from}|${period.to}|${period.preset}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const running = inflight.get(key);
  if (running) return running;

  const job = compute(token, period)
    .catch((error) => emptyMix(true, period, redact(error, token)))
    .then((value) => {
      if (value.ok) cache.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}
