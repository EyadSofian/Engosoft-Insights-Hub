import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Pool } from "pg";
import {
  getChatwootConversationLabels,
  replaceChatwootConversationLabels,
  updateChatwootConversationAttributes,
} from "./chatwoot.server";
import {
  CHATWOOT_ATTRIBUTION_KEYS,
  buildChatwootAttributionAttributes,
  planChatwootAttributionUpdate,
} from "./chatwoot-attribution-attributes";
import { configuredCustomerType, configuredMarketer } from "./chatwoot-attribution-context.server";
import {
  databaseConfigured,
  readDashboardDatasets,
  type DashboardRow,
} from "./dashboard-db.server";

export type MetaMessageProvider = "whatsapp" | "messenger" | "instagram";
export type CanonicalChannel = "whatsapp" | "messenger" | "instagram_dm";
export type ProviderAttributionMethod =
  "meta_whatsapp_referral" | "meta_messenger_referral" | "meta_instagram_referral" | "inbox_only";

export interface MetaMessageEvidence {
  provider: MetaMessageProvider;
  providerMessageId: string;
  channel: CanonicalChannel;
  sourcePlatform: string;
  destinationPhoneNumberId: string;
  destinationPageId: string;
  referralSourceId: string;
  ctwaClid: string;
  sourceUrl: string;
  sourceType: string;
  occurredAt: string;
  attributionMethod: ProviderAttributionMethod;
  attributionConfidence: "exact" | "inferred";
  unknownReason: string;
  reducedEvidence: Record<string, unknown>;
}

export interface MetaIdentityResolution {
  matchedAs: "ad_id" | "creative_id" | "effective_object_story_id" | "source_post_id" | "";
  accountId: string;
  campaignId: string;
  campaignName: string;
  adsetId: string;
  adsetName: string;
  adId: string;
  adName: string;
  creativeId: string;
  creativeName: string;
  effectiveObjectStoryId: string;
  sourcePostId: string;
  placement: string;
}

const MAX_WEBHOOK_TEXT = 1_000;

/**
 * Provider message IDs of the platform self-test. Real Meta IDs start with
 * `wamid.`, `m_` or `aWdf`; nothing Meta sends starts with this prefix, so a
 * self-test event can never be mistaken for, or counted as, real traffic.
 */
export const SELF_TEST_MESSAGE_PREFIX = "selftest.";

export function isSelfTestMessageId(providerMessageId: string): boolean {
  return providerMessageId.startsWith(SELF_TEST_MESSAGE_PREFIX);
}
const MAX_PROCESS_ATTEMPTS = 8;
const MANAGED_LABEL_PREFIXES = ["src:", "channel:", "campaign:", "branch:"];

let pool: Pool | null = null;
let schemaPromise: Promise<void> | null = null;
let workerStarted = false;
let workerTimer: ReturnType<typeof setInterval> | null = null;
let catalogRefreshInFlight: Promise<{ rows: number }> | null = null;
let catalogRefreshCompletedAt = 0;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return object(value) || {};
  try {
    return object(JSON.parse(value)) || {};
  } catch {
    return {};
  }
}

function text(value: unknown, max = MAX_WEBHOOK_TEXT): string {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? (value.map(object).filter(Boolean) as Record<string, unknown>[])
    : [];
}

function first(row: Record<string, unknown> | null | undefined, keys: string[]): string {
  if (!row) return "";
  for (const key of keys) {
    const value = text(row[key]);
    if (value) return value;
  }
  return "";
}

function iso(value: unknown): string {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(numeric < 10_000_000_000 ? numeric * 1_000 : numeric).toISOString();
  }
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function platformFromUrl(value: string): string {
  if (!value) return "";
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    if (hostname.includes("instagram")) return "instagram";
    if (hostname.includes("facebook") || hostname.includes("fb.")) return "facebook";
  } catch {
    return "";
  }
  return "";
}

function referralForMessaging(event: Record<string, unknown>): Record<string, unknown> {
  return (
    object(event.referral) ||
    object(object(event.message)?.referral) ||
    object(object(event.postback)?.referral) ||
    {}
  );
}

function methodFor(provider: MetaMessageProvider, paid: boolean): ProviderAttributionMethod {
  if (!paid) return "inbox_only";
  if (provider === "whatsapp") return "meta_whatsapp_referral";
  if (provider === "instagram") return "meta_instagram_referral";
  return "meta_messenger_referral";
}

function evidence(input: Omit<MetaMessageEvidence, "reducedEvidence">): MetaMessageEvidence {
  return {
    ...input,
    reducedEvidence: {
      provider: input.provider,
      channel: input.channel,
      source_platform: input.sourcePlatform,
      destination_phone_number_id: input.destinationPhoneNumberId || undefined,
      destination_page_id: input.destinationPageId || undefined,
      referral_source_id: input.referralSourceId || undefined,
      ctwa_clid: input.ctwaClid || undefined,
      source_url: input.sourceUrl || undefined,
      source_type: input.sourceType || undefined,
    },
  };
}

/**
 * Reduces original Meta webhook payloads to non-customer marketing evidence.
 * Message bodies, contacts, names, emails and sender phone numbers are never copied.
 */
export function normalizeMetaMessageWebhook(payload: unknown): MetaMessageEvidence[] {
  const root = object(payload) || {};
  const kind = text(root.object).toLowerCase();
  const output: MetaMessageEvidence[] = [];

  if (kind === "whatsapp_business_account") {
    for (const entry of rows(root.entry)) {
      for (const change of rows(entry.changes)) {
        if (text(change.field) !== "messages") continue;
        const value = object(change.value) || {};
        const metadata = object(value.metadata) || {};
        for (const message of rows(value.messages)) {
          const providerMessageId = first(message, ["id"]);
          if (!providerMessageId) continue;
          const referral = object(message.referral) || {};
          const referralSourceId = first(referral, ["source_id", "sourceId", "id"]);
          const ctwaClid = first(referral, ["ctwa_clid", "ctwaClid"]);
          const sourceUrl = first(referral, ["source_url", "sourceUrl", "url"]);
          const paid = Boolean(referralSourceId || ctwaClid);
          output.push(
            evidence({
              provider: "whatsapp",
              providerMessageId,
              channel: "whatsapp",
              sourcePlatform: platformFromUrl(sourceUrl) || (paid ? "meta" : "direct_or_unknown"),
              destinationPhoneNumberId: first(metadata, ["phone_number_id"]),
              destinationPageId: "",
              referralSourceId,
              ctwaClid,
              sourceUrl,
              sourceType: first(referral, ["source_type", "sourceType"]),
              occurredAt: iso(message.timestamp),
              attributionMethod: methodFor("whatsapp", paid),
              attributionConfidence: paid ? "exact" : "inferred",
              unknownReason: paid ? "" : "no_paid_referral",
            }),
          );
        }
      }
    }
    return output;
  }

  const provider: MetaMessageProvider | null =
    kind === "instagram" ? "instagram" : kind === "page" ? "messenger" : null;
  if (!provider) return output;
  for (const entry of rows(root.entry)) {
    for (const item of rows(entry.messaging)) {
      const message = object(item.message) || {};
      if (message.is_echo === true) continue;
      const providerMessageId = first(message, ["mid", "id"]);
      if (!providerMessageId) continue;
      const referral = referralForMessaging(item);
      const referralSourceId = first(referral, ["source_id", "sourceId", "ad_id", "id"]);
      const ctwaClid = first(referral, ["ctwa_clid", "ctwaClid"]);
      const sourceUrl = first(referral, ["source_url", "sourceUrl", "referer_uri", "ref"]);
      const paid = Boolean(referralSourceId || ctwaClid);
      const defaultPlatform = provider === "instagram" ? "instagram" : "facebook";
      output.push(
        evidence({
          provider,
          providerMessageId,
          channel: provider === "instagram" ? "instagram_dm" : "messenger",
          sourcePlatform: platformFromUrl(sourceUrl) || defaultPlatform,
          destinationPhoneNumberId: "",
          destinationPageId: first(object(item.recipient), ["id"]) || first(entry, ["id"]),
          referralSourceId,
          ctwaClid,
          sourceUrl,
          sourceType: first(referral, ["source_type", "sourceType", "type"]),
          occurredAt: iso(item.timestamp),
          attributionMethod: methodFor(provider, paid),
          attributionConfidence: paid ? "exact" : "inferred",
          unknownReason: paid ? "" : "organic_direct",
        }),
      );
    }
  }
  return output;
}

export function verifyMetaWebhookSignature(
  rawBody: string,
  signature: string,
  appSecret: string,
): boolean {
  if (!rawBody || !signature || !appSecret || !signature.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyMetaWebhookChallenge(input: {
  mode: string;
  verifyToken: string;
  expectedToken: string;
  challenge: string;
}): string | null {
  if (input.mode !== "subscribe" || !input.verifyToken || !input.expectedToken) return null;
  const left = Buffer.from(input.verifyToken);
  const right = Buffer.from(input.expectedToken);
  return left.length === right.length && timingSafeEqual(left, right) ? input.challenge : null;
}

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
      ssl:
        connectionString.includes(".railway.internal") || process.env.PGSSLMODE === "disable"
          ? false
          : { rejectUnauthorized: false },
    });
  }
  return pool;
}

async function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = getPool()
      .query(
        `
      CREATE TABLE IF NOT EXISTS meta_message_attribution_events (
        id bigserial PRIMARY KEY,
        event_key text NOT NULL UNIQUE,
        provider text NOT NULL,
        provider_message_id text NOT NULL,
        channel text NOT NULL,
        source_platform text NOT NULL DEFAULT '',
        destination_phone_number_id text NOT NULL DEFAULT '',
        destination_page_id text NOT NULL DEFAULT '',
        referral_source_id text NOT NULL DEFAULT '',
        ctwa_clid text NOT NULL DEFAULT '',
        source_url text NOT NULL DEFAULT '',
        source_type text NOT NULL DEFAULT '',
        attribution_method text NOT NULL,
        attribution_confidence text NOT NULL,
        unknown_reason text NOT NULL DEFAULT '',
        reduced_evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
        payload_hash text NOT NULL,
        occurred_at timestamptz NOT NULL,
        received_at timestamptz NOT NULL DEFAULT now(),
        processed_at timestamptz,
        next_attempt_at timestamptz NOT NULL DEFAULT now(),
        status text NOT NULL DEFAULT 'received',
        attempts integer NOT NULL DEFAULT 0,
        duplicate_deliveries integer NOT NULL DEFAULT 0,
        last_error text NOT NULL DEFAULT '',
        UNIQUE (provider, provider_message_id)
      );
      CREATE INDEX IF NOT EXISTS meta_message_attribution_events_retry_idx
        ON meta_message_attribution_events (status, next_attempt_at, received_at);
      CREATE INDEX IF NOT EXISTS meta_message_attribution_events_provider_message_idx
        ON meta_message_attribution_events (provider_message_id);

      CREATE TABLE IF NOT EXISTS meta_entity_identity_catalog (
        ad_id text PRIMARY KEY,
        account_id text NOT NULL DEFAULT '',
        campaign_id text NOT NULL DEFAULT '',
        campaign_name text NOT NULL DEFAULT '',
        adset_id text NOT NULL DEFAULT '',
        adset_name text NOT NULL DEFAULT '',
        ad_name text NOT NULL DEFAULT '',
        creative_id text NOT NULL DEFAULT '',
        creative_name text NOT NULL DEFAULT '',
        effective_object_story_id text NOT NULL DEFAULT '',
        source_post_id text NOT NULL DEFAULT '',
        placement text NOT NULL DEFAULT '',
        status text NOT NULL DEFAULT '',
        source text NOT NULL DEFAULT '',
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS meta_entity_identity_catalog_creative_idx
        ON meta_entity_identity_catalog (creative_id) WHERE creative_id <> '';
      CREATE INDEX IF NOT EXISTS meta_entity_identity_catalog_story_idx
        ON meta_entity_identity_catalog (effective_object_story_id) WHERE effective_object_story_id <> '';
      CREATE INDEX IF NOT EXISTS meta_entity_identity_catalog_post_idx
        ON meta_entity_identity_catalog (source_post_id) WHERE source_post_id <> '';

      ALTER TABLE chatwoot_event_inbox ADD COLUMN IF NOT EXISTS provider_message_id text;
      CREATE INDEX IF NOT EXISTS chatwoot_event_inbox_provider_message_idx
        ON chatwoot_event_inbox (provider_message_id) WHERE provider_message_id IS NOT NULL;
      ALTER TABLE chatwoot_attribution_touches ADD COLUMN IF NOT EXISTS provider_message_id text NOT NULL DEFAULT '';
      ALTER TABLE chatwoot_attribution_touches ADD COLUMN IF NOT EXISTS destination_phone_number_id text NOT NULL DEFAULT '';
      ALTER TABLE chatwoot_attribution_touches ADD COLUMN IF NOT EXISTS destination_page_id text NOT NULL DEFAULT '';
      ALTER TABLE chatwoot_attribution_touches ADD COLUMN IF NOT EXISTS creative_name text NOT NULL DEFAULT '';
      ALTER TABLE chatwoot_attribution_touches ADD COLUMN IF NOT EXISTS placement text NOT NULL DEFAULT '';
      ALTER TABLE chatwoot_attribution_touches ADD COLUMN IF NOT EXISTS attribution_scope text NOT NULL DEFAULT 'conversation';
      ALTER TABLE chatwoot_attribution_touches ADD COLUMN IF NOT EXISTS unknown_reason text NOT NULL DEFAULT '';
      ALTER TABLE chatwoot_conversation_attribution ADD COLUMN IF NOT EXISTS creative_id text NOT NULL DEFAULT '';
      ALTER TABLE chatwoot_conversation_attribution ADD COLUMN IF NOT EXISTS creative_name text NOT NULL DEFAULT '';
      ALTER TABLE chatwoot_conversation_attribution ADD COLUMN IF NOT EXISTS placement text NOT NULL DEFAULT '';
      ALTER TABLE chatwoot_conversation_attribution ADD COLUMN IF NOT EXISTS utm_source text NOT NULL DEFAULT '';
      ALTER TABLE chatwoot_conversation_attribution ADD COLUMN IF NOT EXISTS utm_medium text NOT NULL DEFAULT '';
      ALTER TABLE chatwoot_conversation_attribution ADD COLUMN IF NOT EXISTS utm_campaign text NOT NULL DEFAULT '';
      ALTER TABLE chatwoot_conversation_attribution ADD COLUMN IF NOT EXISTS utm_content text NOT NULL DEFAULT '';
      ALTER TABLE chatwoot_conversation_attribution ADD COLUMN IF NOT EXISTS utm_term text NOT NULL DEFAULT '';
      ALTER TABLE chatwoot_conversation_attribution ADD COLUMN IF NOT EXISTS chatwoot_message_id bigint;
      ALTER TABLE chatwoot_conversation_attribution ADD COLUMN IF NOT EXISTS provider_message_id text NOT NULL DEFAULT '';
      ALTER TABLE chatwoot_conversation_attribution ADD COLUMN IF NOT EXISTS destination_phone_number_id text NOT NULL DEFAULT '';
      ALTER TABLE chatwoot_conversation_attribution ADD COLUMN IF NOT EXISTS destination_page_id text NOT NULL DEFAULT '';
      ALTER TABLE chatwoot_conversation_attribution ADD COLUMN IF NOT EXISTS referral_source_id text NOT NULL DEFAULT '';
      ALTER TABLE chatwoot_conversation_attribution ADD COLUMN IF NOT EXISTS ctwa_clid text NOT NULL DEFAULT '';
      ALTER TABLE chatwoot_conversation_attribution ADD COLUMN IF NOT EXISTS attribution_scope text NOT NULL DEFAULT 'conversation';
      ALTER TABLE chatwoot_conversation_attribution ADD COLUMN IF NOT EXISTS unknown_reason text NOT NULL DEFAULT '';
    `,
      )
      .then(() => undefined)
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }
  await schemaPromise;
}

export async function ingestMetaMessageAttributionWebhook(input: {
  payload: unknown;
  rawBody: string;
}): Promise<{ accepted: number; duplicates: number }> {
  if (!databaseConfigured())
    throw new Error("DATABASE_URL is required for durable Meta webhook ingestion");
  await ensureSchema();
  const normalized = normalizeMetaMessageWebhook(input.payload);
  const payloadHash = hash(input.rawBody);
  let accepted = 0;
  let duplicates = 0;
  for (const item of normalized) {
    const eventKey = `${item.provider}:${item.providerMessageId}`;
    // A self-test event is stored (that is the proof) but parked outside the worker's statuses.
    const selfTest = isSelfTestMessageId(item.providerMessageId);
    const result = await getPool().query(
      `INSERT INTO meta_message_attribution_events (
        event_key, provider, provider_message_id, channel, source_platform,
        destination_phone_number_id, destination_page_id, referral_source_id, ctwa_clid,
        source_url, source_type, attribution_method, attribution_confidence, unknown_reason,
        reduced_evidence_json, payload_hash, occurred_at, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18)
      ON CONFLICT (provider, provider_message_id) DO UPDATE SET
        duplicate_deliveries = meta_message_attribution_events.duplicate_deliveries + 1
      RETURNING (xmax = 0) AS inserted`,
      [
        eventKey,
        item.provider,
        item.providerMessageId,
        item.channel,
        item.sourcePlatform,
        item.destinationPhoneNumberId,
        item.destinationPageId,
        item.referralSourceId,
        item.ctwaClid,
        item.sourceUrl,
        item.sourceType,
        item.attributionMethod,
        item.attributionConfidence,
        item.unknownReason,
        JSON.stringify(item.reducedEvidence),
        payloadHash,
        item.occurredAt,
        selfTest ? "self_test" : "received",
      ],
    );
    if (result.rows[0]?.inserted) accepted += 1;
    else duplicates += 1;
  }
  return { accepted, duplicates };
}

function scalar(row: DashboardRow, keys: string[]): string {
  for (const key of keys) {
    const value = text(row[key]);
    if (value) return value;
  }
  return "";
}

function identityFromRows(
  ad: DashboardRow,
  creative?: DashboardRow,
): Omit<MetaIdentityResolution, "matchedAs"> {
  return {
    accountId: scalar(ad, ["__account_id", "Account ID", "account_id", "accountId"]),
    campaignId: scalar(ad, ["__campaign_id", "Campaign ID", "campaign_id", "campaignId"]),
    campaignName: scalar(ad, ["Campaign Name", "campaign_name", "campaignName"]),
    adsetId: scalar(ad, ["__adset_id", "Ad Set ID", "adset_id", "adsetId"]),
    adsetName: scalar(ad, ["Ad Set Name", "adset_name", "adsetName"]),
    adId: scalar(ad, ["__ad_id", "Ad ID", "ad_id", "adId"]),
    adName: scalar(ad, ["Ad Name", "ad_name", "adName"]),
    creativeId: scalar(creative || ad, [
      "__creative_id",
      "Creative ID",
      "creative_id",
      "creativeId",
    ]),
    creativeName: scalar(creative || ad, [
      "Creative Name",
      "creative_name",
      "creativeName",
      "name",
    ]),
    effectiveObjectStoryId: scalar(creative || ad, [
      "effective_object_story_id",
      "effectiveObjectStoryId",
      "Effective Object Story ID",
    ]),
    sourcePostId: scalar(creative || ad, [
      "source_post_id",
      "sourcePostId",
      "post_id",
      "postId",
      "Post ID",
    ]),
    placement: scalar(ad, ["placement", "publisher_platform", "Publisher Platform"]),
  };
}

export async function refreshMetaIdentityCatalog(): Promise<{ rows: number }> {
  if (!databaseConfigured()) return { rows: 0 };
  await ensureSchema();
  const [ads, creatives] = await readDashboardDatasets(["meta_ads", "meta_ad_creatives"]);
  const creativeByAd = new Map<string, DashboardRow>();
  for (const row of creatives.rows) {
    const adId = scalar(row, ["__ad_id", "Ad ID", "ad_id", "adId"]);
    if (adId) creativeByAd.set(adId, row);
  }
  const unique = new Map<
    string,
    { identity: Omit<MetaIdentityResolution, "matchedAs">; status: string }
  >();
  for (const row of ads.rows) {
    const identity = identityFromRows(
      row,
      creativeByAd.get(scalar(row, ["__ad_id", "Ad ID", "ad_id", "adId"])),
    );
    if (!identity.adId) continue;
    unique.set(identity.adId, {
      identity,
      status: scalar(row, ["effective_status", "status", "Ad Status"]),
    });
  }
  for (const row of creatives.rows) {
    const adId = scalar(row, ["__ad_id", "Ad ID", "ad_id", "adId"]);
    if (!adId || unique.has(adId)) continue;
    const identity = identityFromRows(row, row);
    unique.set(adId, { identity, status: scalar(row, ["effective_status", "status"]) });
  }
  const db = getPool();
  const catalogRows = [...unique.values()].map(({ identity: x, status }) => ({
    ad_id: x.adId,
    account_id: x.accountId,
    campaign_id: x.campaignId,
    campaign_name: x.campaignName,
    adset_id: x.adsetId,
    adset_name: x.adsetName,
    ad_name: x.adName,
    creative_id: x.creativeId,
    creative_name: x.creativeName,
    effective_object_story_id: x.effectiveObjectStoryId,
    source_post_id: x.sourcePostId,
    placement: x.placement,
    status,
  }));
  for (let index = 0; index < catalogRows.length; index += 1_000) {
    await db.query(
      `INSERT INTO meta_entity_identity_catalog (
        ad_id, account_id, campaign_id, campaign_name, adset_id, adset_name, ad_name,
        creative_id, creative_name, effective_object_story_id, source_post_id, placement, status, source, updated_at
      )
      SELECT ad_id, account_id, campaign_id, campaign_name, adset_id, adset_name, ad_name,
             creative_id, creative_name, effective_object_story_id, source_post_id, placement,
             status, 'dashboard-datasets', now()
      FROM jsonb_to_recordset($1::jsonb) AS x(
        ad_id text, account_id text, campaign_id text, campaign_name text,
        adset_id text, adset_name text, ad_name text, creative_id text, creative_name text,
        effective_object_story_id text, source_post_id text, placement text, status text
      )
      ON CONFLICT (ad_id) DO UPDATE SET
        account_id=EXCLUDED.account_id, campaign_id=EXCLUDED.campaign_id,
        campaign_name=EXCLUDED.campaign_name, adset_id=EXCLUDED.adset_id,
        adset_name=EXCLUDED.adset_name, ad_name=EXCLUDED.ad_name,
        creative_id=EXCLUDED.creative_id, creative_name=EXCLUDED.creative_name,
        effective_object_story_id=EXCLUDED.effective_object_story_id,
        source_post_id=EXCLUDED.source_post_id, placement=EXCLUDED.placement,
        status=EXCLUDED.status, source=EXCLUDED.source, updated_at=now()`,
      [JSON.stringify(catalogRows.slice(index, index + 1_000))],
    );
  }
  return { rows: unique.size };
}

function blankResolution(): MetaIdentityResolution {
  return {
    matchedAs: "",
    accountId: "",
    campaignId: "",
    campaignName: "",
    adsetId: "",
    adsetName: "",
    adId: "",
    adName: "",
    creativeId: "",
    creativeName: "",
    effectiveObjectStoryId: "",
    sourcePostId: "",
    placement: "",
  };
}

async function resolveFromCatalog(sourceId: string): Promise<MetaIdentityResolution | null> {
  const result = await getPool().query<Record<string, string>>(
    `SELECT *, CASE
       WHEN ad_id=$1 THEN 'ad_id'
       WHEN creative_id=$1 THEN 'creative_id'
       WHEN effective_object_story_id=$1 THEN 'effective_object_story_id'
       WHEN source_post_id=$1 THEN 'source_post_id'
       ELSE '' END AS matched_as
     FROM meta_entity_identity_catalog
     WHERE ad_id=$1 OR creative_id=$1 OR effective_object_story_id=$1 OR source_post_id=$1
     ORDER BY CASE WHEN ad_id=$1 THEN 1 WHEN creative_id=$1 THEN 2 WHEN effective_object_story_id=$1 THEN 3 ELSE 4 END
     LIMIT 1`,
    [sourceId],
  );
  const x = result.rows[0];
  if (!x) return null;
  return {
    matchedAs: x.matched_as as MetaIdentityResolution["matchedAs"],
    accountId: x.account_id,
    campaignId: x.campaign_id,
    campaignName: x.campaign_name,
    adsetId: x.adset_id,
    adsetName: x.adset_name,
    adId: x.ad_id,
    adName: x.ad_name,
    creativeId: x.creative_id,
    creativeName: x.creative_name,
    effectiveObjectStoryId: x.effective_object_story_id,
    sourcePostId: x.source_post_id,
    placement: x.placement,
  };
}

async function resolveGraphAd(sourceId: string): Promise<MetaIdentityResolution | null> {
  const token = process.env.META_ACCESS_TOKEN?.trim();
  if (!token) return null;
  const version = process.env.META_API_VERSION?.trim() || "v25.0";
  const url = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(sourceId)}`);
  url.searchParams.set(
    "fields",
    "id,name,account_id,campaign{id,name},adset{id,name},creative{id,name,effective_object_story_id,object_story_id}",
  );
  url.searchParams.set("access_token", token);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    const payload = object(await response.json()) || {};
    if (!response.ok || object(payload.error)) return null;
    const campaign = object(payload.campaign) || {};
    const adset = object(payload.adset) || {};
    const creative = object(payload.creative) || {};
    if (!first(campaign, ["id"]) || !first(adset, ["id"])) return null;
    const resolved: MetaIdentityResolution = {
      ...blankResolution(),
      matchedAs: "ad_id",
      accountId: first(payload, ["account_id"]),
      campaignId: first(campaign, ["id"]),
      campaignName: first(campaign, ["name"]),
      adsetId: first(adset, ["id"]),
      adsetName: first(adset, ["name"]),
      adId: first(payload, ["id"]),
      adName: first(payload, ["name"]),
      creativeId: first(creative, ["id"]),
      creativeName: first(creative, ["name"]),
      effectiveObjectStoryId: first(creative, ["effective_object_story_id"]),
      sourcePostId: first(creative, ["object_story_id"]),
    };
    await getPool().query(
      `INSERT INTO meta_entity_identity_catalog (ad_id,account_id,campaign_id,campaign_name,adset_id,adset_name,ad_name,creative_id,creative_name,effective_object_story_id,source_post_id,source,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'meta-graph-exact',now())
       ON CONFLICT (ad_id) DO UPDATE SET account_id=EXCLUDED.account_id,campaign_id=EXCLUDED.campaign_id,campaign_name=EXCLUDED.campaign_name,adset_id=EXCLUDED.adset_id,adset_name=EXCLUDED.adset_name,ad_name=EXCLUDED.ad_name,creative_id=EXCLUDED.creative_id,creative_name=EXCLUDED.creative_name,effective_object_story_id=EXCLUDED.effective_object_story_id,source_post_id=EXCLUDED.source_post_id,source=EXCLUDED.source,updated_at=now()`,
      [
        resolved.adId,
        resolved.accountId,
        resolved.campaignId,
        resolved.campaignName,
        resolved.adsetId,
        resolved.adsetName,
        resolved.adName,
        resolved.creativeId,
        resolved.creativeName,
        resolved.effectiveObjectStoryId,
        resolved.sourcePostId,
      ],
    );
    return resolved;
  } catch {
    return null;
  }
}

export async function resolveMetaSourceId(
  sourceId: string,
): Promise<MetaIdentityResolution | null> {
  if (!sourceId || !databaseConfigured()) return null;
  await ensureSchema();
  let resolved = await resolveFromCatalog(sourceId);
  if (resolved) return resolved;
  if (Date.now() - catalogRefreshCompletedAt >= 5 * 60_000) {
    catalogRefreshInFlight ||= refreshMetaIdentityCatalog();
    try {
      await catalogRefreshInFlight;
      catalogRefreshCompletedAt = Date.now();
    } finally {
      catalogRefreshInFlight = null;
    }
  }
  resolved = await resolveFromCatalog(sourceId);
  return resolved || resolveGraphAd(sourceId);
}

function parseUtm(sourceUrl: string): Record<string, string> {
  try {
    const params = new URL(sourceUrl).searchParams;
    return Object.fromEntries(
      ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].map((key) => [
        key,
        text(params.get(key)),
      ]),
    );
  } catch {
    return { utm_source: "", utm_medium: "", utm_campaign: "", utm_content: "", utm_term: "" };
  }
}

function campaignLabel(name: string, id: string): string {
  if (!id) return "";
  const safe =
    text(name, 56)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "campaign";
  return `campaign:${safe}-${id.slice(-6)}`;
}

async function syncCanonicalToChatwoot(
  conversationId: number,
  row: Record<string, string>,
): Promise<void> {
  const mode = text(process.env.META_ATTRIBUTION_CHATWOOT_SYNC_MODE).toLowerCase();
  if (!["attributes", "labels", "both"].includes(mode)) return;
  const canary = Number(process.env.META_ATTRIBUTION_CANARY_CONVERSATION_ID || 0);
  const allowAll = text(process.env.META_ATTRIBUTION_SYNC_ALLOW_ALL).toLowerCase() === "true";
  if (!allowAll && (!canary || canary !== conversationId)) return;
  if (mode === "attributes" || mode === "both") {
    const wanted = buildChatwootAttributionAttributes({
      channel: row.channel,
      branch: row.branch_name || row.branch_id,
      attributionMethod: row.attribution_method,
      confidence: row.confidence,
      unknownReason: row.unknown_reason,
      source: row.platform,
      medium: row.medium,
      campaignName: row.campaign_name,
      campaignId: row.campaign_id,
      adsetId: row.adset_id,
      adsetName: row.adset_name,
      adId: row.ad_id,
      adName: row.ad_name,
      creativeId: row.creative_id,
      creativeName: row.creative_name,
      marketer: configuredMarketer(row.campaign_id),
      customerType: configuredCustomerType(row.inbox_id),
      ctwaClid: row.ctwa_clid,
      utmSource: row.utm_source,
      utmMedium: row.utm_medium,
      utmCampaign: row.utm_campaign,
      utmContent: row.utm_content,
      utmTerm: row.utm_term,
    });
    await updateChatwootConversationAttributes(
      conversationId,
      (latest) => planChatwootAttributionUpdate(latest, wanted, "live"),
      { ownedKeys: CHATWOOT_ATTRIBUTION_KEYS },
    );
  }
  if (mode === "labels" || mode === "both") {
    const clean = (value: string) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
    const wanted = [
      row.platform ? `src:${clean(row.platform)}` : "",
      row.channel ? `channel:${clean(row.channel)}` : "",
      campaignLabel(row.campaign_name, row.campaign_id),
      row.branch_id ? `branch:${clean(row.branch_name || row.branch_id)}` : "",
    ].filter(Boolean);
    const current = await getChatwootConversationLabels(conversationId);
    const merged = [
      ...current.filter(
        (label) => !MANAGED_LABEL_PREFIXES.some((prefix) => label.startsWith(prefix)),
      ),
      ...wanted,
    ];
    const unique = [...new Set(merged)];
    const same =
      current.length === unique.length && current.every((label) => unique.includes(label));
    if (!same) await replaceChatwootConversationLabels(conversationId, unique);
  }
}

async function projectConversation(conversationId: number): Promise<Record<string, string> | null> {
  const db = getPool();
  const acquisition = await db.query<Record<string, string>>(
    `SELECT * FROM chatwoot_attribution_touches WHERE conversation_id=$1
     ORDER BY occurred_at ASC,
       CASE attribution_method
         WHEN 'meta_whatsapp_referral' THEN 0 WHEN 'meta_messenger_referral' THEN 0
         WHEN 'meta_instagram_referral' THEN 0 WHEN 'signed_tracking_token' THEN 1
         WHEN 'utm' THEN 1 WHEN 'referrer' THEN 2 WHEN 'inbox_only' THEN 3 ELSE 4 END,
       id DESC LIMIT 1`,
    [conversationId],
  );
  const latest = await db.query<Record<string, string>>(
    `SELECT id,occurred_at FROM chatwoot_attribution_touches WHERE conversation_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 1`,
    [conversationId],
  );
  const x = acquisition.rows[0],
    last = latest.rows[0];
  if (!x || !last) return null;
  const updated = await db.query<Record<string, string>>(
    `UPDATE chatwoot_conversation_attribution SET
      first_touch_id=$2,latest_touch_id=$3,first_touch_at=$4,latest_touch_at=$5,
      chatwoot_message_id=$6,provider_message_id=$7,destination_phone_number_id=$8,destination_page_id=$9,
      channel=COALESCE(NULLIF($10,''),channel),platform=$11,source=$12,medium=$13,campaign_id=$14,campaign_name=$15,
      adset_id=$16,adset_name=$17,ad_id=$18,ad_name=$19,creative_id=$20,creative_name=$21,
      placement=$22,utm_source=$23,utm_medium=$24,utm_campaign=$25,utm_content=$26,utm_term=$27,
      referral_source_id=$28,ctwa_clid=$29,attribution_method=$30,confidence=$31,
      attribution_scope=$32,
      unknown_reason=CASE WHEN $30='unknown' AND $33='' THEN unknown_reason ELSE $33 END,updated_at=now()
     WHERE conversation_id=$1 RETURNING *`,
    [
      conversationId,
      x.id,
      last.id,
      x.occurred_at,
      last.occurred_at,
      x.message_id,
      x.provider_message_id,
      x.destination_phone_number_id,
      x.destination_page_id,
      x.channel,
      x.platform,
      x.source,
      x.medium,
      x.campaign_id,
      x.campaign_name,
      x.adset_id,
      x.adset_name,
      x.ad_id,
      x.ad_name,
      x.creative_id,
      x.creative_name,
      x.placement,
      x.utm_source,
      x.utm_medium,
      x.utm_campaign,
      x.utm_content,
      x.utm_term,
      x.referral_source_id,
      x.ctwa_clid,
      x.attribution_method,
      x.confidence,
      x.attribution_scope,
      x.unknown_reason,
    ],
  );
  // Sync from the stored conversation, which also carries channel and branch facts.
  return updated.rows[0] ?? x;
}

async function processEvent(event: Record<string, string>): Promise<boolean> {
  const db = getPool();
  const chatwoot = await db.query<Record<string, string>>(
    `SELECT id,conversation_id,message_id,inbox_id,occurred_at FROM chatwoot_event_inbox
     WHERE provider_message_id=$1 AND event_type='message_created' AND conversation_id IS NOT NULL
     ORDER BY occurred_at ASC LIMIT 1`,
    [event.provider_message_id],
  );
  const match = chatwoot.rows[0];
  if (!match) {
    const terminal = Number(event.attempts) >= MAX_PROCESS_ATTEMPTS;
    await db.query(
      `UPDATE meta_message_attribution_events SET status=$2,unknown_reason='provider_message_unmatched',next_attempt_at=now()+LEAST(3600,power(2,attempts)*15)*interval '1 second',last_error='' WHERE id=$1`,
      [event.id, terminal ? "unresolved" : "waiting_for_chatwoot_message"],
    );
    return false;
  }
  const resolution = event.referral_source_id
    ? await resolveMetaSourceId(event.referral_source_id)
    : null;
  const utm = parseUtm(event.source_url);
  const method = event.attribution_method;
  const unknownReason =
    event.referral_source_id && !resolution ? "meta_source_id_unresolved" : event.unknown_reason;
  const values = { ...blankResolution(), ...(resolution || {}), ...utm };
  const evidenceHash = hash(
    JSON.stringify({
      provider: event.provider,
      provider_message_id: event.provider_message_id,
      referral_source_id: event.referral_source_id,
      ctwa_clid: event.ctwa_clid,
      method,
      resolution: resolution ? { matchedAs: resolution.matchedAs, adId: resolution.adId } : null,
    }),
  );
  const reducedEvidence = jsonObject(event.reduced_evidence_json);
  const canonicalEvidence = JSON.stringify({
    ...reducedEvidence,
    resolution: resolution
      ? {
          matched_as: resolution.matchedAs,
          account_id: resolution.accountId,
          campaign_id: resolution.campaignId,
          adset_id: resolution.adsetId,
          ad_id: resolution.adId,
          creative_id: resolution.creativeId,
        }
      : null,
  });
  const updated = await db.query(
    `UPDATE chatwoot_attribution_touches SET provider_message_id=$3,destination_phone_number_id=$4,
      destination_page_id=$5,channel=$6,platform=$7,source=$7,medium=$8,utm_source=$9,
      utm_medium=$10,utm_campaign=$11,utm_content=$12,utm_term=$13,campaign_id=$14,
      campaign_name=$15,adset_id=$16,adset_name=$17,ad_id=$18,ad_name=$19,
      creative_id=$20,creative_name=$21,placement=$22,ctwa_clid=$23,referral_source_id=$24,
      referral_source_type=$25,referral_source_url=$26,attribution_method=$27,confidence=$28,
      attribution_scope='conversation',unknown_reason=$29,evidence_hash=$30,evidence=$31::jsonb
     WHERE conversation_id=$1 AND message_id=$2
       AND (attribution_method IN ('unknown','inbox_mapping','inbox_only') OR provider_message_id=$3)`,
    [
      match.conversation_id,
      match.message_id,
      event.provider_message_id,
      event.destination_phone_number_id,
      event.destination_page_id,
      event.channel,
      event.source_platform,
      event.referral_source_id ? "paid_social" : "organic_or_direct",
      utm.utm_source,
      utm.utm_medium,
      utm.utm_campaign,
      utm.utm_content,
      utm.utm_term,
      values.campaignId,
      values.campaignName,
      values.adsetId,
      values.adsetName,
      values.adId,
      values.adName,
      values.creativeId,
      values.creativeName,
      values.placement,
      event.ctwa_clid,
      event.referral_source_id,
      event.source_type,
      event.source_url,
      method,
      event.attribution_confidence,
      unknownReason,
      evidenceHash,
      canonicalEvidence,
    ],
  );
  if (!updated.rowCount) {
    await db.query(
      `INSERT INTO chatwoot_attribution_touches (conversation_id,inbox_id,message_id,provider_message_id,destination_phone_number_id,destination_page_id,event_id,channel,platform,source,medium,utm_source,utm_medium,utm_campaign,utm_content,utm_term,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,creative_id,creative_name,placement,ctwa_clid,referral_source_id,referral_source_type,referral_source_url,attribution_method,confidence,attribution_scope,unknown_reason,evidence_hash,evidence,occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,'conversation',$31,$32,$33::jsonb,$34)
       ON CONFLICT (conversation_id,message_id,evidence_hash) DO NOTHING`,
      [
        match.conversation_id,
        match.inbox_id,
        match.message_id,
        event.provider_message_id,
        event.destination_phone_number_id,
        event.destination_page_id,
        match.id,
        event.channel,
        event.source_platform,
        event.referral_source_id ? "paid_social" : "organic_or_direct",
        utm.utm_source,
        utm.utm_medium,
        utm.utm_campaign,
        utm.utm_content,
        utm.utm_term,
        values.campaignId,
        values.campaignName,
        values.adsetId,
        values.adsetName,
        values.adId,
        values.adName,
        values.creativeId,
        values.creativeName,
        values.placement,
        event.ctwa_clid,
        event.referral_source_id,
        event.source_type,
        event.source_url,
        method,
        event.attribution_confidence,
        unknownReason,
        evidenceHash,
        canonicalEvidence,
        event.occurred_at,
      ],
    );
  }
  const projected = await projectConversation(Number(match.conversation_id));
  const waitingForIdentity =
    Boolean(event.referral_source_id && !resolution) &&
    Number(event.attempts) < MAX_PROCESS_ATTEMPTS;
  await db.query(
    `UPDATE meta_message_attribution_events SET status=$2,
       processed_at=CASE WHEN $2 IN ('resolved','unresolved') THEN now() ELSE NULL END,
       next_attempt_at=CASE WHEN $2='waiting_for_meta_identity'
         THEN now()+LEAST(3600,power(2,attempts)*15)*interval '1 second' ELSE now() END,
       unknown_reason=$3,last_error='' WHERE id=$1`,
    [
      event.id,
      waitingForIdentity
        ? "waiting_for_meta_identity"
        : event.referral_source_id && !resolution
          ? "unresolved"
          : "resolved",
      unknownReason,
    ],
  );
  if (projected) await syncCanonicalToChatwoot(Number(match.conversation_id), projected);
  return true;
}

export async function processMetaAttributionForProviderMessage(
  providerMessageId: string,
): Promise<{ processed: number }> {
  if (!providerMessageId || !databaseConfigured()) return { processed: 0 };
  await ensureSchema();
  const result = await getPool().query<Record<string, string>>(
    `UPDATE meta_message_attribution_events SET status='processing',attempts=attempts+1
     WHERE provider_message_id=$1 AND status IN ('received','waiting_for_chatwoot_message','waiting_for_meta_identity','failed')
     RETURNING *`,
    [providerMessageId],
  );
  let processed = 0;
  for (const event of result.rows) if (await processEvent(event)) processed += 1;
  return { processed };
}

export async function processPendingMetaAttributionEvents(
  limit = 50,
): Promise<{ claimed: number; processed: number }> {
  if (!databaseConfigured()) return { claimed: 0, processed: 0 };
  await ensureSchema();
  const result = await getPool().query<Record<string, string>>(
    `UPDATE meta_message_attribution_events SET status='processing',attempts=attempts+1
     WHERE id IN (SELECT id FROM meta_message_attribution_events WHERE status IN ('received','waiting_for_chatwoot_message','waiting_for_meta_identity','failed') AND next_attempt_at<=now() ORDER BY received_at LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING *`,
    [Math.max(1, Math.min(200, Math.trunc(limit)))],
  );
  let processed = 0;
  for (const event of result.rows) {
    try {
      if (await processEvent(event)) processed += 1;
    } catch (error) {
      await getPool().query(
        `UPDATE meta_message_attribution_events SET status='failed',last_error=$2,next_attempt_at=now()+interval '5 minutes' WHERE id=$1`,
        [event.id, error instanceof Error ? error.message.slice(0, 500) : "processing failed"],
      );
    }
  }
  return { claimed: result.rows.length, processed };
}

export function startMetaAttributionWorker(): { enabled: boolean; started: boolean } {
  const enabled = text(process.env.META_ATTRIBUTION_WORKER_ENABLED).toLowerCase() === "true";
  if (!enabled || workerStarted) return { enabled, started: workerStarted };
  const run = () => {
    void processPendingMetaAttributionEvents().catch((error) =>
      console.error("[meta-attribution] retry worker failed", {
        message: error instanceof Error ? error.message.slice(0, 240) : "processing failed",
      }),
    );
  };
  workerTimer = setInterval(run, 30_000);
  workerTimer.unref?.();
  setTimeout(run, 5_000).unref?.();
  workerStarted = true;
  return { enabled, started: true };
}

export function stopMetaAttributionWorker() {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
  workerStarted = false;
}

export async function getMetaAttributionHealth() {
  if (!databaseConfigured()) return { configured: false };
  await ensureSchema();
  const [events, catalog] = await Promise.all([
    getPool().query(
      `SELECT count(*)::int received,count(*) FILTER (WHERE status='resolved')::int resolved,count(*) FILTER (WHERE status='unresolved')::int unresolved,count(*) FILTER (WHERE status LIKE 'waiting_%')::int waiting,count(*) FILTER (WHERE status='failed')::int failed,coalesce(sum(duplicate_deliveries),0)::int duplicate_deliveries,max(received_at) last_received_at FROM meta_message_attribution_events WHERE status <> 'self_test'`,
    ),
    getPool().query(
      `SELECT count(*)::int rows,count(*) FILTER (WHERE campaign_id<>'')::int campaigns,count(*) FILTER (WHERE creative_id<>'')::int creatives,count(*) FILTER (WHERE effective_object_story_id<>'')::int story_ids,count(*) FILTER (WHERE source_post_id<>'')::int post_ids FROM meta_entity_identity_catalog`,
    ),
  ]);
  return {
    configured: true,
    listenerConfigured: Boolean(
      process.env.META_ATTRIBUTION_APP_ID?.trim() &&
      process.env.META_ATTRIBUTION_APP_SECRET?.trim() &&
      process.env.META_ATTRIBUTION_VERIFY_TOKEN?.trim(),
    ),
    events: events.rows[0],
    catalog: catalog.rows[0],
    chatwootSyncMode: text(process.env.META_ATTRIBUTION_CHATWOOT_SYNC_MODE) || "off",
    workerEnabled: text(process.env.META_ATTRIBUTION_WORKER_ENABLED).toLowerCase() === "true",
    canaryConfigured: Boolean(process.env.META_ATTRIBUTION_CANARY_CONVERSATION_ID?.trim()),
    syncAllowAll: text(process.env.META_ATTRIBUTION_SYNC_ALLOW_ALL).toLowerCase() === "true",
  };
}
