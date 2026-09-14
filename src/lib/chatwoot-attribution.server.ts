import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Pool } from "pg";
import {
  getChatwootConversationLabels,
  replaceChatwootConversationLabels,
  updateChatwootConversationAttributes,
  chatwootPhoneKey,
} from "./chatwoot.server";
import {
  CHATWOOT_ATTRIBUTION_KEYS,
  REFERRAL_EVIDENCE_MISSING,
  buildChatwootAttributionAttributes,
  planChatwootAttributionUpdate,
} from "./chatwoot-attribution-attributes";
import {
  databaseConfigured,
  readDashboardDatasets,
  type DashboardRow,
} from "./dashboard-db.server";

export type AttributionMethod =
  | "meta_referral"
  | "meta_whatsapp_referral"
  | "meta_messenger_referral"
  | "meta_instagram_referral"
  | "signed_tracking_token"
  | "utm"
  | "referrer"
  | "inbox_only"
  | "inbox_mapping"
  | "manual"
  | "unknown";

export type AttributionConfidence = "exact" | "strong" | "inferred" | "unknown";

export interface NormalizedAttribution {
  eventType: string;
  conversationId: number | null;
  messageId: number | null;
  providerMessageId: string;
  contactId: number | null;
  inboxId: number | null;
  agentId: number | null;
  occurredAt: string;
  phoneKey: string;
  channel: string;
  platform: string;
  source: string;
  medium: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  utmTerm: string;
  campaignId: string;
  campaignName: string;
  adsetId: string;
  adsetName: string;
  adId: string;
  adName: string;
  creativeId: string;
  ctwaClid: string;
  referralSourceId: string;
  referralSourceType: string;
  referralSourceUrl: string;
  referralHeadline: string;
  branchId: string;
  branchName: string;
  trackingToken: string;
  attributionMethod: AttributionMethod;
  confidence: AttributionConfidence;
  evidence: Record<string, unknown>;
  inbound: boolean;
}

interface AttributionTokenEvidence {
  source?: string;
  medium?: string;
  platform?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  referrer?: string;
  branchId?: string;
  branchName?: string;
}

interface BranchMatch {
  id: string;
  name: string;
}

interface MetaEntity {
  campaignId: string;
  campaignName: string;
  adsetId: string;
  adsetName: string;
  adId: string;
  adName: string;
  creativeId: string;
}

interface CrmMatch {
  ids: string[];
  status: string;
  won: boolean;
  lost: boolean;
  revenue: number | null;
}

const MAX_EVIDENCE_TEXT = 1_000;
const DEFAULT_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
// The legacy Chatwoot webhook owns only these labels. The Meta sidecar owns
// channel:/campaign: labels, so preserving them here prevents the two writers
// from deleting each other's state when both integrations are enabled.
const MANAGED_LABEL_PREFIXES = ["src:", "medium:", "branch:"];

/** Verifies Chatwoot's current per-webhook signature over the unparsed body. */
export function verifyChatwootWebhookSignature(input: {
  rawBody: string;
  timestamp: string;
  signature: string;
  secret: string;
  now?: number;
  maxAgeSeconds?: number;
}): boolean {
  const timestamp = Number(input.timestamp);
  const maxAge = Math.max(1, Math.min(3_600, input.maxAgeSeconds ?? 300));
  if (!Number.isFinite(timestamp) || timestamp <= 0 || !input.secret || !input.signature)
    return false;
  if (Math.abs((input.now ?? Date.now()) / 1_000 - timestamp) > maxAge) return false;
  const expected = `sha256=${createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.rawBody}`)
    .digest("hex")}`;
  const received = Buffer.from(input.signature);
  const calculated = Buffer.from(expected);
  return received.length === calculated.length && timingSafeEqual(received, calculated);
}

let pool: Pool | null = null;
let schemaPromise: Promise<void> | null = null;
let importedDataCache: {
  expiresAt: number;
  rows: {
    metaAds: DashboardRow[];
    metaCreatives: DashboardRow[];
    crm: DashboardRow[];
    accounting: DashboardRow[];
    invoiced: DashboardRow[];
  };
} | null = null;

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
        CREATE TABLE IF NOT EXISTS chatwoot_event_inbox (
          id bigserial PRIMARY KEY,
          event_key text NOT NULL UNIQUE,
          dedupe_key text NOT NULL UNIQUE,
          delivery_id text,
          event_type text NOT NULL,
          conversation_id bigint,
          message_id bigint,
          provider_message_id text,
          contact_id bigint,
          inbox_id bigint,
          occurred_at timestamptz NOT NULL,
          received_at timestamptz NOT NULL DEFAULT now(),
          payload_hash text NOT NULL,
          evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
          status text NOT NULL DEFAULT 'pending',
          attempts integer NOT NULL DEFAULT 0,
          duplicate_deliveries integer NOT NULL DEFAULT 0,
          locked_at timestamptz,
          processed_at timestamptz,
          last_error text NOT NULL DEFAULT ''
        );
        ALTER TABLE chatwoot_event_inbox ADD COLUMN IF NOT EXISTS locked_at timestamptz;
        ALTER TABLE chatwoot_event_inbox ADD COLUMN IF NOT EXISTS provider_message_id text;
        ALTER TABLE chatwoot_event_inbox
          ADD COLUMN IF NOT EXISTS duplicate_deliveries integer NOT NULL DEFAULT 0;
        CREATE INDEX IF NOT EXISTS chatwoot_event_inbox_status_received_idx
          ON chatwoot_event_inbox (status, received_at DESC);
        CREATE INDEX IF NOT EXISTS chatwoot_event_inbox_conversation_idx
          ON chatwoot_event_inbox (conversation_id, occurred_at DESC);
        CREATE INDEX IF NOT EXISTS chatwoot_event_inbox_provider_message_idx
          ON chatwoot_event_inbox (provider_message_id) WHERE provider_message_id IS NOT NULL;

        CREATE TABLE IF NOT EXISTS chatwoot_attribution_touches (
          id bigserial PRIMARY KEY,
          conversation_id bigint NOT NULL,
          contact_id bigint,
          inbox_id bigint,
          message_id bigint,
          provider_message_id text NOT NULL DEFAULT '',
          destination_phone_number_id text NOT NULL DEFAULT '',
          destination_page_id text NOT NULL DEFAULT '',
          event_id bigint REFERENCES chatwoot_event_inbox(id) ON DELETE SET NULL,
          phone_key text NOT NULL DEFAULT '',
          channel text NOT NULL DEFAULT '',
          platform text NOT NULL DEFAULT '',
          source text NOT NULL DEFAULT '',
          medium text NOT NULL DEFAULT '',
          utm_source text NOT NULL DEFAULT '',
          utm_medium text NOT NULL DEFAULT '',
          utm_campaign text NOT NULL DEFAULT '',
          utm_content text NOT NULL DEFAULT '',
          utm_term text NOT NULL DEFAULT '',
          campaign_id text NOT NULL DEFAULT '',
          campaign_name text NOT NULL DEFAULT '',
          adset_id text NOT NULL DEFAULT '',
          adset_name text NOT NULL DEFAULT '',
          ad_id text NOT NULL DEFAULT '',
          ad_name text NOT NULL DEFAULT '',
          creative_id text NOT NULL DEFAULT '',
          ctwa_clid text NOT NULL DEFAULT '',
          referral_source_id text NOT NULL DEFAULT '',
          referral_source_type text NOT NULL DEFAULT '',
          referral_source_url text NOT NULL DEFAULT '',
          referral_headline text NOT NULL DEFAULT '',
          branch_id text NOT NULL DEFAULT '',
          branch_name text NOT NULL DEFAULT '',
          attribution_method text NOT NULL,
          confidence text NOT NULL,
          evidence_hash text NOT NULL,
          evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
          occurred_at timestamptz NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (conversation_id, message_id, evidence_hash)
        );
        CREATE INDEX IF NOT EXISTS chatwoot_attribution_touches_occurred_idx
          ON chatwoot_attribution_touches (occurred_at DESC);
        CREATE INDEX IF NOT EXISTS chatwoot_attribution_touches_campaign_idx
          ON chatwoot_attribution_touches (campaign_id, adset_id, ad_id);
        CREATE INDEX IF NOT EXISTS chatwoot_attribution_touches_contact_idx
          ON chatwoot_attribution_touches (contact_id, phone_key);
        ALTER TABLE chatwoot_attribution_touches
          ADD COLUMN IF NOT EXISTS provider_message_id text NOT NULL DEFAULT '';
        ALTER TABLE chatwoot_attribution_touches
          ADD COLUMN IF NOT EXISTS destination_phone_number_id text NOT NULL DEFAULT '';
        ALTER TABLE chatwoot_attribution_touches
          ADD COLUMN IF NOT EXISTS destination_page_id text NOT NULL DEFAULT '';
        ALTER TABLE chatwoot_attribution_touches
          ADD COLUMN IF NOT EXISTS creative_name text NOT NULL DEFAULT '';
        ALTER TABLE chatwoot_attribution_touches
          ADD COLUMN IF NOT EXISTS placement text NOT NULL DEFAULT '';
        ALTER TABLE chatwoot_attribution_touches
          ADD COLUMN IF NOT EXISTS attribution_scope text NOT NULL DEFAULT 'conversation';
        ALTER TABLE chatwoot_attribution_touches
          ADD COLUMN IF NOT EXISTS unknown_reason text NOT NULL DEFAULT '';

        CREATE TABLE IF NOT EXISTS chatwoot_conversation_attribution (
          conversation_id bigint PRIMARY KEY,
          contact_id bigint,
          inbox_id bigint,
          agent_id bigint,
          phone_key text NOT NULL DEFAULT '',
          first_touch_id bigint REFERENCES chatwoot_attribution_touches(id) ON DELETE SET NULL,
          latest_touch_id bigint REFERENCES chatwoot_attribution_touches(id) ON DELETE SET NULL,
          first_touch_at timestamptz,
          latest_touch_at timestamptz,
          chatwoot_message_id bigint,
          provider_message_id text NOT NULL DEFAULT '',
          destination_phone_number_id text NOT NULL DEFAULT '',
          destination_page_id text NOT NULL DEFAULT '',
          channel text NOT NULL DEFAULT '',
          platform text NOT NULL DEFAULT '',
          source text NOT NULL DEFAULT '',
          medium text NOT NULL DEFAULT '',
          campaign_id text NOT NULL DEFAULT '',
          campaign_name text NOT NULL DEFAULT '',
          adset_id text NOT NULL DEFAULT '',
          adset_name text NOT NULL DEFAULT '',
          ad_id text NOT NULL DEFAULT '',
          ad_name text NOT NULL DEFAULT '',
          creative_id text NOT NULL DEFAULT '',
          creative_name text NOT NULL DEFAULT '',
          placement text NOT NULL DEFAULT '',
          utm_source text NOT NULL DEFAULT '',
          utm_medium text NOT NULL DEFAULT '',
          utm_campaign text NOT NULL DEFAULT '',
          utm_content text NOT NULL DEFAULT '',
          utm_term text NOT NULL DEFAULT '',
          referral_source_id text NOT NULL DEFAULT '',
          ctwa_clid text NOT NULL DEFAULT '',
          attribution_scope text NOT NULL DEFAULT 'conversation',
          unknown_reason text NOT NULL DEFAULT '',
          branch_id text NOT NULL DEFAULT '',
          branch_name text NOT NULL DEFAULT '',
          attribution_method text NOT NULL DEFAULT 'unknown',
          confidence text NOT NULL DEFAULT 'unknown',
          crm_lead_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
          crm_status text NOT NULL DEFAULT '',
          crm_won boolean NOT NULL DEFAULT false,
          crm_lost boolean NOT NULL DEFAULT false,
          revenue numeric,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS chatwoot_conversation_attribution_latest_idx
          ON chatwoot_conversation_attribution (latest_touch_at DESC);
        CREATE INDEX IF NOT EXISTS chatwoot_conversation_attribution_filters_idx
          ON chatwoot_conversation_attribution (platform, source, medium, branch_id);
        ALTER TABLE chatwoot_conversation_attribution
          ADD COLUMN IF NOT EXISTS creative_id text NOT NULL DEFAULT '';
        ALTER TABLE chatwoot_conversation_attribution
          ADD COLUMN IF NOT EXISTS creative_name text NOT NULL DEFAULT '';
        ALTER TABLE chatwoot_conversation_attribution
          ADD COLUMN IF NOT EXISTS placement text NOT NULL DEFAULT '';
        ALTER TABLE chatwoot_conversation_attribution
          ADD COLUMN IF NOT EXISTS utm_source text NOT NULL DEFAULT '';
        ALTER TABLE chatwoot_conversation_attribution
          ADD COLUMN IF NOT EXISTS utm_medium text NOT NULL DEFAULT '';
        ALTER TABLE chatwoot_conversation_attribution
          ADD COLUMN IF NOT EXISTS utm_campaign text NOT NULL DEFAULT '';
        ALTER TABLE chatwoot_conversation_attribution
          ADD COLUMN IF NOT EXISTS utm_content text NOT NULL DEFAULT '';
        ALTER TABLE chatwoot_conversation_attribution
          ADD COLUMN IF NOT EXISTS utm_term text NOT NULL DEFAULT '';
        ALTER TABLE chatwoot_conversation_attribution
          ADD COLUMN IF NOT EXISTS unknown_reason text NOT NULL DEFAULT '';
        ALTER TABLE chatwoot_conversation_attribution
          ADD COLUMN IF NOT EXISTS chatwoot_message_id bigint;
        ALTER TABLE chatwoot_conversation_attribution
          ADD COLUMN IF NOT EXISTS provider_message_id text NOT NULL DEFAULT '';
        ALTER TABLE chatwoot_conversation_attribution
          ADD COLUMN IF NOT EXISTS destination_phone_number_id text NOT NULL DEFAULT '';
        ALTER TABLE chatwoot_conversation_attribution
          ADD COLUMN IF NOT EXISTS destination_page_id text NOT NULL DEFAULT '';
        ALTER TABLE chatwoot_conversation_attribution
          ADD COLUMN IF NOT EXISTS referral_source_id text NOT NULL DEFAULT '';
        ALTER TABLE chatwoot_conversation_attribution
          ADD COLUMN IF NOT EXISTS ctwa_clid text NOT NULL DEFAULT '';
        ALTER TABLE chatwoot_conversation_attribution
          ADD COLUMN IF NOT EXISTS attribution_scope text NOT NULL DEFAULT 'conversation';

        CREATE TABLE IF NOT EXISTS chatwoot_attribution_tokens (
          token text PRIMARY KEY,
          evidence jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          expires_at timestamptz NOT NULL,
          consumed_at timestamptz,
          consumed_conversation_id bigint
        );
        CREATE INDEX IF NOT EXISTS chatwoot_attribution_tokens_expiry_idx
          ON chatwoot_attribution_tokens (expires_at);
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

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function string(value: unknown, max = MAX_EVIDENCE_TEXT): string {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function iso(value: unknown): string {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(numeric < 10_000_000_000 ? numeric * 1_000 : numeric).toISOString();
  }
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function first(row: Record<string, unknown> | null | undefined, keys: string[]): string {
  if (!row) return "";
  for (const key of keys) {
    const value = string(row[key]);
    if (value) return value;
  }
  return "";
}

function embeddedMessage(payload: Record<string, unknown>): Record<string, unknown> {
  return object(payload.message) || payload;
}

function embeddedConversation(payload: Record<string, unknown>): Record<string, unknown> {
  return object(payload.conversation) || payload;
}

function referral(
  payload: Record<string, unknown>,
  message: Record<string, unknown>,
): Record<string, unknown> {
  const contentAttributes = object(message.content_attributes);
  const whatsapp = object(contentAttributes?.whatsapp);
  const additional = object(message.additional_attributes);
  const conversationAdditional = object(embeddedConversation(payload).additional_attributes);
  return (
    object(contentAttributes?.referral) ||
    object(whatsapp?.referral) ||
    object(additional?.referral) ||
    object(payload.referral) ||
    object(conversationAdditional?.referral) ||
    {}
  );
}

function parseUtm(url: string): Record<string, string> {
  if (!url) return {};
  try {
    const params = new URL(url).searchParams;
    return {
      utmSource: string(params.get("utm_source")),
      utmMedium: string(params.get("utm_medium")),
      utmCampaign: string(params.get("utm_campaign")),
      utmContent: string(params.get("utm_content")),
      utmTerm: string(params.get("utm_term")),
    };
  } catch {
    return {};
  }
}

function platformFromUrl(value: string): string {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    if (hostname.includes("instagram")) return "instagram";
    if (hostname.includes("facebook") || hostname.includes("fb.")) return "facebook";
  } catch {
    // The URL is evidence, not an input to routing. Invalid values are retained only in reduced evidence.
  }
  return "";
}

function trackingToken(content: string): string {
  return content.match(/\[ref:([a-zA-Z0-9_.-]{8,128})\]/)?.[1] || "";
}

/** A token has an opaque nonce plus an HMAC, so a guessed marker is never attribution evidence. */
function tokenSignature(nonce: string): string {
  const secret = (process.env.CHATWOOT_ATTRIBUTION_TOKEN_SECRET || "").trim();
  if (!secret || !nonce) return "";
  return createHmac("sha256", secret).update(`chatwoot-attribution:${nonce}`).digest("base64url");
}

export function verifyAttributionTrackingToken(token: string): boolean {
  const [nonce, signature, ...extra] = String(token || "").split(".");
  if (!nonce || !signature || extra.length) return false;
  const expected = tokenSignature(nonce);
  const received = Buffer.from(signature);
  const calculated = Buffer.from(expected);
  return (
    Boolean(expected) &&
    received.length === calculated.length &&
    timingSafeEqual(received, calculated)
  );
}

function eventIsInbound(
  payload: Record<string, unknown>,
  message: Record<string, unknown>,
): boolean {
  const type = string(message.message_type).toLowerCase();
  const sender = string(message.sender_type || object(message.sender)?.type).toLowerCase();
  if (["1", "outgoing", "3", "template"].includes(type) || sender === "user") return false;
  if (["0", "incoming"].includes(type) || sender === "contact") return true;
  return string(payload.event) === "conversation_created";
}

function parseBranchMap(): Record<string, unknown> {
  try {
    const parsed = JSON.parse(process.env.CHATWOOT_ATTRIBUTION_BRANCH_MAP_JSON || "{}");
    return object(parsed) || {};
  } catch {
    return {};
  }
}

function branchFromValue(value: unknown): BranchMatch | null {
  if (typeof value === "string" && value.trim()) return { id: value.trim(), name: value.trim() };
  const row = object(value);
  const id = first(row, ["id", "branchId", "branch_id", "key"]);
  if (!id) return null;
  return { id, name: first(row, ["name", "branchName", "branch_name", "label"]) || id };
}

/** The configured inbox → branch mapping for one inbox, or null when none is configured. */
export function resolveInboxBranch(inboxId: number | null): { id: string; name: string } | null {
  return resolveBranch(inboxId);
}

export function inboxBranchMappingConfigured(): boolean {
  return Object.keys(parseBranchMap()).length > 0;
}

function resolveBranch(
  inboxId: number | null,
  tokenEvidence?: AttributionTokenEvidence,
): BranchMatch | null {
  if (tokenEvidence?.branchId) {
    return {
      id: string(tokenEvidence.branchId),
      name: string(tokenEvidence.branchName) || string(tokenEvidence.branchId),
    };
  }
  const map = parseBranchMap();
  const candidates = [
    object(map.inboxId)?.[String(inboxId || "")],
    object(map.inboxes)?.[String(inboxId || "")],
    object(map.inbox_id)?.[String(inboxId || "")],
  ];
  for (const candidate of candidates) {
    const result = branchFromValue(candidate);
    if (result) return result;
  }
  return null;
}

export function normalizeChatwootAttribution(payload: unknown): NormalizedAttribution {
  const root = object(payload) || {};
  const message = embeddedMessage(root);
  const conversation = embeddedConversation(root);
  const inbox = object(root.inbox) || object(conversation.inbox) || {};
  const contact =
    object(root.contact) || object(root.sender) || object(object(conversation.meta)?.sender) || {};
  const contentAttributes = object(message.content_attributes) || {};
  const customAttributes =
    object(conversation.custom_attributes) || object(root.custom_attributes) || {};
  const messageReferral = referral(root, message);
  const referralSourceUrl = first(messageReferral, ["source_url", "sourceUrl", "url"]);
  const urlUtm = parseUtm(referralSourceUrl);
  const content = string(message.content, 4_000);
  const referralSourceId = first(messageReferral, ["source_id", "sourceId", "id"]);
  const utmSource = first(customAttributes, ["utm_source", "utmSource"]) || urlUtm.utmSource || "";
  const utmMedium = first(customAttributes, ["utm_medium", "utmMedium"]) || urlUtm.utmMedium || "";
  const utmCampaign =
    first(customAttributes, ["utm_campaign", "utmCampaign"]) || urlUtm.utmCampaign || "";
  const utmContent =
    first(customAttributes, ["utm_content", "utmContent"]) || urlUtm.utmContent || "";
  const utmTerm = first(customAttributes, ["utm_term", "utmTerm"]) || urlUtm.utmTerm || "";
  const token = trackingToken(content);
  const platform = platformFromUrl(referralSourceUrl) || first(messageReferral, ["platform"]);
  const eventType = string(root.event) || "unknown";
  const messageType = numberOrNull(message.id) ? message : root;
  const conversationId = numberOrNull(conversation.id || root.conversation_id);
  const messageId = numberOrNull(messageType.id);
  const providerMessageId = first(messageType, ["source_id", "sourceId"]);
  const inboxId = numberOrNull(inbox.id || conversation.inbox_id || root.inbox_id);
  const contactId = numberOrNull(contact.id || conversation.contact_id || root.contact_id);
  const conversationMeta = object(conversation.meta);
  const agentId = numberOrNull(
    conversationMeta?.assignee_id || object(conversationMeta?.assignee)?.id,
  );
  const branch = resolveBranch(inboxId);
  const hasReferral = Boolean(
    referralSourceId || first(messageReferral, ["ctwa_clid", "ctwaClid"]),
  );
  const hasUtm = Boolean(utmSource || utmMedium || utmCampaign || utmContent || utmTerm);
  // A branch mapping is an operational fact about the inbox, not marketing
  // evidence, so it never lifts a conversation out of `unknown`.
  const method: AttributionMethod = hasReferral
    ? "meta_referral"
    : token
      ? "signed_tracking_token"
      : hasUtm
        ? "utm"
        : referralSourceUrl
          ? "referrer"
          : "unknown";
  const confidence: AttributionConfidence = hasReferral
    ? "exact"
    : token || hasUtm
      ? "strong"
      : "unknown";

  return {
    eventType,
    conversationId,
    messageId,
    providerMessageId,
    contactId,
    inboxId,
    agentId,
    occurredAt: iso(message.created_at || conversation.created_at || root.created_at),
    phoneKey: chatwootPhoneKey(
      String(contact.phone_number || object(conversation.contact_inbox)?.source_id || ""),
    ),
    channel:
      first(inbox, ["channel_type", "channelType"]) ||
      first(conversation, ["channel", "channel_type"]),
    platform: platform || (hasReferral ? "meta" : ""),
    source: utmSource || (hasReferral ? platform || "meta" : ""),
    medium: utmMedium || (hasReferral ? "ctwa" : ""),
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    utmTerm,
    campaignId: first(customAttributes, ["campaign_id", "campaignId"]),
    campaignName: first(customAttributes, ["campaign_name", "campaignName"]),
    adsetId: first(customAttributes, ["adset_id", "adsetId", "ad_set_id"]),
    adsetName: first(customAttributes, ["adset_name", "adsetName", "ad_set_name"]),
    adId: first(customAttributes, ["ad_id", "adId"]),
    adName: first(customAttributes, ["ad_name", "adName"]),
    creativeId: first(customAttributes, ["creative_id", "creativeId"]),
    ctwaClid: first(messageReferral, ["ctwa_clid", "ctwaClid", "ctwa_id"]),
    referralSourceId,
    referralSourceType: first(messageReferral, ["source_type", "sourceType"]),
    referralSourceUrl,
    referralHeadline: first(messageReferral, ["headline"]),
    branchId: branch?.id || "",
    branchName: branch?.name || "",
    trackingToken: token,
    attributionMethod: method,
    confidence,
    evidence: {
      referral: hasReferral
        ? {
            source_id: referralSourceId,
            source_type: first(messageReferral, ["source_type", "sourceType"]),
            source_url: referralSourceUrl,
            headline: first(messageReferral, ["headline"]),
            media_type: first(messageReferral, ["media_type", "mediaType"]),
            ctwa_clid: first(messageReferral, ["ctwa_clid", "ctwaClid", "ctwa_id"]),
          }
        : undefined,
      utm: hasUtm ? { utmSource, utmMedium, utmCampaign, utmContent, utmTerm } : undefined,
      trackingTokenHash: token ? hash(token) : undefined,
      inboxId,
    },
    inbound: eventIsInbound(root, message),
  };
}

function scalar(row: DashboardRow, keys: string[]): string {
  for (const key of keys) {
    const value = string(row[key]);
    if (value) return value;
  }
  return "";
}

async function importedRows() {
  if (importedDataCache && importedDataCache.expiresAt > Date.now()) return importedDataCache.rows;
  const [metaAds, metaCreatives, crm, accounting, invoiced] = await readDashboardDatasets([
    "meta_ads",
    "meta_ad_creatives",
    "crm",
    "accounting",
    "invoiced",
  ]);
  const rows = {
    metaAds: metaAds.rows,
    metaCreatives: metaCreatives.rows,
    crm: crm.rows,
    accounting: accounting.rows,
    invoiced: invoiced.rows,
  };
  importedDataCache = { expiresAt: Date.now() + 5 * 60_000, rows };
  return rows;
}

function entityFromMetaRow(row: DashboardRow): MetaEntity {
  return {
    campaignId: scalar(row, ["__campaign_id", "Campaign ID", "campaignId", "campaign_id"]),
    campaignName: scalar(row, ["Campaign Name", "campaignName", "campaign_name"]),
    adsetId: scalar(row, ["__adset_id", "Ad Set ID", "adsetId", "adset_id"]),
    adsetName: scalar(row, ["Ad Set Name", "adsetName", "adset_name"]),
    adId: scalar(row, ["__ad_id", "Ad ID", "adId", "ad_id"]),
    adName: scalar(row, ["Ad Name", "adName", "ad_name"]),
    creativeId: scalar(row, ["__creative_id", "Creative ID", "creativeId", "creative_id"]),
  };
}

async function enrichMeta(candidate: NormalizedAttribution): Promise<MetaEntity> {
  const blank: MetaEntity = {
    campaignId: candidate.campaignId,
    campaignName: candidate.campaignName,
    adsetId: candidate.adsetId,
    adsetName: candidate.adsetName,
    adId: candidate.adId,
    adName: candidate.adName,
    creativeId: candidate.creativeId,
  };
  const sourceId = candidate.referralSourceId;
  if (!sourceId) return blank;
  const rows = await importedRows();
  const exactAd = rows.metaAds.find((row) =>
    ["__ad_id", "Ad ID", "adId", "ad_id"].some((key) => scalar(row, [key]) === sourceId),
  );
  if (exactAd)
    return {
      ...blank,
      ...entityFromMetaRow(exactAd),
      adId: scalar(exactAd, ["__ad_id", "Ad ID", "adId", "ad_id"]),
    };

  const creative = rows.metaCreatives.find((row) =>
    [
      "postId",
      "Post ID",
      "post_id",
      "source_id",
      "sourceId",
      "creativeId",
      "Creative ID",
      "__creative_id",
    ].some((key) => scalar(row, [key]) === sourceId),
  );
  if (!creative) return blank;
  const creativeAdId = scalar(creative, ["adId", "Ad ID", "__ad_id"]);
  const ad = rows.metaAds.find(
    (row) => scalar(row, ["__ad_id", "Ad ID", "adId", "ad_id"]) === creativeAdId,
  );
  return {
    ...blank,
    ...(ad ? entityFromMetaRow(ad) : {}),
    adId: creativeAdId || blank.adId,
    creativeId:
      scalar(creative, ["creativeId", "Creative ID", "__creative_id"]) || blank.creativeId,
  };
}

async function resolveTrackingToken(token: string): Promise<AttributionTokenEvidence | null> {
  if (!token || !verifyAttributionTrackingToken(token) || !databaseConfigured()) return null;
  await ensureSchema();
  const result = await getPool().query<{ evidence: AttributionTokenEvidence }>(
    `SELECT evidence FROM chatwoot_attribution_tokens WHERE token = $1 AND expires_at > now()`,
    [token],
  );
  return result.rows[0]?.evidence || null;
}

/** Remove an invalid/expired tracking marker before recording a touch. */
function withoutInvalidTrackingToken(candidate: NormalizedAttribution): NormalizedAttribution {
  const hasUtm = Boolean(
    candidate.utmSource ||
    candidate.utmMedium ||
    candidate.utmCampaign ||
    candidate.utmContent ||
    candidate.utmTerm,
  );
  const hasNativeReferral = Boolean(candidate.referralSourceId || candidate.ctwaClid);
  const method: AttributionMethod = hasNativeReferral
    ? "meta_referral"
    : hasUtm
      ? "utm"
      : candidate.referralSourceUrl
        ? "referrer"
        : "unknown";
  const confidence: AttributionConfidence = hasNativeReferral
    ? "exact"
    : hasUtm
      ? "strong"
      : "unknown";
  const { trackingTokenHash: _trackingTokenHash, ...evidence } = candidate.evidence;
  return {
    ...candidate,
    trackingToken: "",
    attributionMethod: method,
    confidence,
    evidence,
  };
}

async function crmMatch(phoneKey: string): Promise<CrmMatch> {
  const empty: CrmMatch = { ids: [], status: "", won: false, lost: false, revenue: null };
  if (!phoneKey) return empty;
  const rows = await importedRows();
  const crm = rows.crm.filter((row) =>
    ["Phone", "رقم الهاتف", "Mobile", "الهاتف المحمول"].some(
      (key) => chatwootPhoneKey(row[key] || "") === phoneKey,
    ),
  );
  if (!crm.length) return empty;
  const statuses = crm
    .map((row) => scalar(row, ["Cleaned Stage", "Stage", "المرحلة"]))
    .filter(Boolean);
  const ids = crm.map((row) => scalar(row, ["__odoo_id", "id", "ID"])).filter(Boolean);
  const normalizedStatuses = statuses.map((value) => value.toLowerCase());
  const revenueRows = [...rows.accounting, ...rows.invoiced].filter((row) =>
    ["Phone", "رقم الهاتف", "Mobile", "الهاتف المحمول", "External Phone"].some(
      (key) => chatwootPhoneKey(row[key] || "") === phoneKey,
    ),
  );
  const revenue = revenueRows.reduce((sum, row) => {
    const value = Number(scalar(row, ["$ Sales", "USD Paid", "usdPaid", "USD Sales"]));
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
  return {
    ids: [...new Set(ids)],
    status: statuses[0] || "",
    won: normalizedStatuses.some((value) => value.includes("won") || value.includes("ربح")),
    lost: normalizedStatuses.some((value) => value.includes("lost") || value.includes("ضائع")),
    revenue: revenueRows.length ? revenue : null,
  };
}

function evidenceHash(candidate: NormalizedAttribution, entity: MetaEntity): string {
  return hash(
    JSON.stringify({
      method: candidate.attributionMethod,
      referralSourceId: candidate.referralSourceId,
      ctwaClid: candidate.ctwaClid,
      token: candidate.trackingToken ? hash(candidate.trackingToken) : "",
      utm: [
        candidate.utmSource,
        candidate.utmMedium,
        candidate.utmCampaign,
        candidate.utmContent,
        candidate.utmTerm,
      ],
      entity,
      branchId: candidate.branchId,
      messageId: candidate.messageId,
      providerMessageId: candidate.providerMessageId,
    }),
  );
}

function applyToken(
  candidate: NormalizedAttribution,
  token: AttributionTokenEvidence | null,
): NormalizedAttribution {
  if (!token) return candidate;
  const branch = resolveBranch(candidate.inboxId, token);
  const utmSource = candidate.utmSource || string(token.utmSource);
  const utmMedium = candidate.utmMedium || string(token.utmMedium);
  const utmCampaign = candidate.utmCampaign || string(token.utmCampaign);
  const utmContent = candidate.utmContent || string(token.utmContent);
  const utmTerm = candidate.utmTerm || string(token.utmTerm);
  const hasNativeReferral = candidate.attributionMethod === "meta_referral";
  return {
    ...candidate,
    platform: candidate.platform || string(token.platform),
    source: candidate.source || string(token.source) || utmSource,
    medium: candidate.medium || string(token.medium) || utmMedium,
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    utmTerm,
    branchId: candidate.branchId || branch?.id || "",
    branchName: candidate.branchName || branch?.name || "",
    attributionMethod: hasNativeReferral ? candidate.attributionMethod : "signed_tracking_token",
    confidence: hasNativeReferral ? candidate.confidence : "strong",
    evidence: {
      ...candidate.evidence,
      tracking: { source: token.source || "", medium: token.medium || "" },
    },
  };
}

function rowValues(
  candidate: NormalizedAttribution,
  entity: MetaEntity,
  eventId: number,
  evidenceHashValue: string,
) {
  return [
    candidate.conversationId,
    candidate.contactId,
    candidate.inboxId,
    candidate.messageId,
    candidate.providerMessageId,
    eventId,
    candidate.phoneKey,
    candidate.channel,
    candidate.platform,
    candidate.source,
    candidate.medium,
    candidate.utmSource,
    candidate.utmMedium,
    candidate.utmCampaign,
    candidate.utmContent,
    candidate.utmTerm,
    entity.campaignId,
    entity.campaignName,
    entity.adsetId,
    entity.adsetName,
    entity.adId,
    entity.adName,
    entity.creativeId,
    candidate.ctwaClid,
    candidate.referralSourceId,
    candidate.referralSourceType,
    candidate.referralSourceUrl,
    candidate.referralHeadline,
    candidate.branchId,
    candidate.branchName,
    candidate.attributionMethod,
    candidate.confidence,
    evidenceHashValue,
    JSON.stringify(candidate.evidence),
    candidate.occurredAt,
  ];
}

async function upsertConversationProjection(
  conversationId: number,
  candidate: NormalizedAttribution,
  crm: CrmMatch,
) {
  const db = getPool();
  const touches = await db.query<Record<string, unknown>>(
    `SELECT * FROM chatwoot_attribution_touches
      WHERE conversation_id = $1
      ORDER BY occurred_at ASC, id ASC`,
    [conversationId],
  );
  const firstTouch = touches.rows[0];
  const latestTouch = touches.rows.at(-1);
  if (!firstTouch || !latestTouch) return;
  await db.query(
    `INSERT INTO chatwoot_conversation_attribution (
      conversation_id, contact_id, inbox_id, agent_id, phone_key,
      first_touch_id, latest_touch_id, first_touch_at, latest_touch_at,
      channel, platform, source, medium, campaign_id, campaign_name,
      adset_id, adset_name, ad_id, ad_name, creative_id, creative_name, placement,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      branch_id, branch_name, attribution_method, confidence, unknown_reason,
      crm_lead_ids, crm_status, crm_won, crm_lost, revenue, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33::jsonb,$34,$35,$36,$37,now()
    ) ON CONFLICT (conversation_id) DO UPDATE SET
      contact_id = EXCLUDED.contact_id, inbox_id = EXCLUDED.inbox_id, agent_id = EXCLUDED.agent_id,
      phone_key = EXCLUDED.phone_key, first_touch_id = EXCLUDED.first_touch_id,
      latest_touch_id = EXCLUDED.latest_touch_id, first_touch_at = EXCLUDED.first_touch_at,
      latest_touch_at = EXCLUDED.latest_touch_at,
      channel = COALESCE(NULLIF(EXCLUDED.channel, ''), chatwoot_conversation_attribution.channel),
      platform = EXCLUDED.platform, source = EXCLUDED.source, medium = EXCLUDED.medium,
      campaign_id = EXCLUDED.campaign_id, campaign_name = EXCLUDED.campaign_name,
      adset_id = EXCLUDED.adset_id, adset_name = EXCLUDED.adset_name, ad_id = EXCLUDED.ad_id,
      ad_name = EXCLUDED.ad_name, creative_id = EXCLUDED.creative_id,
      creative_name = EXCLUDED.creative_name, placement = EXCLUDED.placement,
      utm_source = EXCLUDED.utm_source, utm_medium = EXCLUDED.utm_medium,
      utm_campaign = EXCLUDED.utm_campaign, utm_content = EXCLUDED.utm_content,
      utm_term = EXCLUDED.utm_term,
      branch_id = COALESCE(NULLIF(EXCLUDED.branch_id, ''), chatwoot_conversation_attribution.branch_id),
      branch_name = COALESCE(NULLIF(EXCLUDED.branch_name, ''), chatwoot_conversation_attribution.branch_name),
      attribution_method = EXCLUDED.attribution_method, confidence = EXCLUDED.confidence,
      -- A reason recorded for missing evidence (e.g. by the historical backfill) survives later messages.
      unknown_reason = CASE WHEN EXCLUDED.attribution_method = 'unknown'
        THEN COALESCE(NULLIF(chatwoot_conversation_attribution.unknown_reason, ''), EXCLUDED.unknown_reason)
        ELSE EXCLUDED.unknown_reason END,
      crm_lead_ids = EXCLUDED.crm_lead_ids, crm_status = EXCLUDED.crm_status,
      crm_won = EXCLUDED.crm_won, crm_lost = EXCLUDED.crm_lost, revenue = EXCLUDED.revenue, updated_at = now()`,
    [
      conversationId,
      candidate.contactId,
      candidate.inboxId,
      candidate.agentId,
      candidate.phoneKey,
      firstTouch.id,
      latestTouch.id,
      firstTouch.occurred_at,
      latestTouch.occurred_at,
      firstTouch.channel || candidate.channel,
      firstTouch.platform,
      firstTouch.source,
      firstTouch.medium,
      firstTouch.campaign_id,
      firstTouch.campaign_name,
      firstTouch.adset_id,
      firstTouch.adset_name,
      firstTouch.ad_id,
      firstTouch.ad_name,
      firstTouch.creative_id,
      firstTouch.creative_name,
      firstTouch.placement,
      firstTouch.utm_source,
      firstTouch.utm_medium,
      firstTouch.utm_campaign,
      firstTouch.utm_content,
      firstTouch.utm_term,
      firstTouch.branch_id || candidate.branchId,
      firstTouch.branch_name || candidate.branchName,
      firstTouch.attribution_method,
      firstTouch.confidence,
      firstTouch.unknown_reason ||
        (firstTouch.attribution_method === "unknown" ? REFERRAL_EVIDENCE_MISSING : ""),
      JSON.stringify(crm.ids),
      crm.status,
      crm.won,
      crm.lost,
      crm.revenue,
    ],
  );
}

function syncMode(): "off" | "attributes" | "labels" | "both" {
  const value = string(process.env.CHATWOOT_ATTRIBUTION_SYNC_MODE).toLowerCase();
  return value === "attributes" || value === "labels" || value === "both" ? value : "off";
}

export function managedAttributionLabels(
  candidate: Pick<NormalizedAttribution, "platform" | "source" | "medium" | "branchId">,
): string[] {
  const clean = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
  const source = clean(candidate.platform || candidate.source);
  const medium = clean(candidate.medium);
  const branch = clean(candidate.branchId);
  return [
    source ? `src:${source}` : "",
    medium ? `medium:${medium}` : "",
    branch ? `branch:${branch}` : "",
  ].filter(Boolean);
}

async function syncChatwoot(candidate: NormalizedAttribution, entity: MetaEntity): Promise<void> {
  if (!candidate.conversationId || syncMode() === "off") return;
  const mode = syncMode();
  if (mode === "attributes" || mode === "both") {
    const wanted = buildChatwootAttributionAttributes({
      channel: candidate.channel,
      branch: candidate.branchName || candidate.branchId,
      attributionMethod: candidate.attributionMethod,
      confidence: candidate.confidence,
      source: candidate.platform || candidate.source,
      medium: candidate.medium,
      campaignName: entity.campaignName,
      campaignId: entity.campaignId,
      adsetId: entity.adsetId,
      adId: entity.adId,
      creativeId: entity.creativeId,
      ctwaClid: candidate.ctwaClid,
      utmSource: candidate.utmSource,
      utmMedium: candidate.utmMedium,
      utmCampaign: candidate.utmCampaign,
      utmContent: candidate.utmContent,
      utmTerm: candidate.utmTerm,
    });
    await updateChatwootConversationAttributes(
      candidate.conversationId,
      (latest) => planChatwootAttributionUpdate(latest, wanted, "live"),
      { ownedKeys: CHATWOOT_ATTRIBUTION_KEYS },
    );
  }
  if (mode === "labels" || mode === "both") {
    const current = await getChatwootConversationLabels(candidate.conversationId);
    const wanted = managedAttributionLabels(candidate);
    const merged = [
      ...current.filter(
        (label) => !MANAGED_LABEL_PREFIXES.some((prefix) => label.startsWith(prefix)),
      ),
      ...wanted,
    ];
    const same =
      current.length === merged.length && current.every((label) => merged.includes(label));
    if (!same) await replaceChatwootConversationLabels(candidate.conversationId, merged);
  }
}

export async function processChatwootAttributionEvent(input: {
  payload: unknown;
  rawBody: string;
  deliveryId?: string;
}): Promise<{
  accepted: boolean;
  duplicate: boolean;
  projected: boolean;
  conversationId: number | null;
}> {
  if (!databaseConfigured())
    throw new Error("DATABASE_URL is required for durable webhook ingestion");
  await ensureSchema();
  const candidate = normalizeChatwootAttribution(input.payload);
  const payloadHash = hash(input.rawBody);
  const naturalKey = `${candidate.eventType}:${candidate.conversationId || ""}:${candidate.messageId || ""}:${payloadHash}`;
  const eventKey = input.deliveryId ? `delivery:${input.deliveryId}` : naturalKey;
  const db = getPool();
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO chatwoot_event_inbox (
      event_key, dedupe_key, delivery_id, event_type, conversation_id, message_id, provider_message_id, contact_id, inbox_id,
      occurred_at, payload_hash, evidence
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
    ON CONFLICT DO NOTHING RETURNING id`,
    [
      eventKey,
      naturalKey,
      input.deliveryId || null,
      candidate.eventType,
      candidate.conversationId,
      candidate.messageId,
      candidate.providerMessageId || null,
      candidate.contactId,
      candidate.inboxId,
      candidate.occurredAt,
      payloadHash,
      JSON.stringify(candidate.evidence),
    ],
  );
  let eventId = Number(inserted.rows[0]?.id || 0);
  const duplicate = !eventId;
  if (!eventId) {
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM chatwoot_event_inbox
        WHERE event_key = $1 OR dedupe_key = $2
        ORDER BY id DESC LIMIT 1`,
      [eventKey, naturalKey],
    );
    eventId = Number(existing.rows[0]?.id || 0);
    if (!eventId)
      return {
        accepted: true,
        duplicate: true,
        projected: false,
        conversationId: candidate.conversationId,
      };
    await db.query(
      `UPDATE chatwoot_event_inbox
          SET duplicate_deliveries = duplicate_deliveries + 1
        WHERE id = $1`,
      [eventId],
    );
  }
  // Exactly one worker/delivery claims a pending or failed event. A crash lease
  // expires after fifteen minutes so the provider's redelivery can repair it.
  const claimed = await db.query(
    `UPDATE chatwoot_event_inbox
        SET status = 'processing', locked_at = now(), attempts = attempts + 1
      WHERE id = $1
        AND (
          status IN ('pending', 'failed')
          OR (status = 'processing' AND (locked_at IS NULL OR locked_at < now() - interval '15 minutes'))
        )
      RETURNING id`,
    [eventId],
  );
  if (!claimed.rows.length)
    return {
      accepted: true,
      duplicate: true,
      projected: false,
      conversationId: candidate.conversationId,
    };

  try {
    if (!candidate.inbound || !candidate.conversationId) {
      await db.query(
        `UPDATE chatwoot_event_inbox
            SET status = 'ignored', locked_at = NULL, processed_at = now()
          WHERE id = $1`,
        [eventId],
      );
      return {
        accepted: true,
        duplicate,
        projected: false,
        conversationId: candidate.conversationId,
      };
    }
    const tokenEvidence = await resolveTrackingToken(candidate.trackingToken);
    const withToken =
      candidate.trackingToken && !tokenEvidence
        ? withoutInvalidTrackingToken(candidate)
        : applyToken(candidate, tokenEvidence);
    const entity = await enrichMeta(withToken);
    const branch = withToken.branchId
      ? { id: withToken.branchId, name: withToken.branchName }
      : resolveBranch(withToken.inboxId, tokenEvidence || undefined);
    const finalCandidate =
      branch && !withToken.branchId
        ? { ...withToken, branchId: branch.id, branchName: branch.name }
        : withToken;
    const finalHash = evidenceHash(finalCandidate, entity);
    const values = rowValues(finalCandidate, entity, eventId, finalHash);
    const touch = await db.query<{ id: string }>(
      `INSERT INTO chatwoot_attribution_touches (
        conversation_id, contact_id, inbox_id, message_id, provider_message_id, event_id, phone_key, channel, platform, source, medium,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term, campaign_id, campaign_name, adset_id,
        adset_name, ad_id, ad_name, creative_id, ctwa_clid, referral_source_id, referral_source_type,
        referral_source_url, referral_headline, branch_id, branch_name, attribution_method, confidence,
        evidence_hash, evidence, occurred_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34::jsonb,$35
      ) ON CONFLICT (conversation_id, message_id, evidence_hash) DO NOTHING RETURNING id`,
      values,
    );
    const crm = await crmMatch(finalCandidate.phoneKey);
    await upsertConversationProjection(finalCandidate.conversationId!, finalCandidate, crm);
    if (finalCandidate.trackingToken) {
      await db.query(
        `UPDATE chatwoot_attribution_tokens
            SET consumed_at = COALESCE(consumed_at, now()), consumed_conversation_id = COALESCE(consumed_conversation_id, $2)
          WHERE token = $1`,
        [finalCandidate.trackingToken, finalCandidate.conversationId],
      );
    }
    await syncChatwoot(finalCandidate, entity);
    if (finalCandidate.providerMessageId) {
      void import("./meta-message-attribution.server")
        .then(({ processMetaAttributionForProviderMessage }) =>
          processMetaAttributionForProviderMessage(finalCandidate.providerMessageId),
        )
        .catch((error) =>
          console.error("[meta-attribution] deferred correlation failed", {
            message: error instanceof Error ? error.message.slice(0, 240) : "processing failed",
          }),
        );
    }
    await db.query(
      `UPDATE chatwoot_event_inbox
          SET status = 'processed', locked_at = NULL, processed_at = now(), last_error = ''
        WHERE id = $1`,
      [eventId],
    );
    return {
      accepted: true,
      duplicate,
      projected: Boolean(touch.rows[0]),
      conversationId: finalCandidate.conversationId,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 1_000) : "Attribution processing failed";
    await db.query(
      `UPDATE chatwoot_event_inbox
          SET status = 'failed', locked_at = NULL, last_error = $2
        WHERE id = $1`,
      [eventId, message],
    );
    throw error;
  }
}

export async function createAttributionTrackingToken(
  evidence: AttributionTokenEvidence,
): Promise<{ token: string; expiresAt: string }> {
  if (!databaseConfigured()) throw new Error("DATABASE_URL is required for attribution tracking");
  await ensureSchema();
  const ttl = Math.max(
    60,
    Math.min(
      30 * 24 * 60 * 60,
      Number(process.env.CHATWOOT_ATTRIBUTION_TOKEN_TTL_SECONDS) || DEFAULT_TOKEN_TTL_SECONDS,
    ),
  );
  const nonce = randomBytes(12).toString("base64url");
  const signature = tokenSignature(nonce);
  if (!signature)
    throw new Error("CHATWOOT_ATTRIBUTION_TOKEN_SECRET is required to issue tracking tokens");
  const token = `${nonce}.${signature}`;
  const expiresAt = new Date(Date.now() + ttl * 1_000).toISOString();
  await getPool().query(
    `INSERT INTO chatwoot_attribution_tokens (token, evidence, expires_at) VALUES ($1,$2::jsonb,$3)`,
    [token, JSON.stringify(evidence), expiresAt],
  );
  return { token, expiresAt };
}

interface AttributionFilters {
  from?: string;
  to?: string;
  channel?: string;
  platform?: string;
  source?: string;
  medium?: string;
  campaignId?: string;
  adsetId?: string;
  adId?: string;
  branchId?: string;
  inboxId?: string;
  agentId?: string;
  method?: string;
  confidence?: string;
  unknownReason?: string;
  crmStatus?: string;
}

function sqlFilters(filters: AttributionFilters, alias = "c") {
  const predicates: string[] = ["1=1"];
  const values: unknown[] = [];
  const add = (column: string, value: string | undefined) => {
    if (!value) return;
    values.push(value);
    predicates.push(`${alias}.${column} = $${values.length}`);
  };
  if (filters.from && /^\d{4}-\d{2}-\d{2}$/.test(filters.from)) {
    values.push(`${filters.from}T00:00:00.000Z`);
    predicates.push(`${alias}.latest_touch_at >= $${values.length}::timestamptz`);
  }
  if (filters.to && /^\d{4}-\d{2}-\d{2}$/.test(filters.to)) {
    values.push(`${filters.to}T23:59:59.999Z`);
    predicates.push(`${alias}.latest_touch_at <= $${values.length}::timestamptz`);
  }
  add("platform", filters.platform);
  add("channel", filters.channel);
  add("source", filters.source);
  add("medium", filters.medium);
  add("campaign_id", filters.campaignId);
  add("adset_id", filters.adsetId);
  add("ad_id", filters.adId);
  add("branch_id", filters.branchId);
  add("inbox_id", filters.inboxId);
  add("agent_id", filters.agentId);
  add("attribution_method", filters.method);
  add("confidence", filters.confidence);
  add("unknown_reason", filters.unknownReason);
  add("crm_status", filters.crmStatus);
  return { where: predicates.join(" AND "), values };
}

function amount(value: string): number | null {
  const parsed = Number(value.replace(/[,$\s]/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function dateKey(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : "";
}

/**
 * Spend is eligible only when a locally stored Meta row exactly shares a
 * resolved campaign ID. A campaign name, UTM string, or inbox mapping never
 * creates spend coverage, so no paid budget is allocated across unproven rows.
 */
async function metaSpendForCampaigns(
  campaigns: Record<string, string>[],
  filters: AttributionFilters,
): Promise<{
  available: boolean;
  total: number | null;
  byCampaignId: Map<string, number>;
  byAdId: Map<string, number>;
}> {
  const ids = new Set(campaigns.map((row) => row.campaign_id).filter(Boolean));
  if (!ids.size)
    return { available: false, total: null, byCampaignId: new Map(), byAdId: new Map() };
  const { metaAds } = await importedRows();
  const byCampaignId = new Map<string, number>();
  const byAdId = new Map<string, number>();
  for (const row of metaAds) {
    const campaignId = scalar(row, ["__campaign_id", "Campaign ID", "campaignId", "campaign_id"]);
    if (!ids.has(campaignId)) continue;
    const sourceDate = dateKey(scalar(row, ["التاريخ", "Date", "date", "__date"]));
    // A selected period never incorporates an undated spend row.
    if ((filters.from || filters.to) && !sourceDate) continue;
    if (filters.from && sourceDate < filters.from) continue;
    if (filters.to && sourceDate > filters.to) continue;
    const spend = amount(scalar(row, ["Spend (Cost)", "Spend", "spend", "Cost", "cost"]));
    if (spend === null) continue;
    byCampaignId.set(campaignId, (byCampaignId.get(campaignId) || 0) + spend);
    const adId = scalar(row, ["__ad_id", "Ad ID", "adId", "ad_id"]);
    if (adId) byAdId.set(adId, (byAdId.get(adId) || 0) + spend);
  }
  if (!byCampaignId.size) return { available: false, total: null, byCampaignId, byAdId };
  return {
    available: true,
    total: [...byCampaignId.values()].reduce((sum, value) => sum + value, 0),
    byCampaignId,
    byAdId,
  };
}

export function attributionPercentage(numerator: number, denominator: number): number | null {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

export async function getAttributionSummary(filters: AttributionFilters = {}) {
  if (!databaseConfigured()) {
    return {
      configured: false,
      totals: null,
      campaigns: [],
      sources: [],
      branches: [],
      trend: [],
    };
  }
  await ensureSchema();
  const { where, values } = sqlFilters(filters);
  const db = getPool();
  const [totalsResult, campaignsResult, sourcesResult, branchesResult, trendResult] =
    await Promise.all([
      db.query<Record<string, string>>(
        `SELECT
        count(*)::int AS conversations,
        count(*) FILTER (WHERE attribution_method NOT IN ('unknown','inbox_only','inbox_mapping'))::int AS attributed_conversations,
        count(*) FILTER (WHERE attribution_method IN ('meta_referral','meta_whatsapp_referral'))::int AS meta_ctwa_conversations,
        count(*) FILTER (WHERE attribution_method IN ('meta_referral','meta_whatsapp_referral','meta_messenger_referral','meta_instagram_referral') AND campaign_id <> '')::int AS paid_campaign_conversations,
        count(*) FILTER (WHERE attribution_method IN ('inbox_only','inbox_mapping') OR unknown_reason IN ('organic_direct','no_paid_referral'))::int AS organic_direct_conversations,
        count(*) FILTER (WHERE attribution_method = 'unknown' OR unknown_reason IN ('meta_source_id_unresolved','meta_identity_missing','unsupported_channel','historical_evidence_missing','chatwoot_payload_missing'))::int AS unknown_conversations,
        count(*) FILTER (WHERE confidence = 'exact')::int AS exact_conversations,
        count(*) FILTER (WHERE confidence = 'inferred')::int AS inferred_conversations,
        count(DISTINCT NULLIF(contact_id, 0))::int AS unique_contacts,
        count(*) FILTER (WHERE crm_won)::int AS won,
        count(*) FILTER (WHERE crm_lost)::int AS lost,
        count(*) FILTER (WHERE jsonb_array_length(crm_lead_ids) > 0)::int AS crm_matched,
        sum(revenue) AS revenue
       FROM chatwoot_conversation_attribution c WHERE ${where}`,
        values,
      ),
      db.query<Record<string, string>>(
        `SELECT platform, source, medium, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name,
              count(*)::int AS conversations,
              coalesce(sum(jsonb_array_length(crm_lead_ids)),0)::int AS crm_leads,
              count(*) FILTER (WHERE crm_won)::int AS won,
              count(*) FILTER (WHERE crm_lost)::int AS lost,
              sum(revenue) AS revenue
         FROM chatwoot_conversation_attribution c WHERE ${where}
        GROUP BY platform, source, medium, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name
        ORDER BY conversations DESC, campaign_name ASC LIMIT 100`,
        values,
      ),
      db.query<Record<string, string>>(
        `SELECT channel, platform, source, medium, count(*)::int AS conversations,
              count(*) FILTER (WHERE crm_won)::int AS won, sum(revenue) AS revenue
         FROM chatwoot_conversation_attribution c WHERE ${where}
        GROUP BY channel, platform, source, medium
        ORDER BY conversations DESC, platform ASC, channel ASC, source ASC`,
        values,
      ),
      db.query<Record<string, string>>(
        `SELECT branch_id, branch_name, count(*)::int AS conversations,
              count(*) FILTER (WHERE crm_won)::int AS won, sum(revenue) AS revenue
         FROM chatwoot_conversation_attribution c WHERE ${where}
        GROUP BY branch_id, branch_name
        ORDER BY conversations DESC, branch_name ASC`,
        values,
      ),
      db.query<Record<string, string>>(
        `SELECT to_char(latest_touch_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
              count(*)::int AS conversations,
              count(*) FILTER (WHERE attribution_method = 'unknown' OR unknown_reason IN ('meta_source_id_unresolved','meta_identity_missing','unsupported_channel','historical_evidence_missing','chatwoot_payload_missing'))::int AS unknown_conversations
         FROM chatwoot_conversation_attribution c WHERE ${where}
        GROUP BY 1 ORDER BY 1`,
        values,
      ),
    ]);
  const totals = totalsResult.rows[0] || {};
  const conversations = Number(totals.conversations || 0);
  let spend = {
    available: false,
    total: null as number | null,
    byCampaignId: new Map<string, number>(),
    byAdId: new Map<string, number>(),
  };
  try {
    spend = await metaSpendForCampaigns(campaignsResult.rows, filters);
  } catch {
    // Imported spend is supplemental to the durable conversation projection.
    // A stale Meta cache must never take the attribution dashboard down.
  }
  const coveredCampaignRows = campaignsResult.rows.filter((row) =>
    spend.byCampaignId.has(row.campaign_id),
  );
  const spendCoveredConversations = coveredCampaignRows.reduce(
    (sum, row) => sum + Number(row.conversations || 0),
    0,
  );
  const spendCoveredWon = coveredCampaignRows.reduce((sum, row) => sum + Number(row.won || 0), 0);
  const spendCoveredRevenue = coveredCampaignRows.reduce((sum, row) => {
    const revenue = row.revenue === null || row.revenue === undefined ? 0 : Number(row.revenue);
    return Number.isFinite(revenue) ? sum + revenue : sum;
  }, 0);
  return {
    configured: true,
    totals: {
      conversations,
      attributedConversations: Number(totals.attributed_conversations || 0),
      metaCtwaConversations: Number(totals.meta_ctwa_conversations || 0),
      paidCampaignConversations: Number(totals.paid_campaign_conversations || 0),
      organicDirectConversations: Number(totals.organic_direct_conversations || 0),
      unknownConversations: Number(totals.unknown_conversations || 0),
      exactConversations: Number(totals.exact_conversations || 0),
      inferredConversations: Number(totals.inferred_conversations || 0),
      uniqueContacts: Number(totals.unique_contacts || 0),
      crmMatched: Number(totals.crm_matched || 0),
      won: Number(totals.won || 0),
      lost: Number(totals.lost || 0),
      revenue:
        totals.revenue === null || totals.revenue === undefined ? null : Number(totals.revenue),
      unknownRate: attributionPercentage(Number(totals.unknown_conversations || 0), conversations),
      spend: spend.total,
      spendAvailable: spend.available,
      spendCoveredConversations,
      costPerConversation:
        spend.total !== null && spendCoveredConversations > 0
          ? spend.total / spendCoveredConversations
          : null,
      costPerAcquisition:
        spend.total !== null && spendCoveredWon > 0 ? spend.total / spendCoveredWon : null,
      roas: spend.total !== null && spend.total > 0 ? spendCoveredRevenue / spend.total : null,
    },
    campaigns: campaignsResult.rows.map((row) => {
      // Ad-grain reporting uses ad_id. Campaign-grain rows use campaign_id.
      const exactSpend = row.ad_id
        ? spend.byAdId.get(row.ad_id)
        : spend.byCampaignId.get(row.campaign_id);
      const rowSpend = exactSpend ?? null;
      const rowConversations = Number(row.conversations || 0);
      const rowWon = Number(row.won || 0);
      const rowRevenue =
        row.revenue === null || row.revenue === undefined ? null : Number(row.revenue);
      return {
        ...row,
        conversations: rowConversations,
        crmLeads: Number(row.crm_leads || 0),
        won: rowWon,
        lost: Number(row.lost || 0),
        revenue: rowRevenue,
        spend: rowSpend,
        costPerAttributedConversation:
          rowSpend !== null && rowConversations > 0 ? rowSpend / rowConversations : null,
        conversionRate: attributionPercentage(rowWon, rowConversations),
        cpa: rowSpend !== null && rowWon > 0 ? rowSpend / rowWon : null,
        roas:
          rowSpend !== null && rowSpend > 0 && rowRevenue !== null ? rowRevenue / rowSpend : null,
      };
    }),
    sources: sourcesResult.rows.map((row) => ({
      ...row,
      conversations: Number(row.conversations || 0),
      won: Number(row.won || 0),
      revenue: row.revenue === null || row.revenue === undefined ? null : Number(row.revenue),
    })),
    branches: branchesResult.rows.map((row) => ({
      ...row,
      conversations: Number(row.conversations || 0),
      won: Number(row.won || 0),
      revenue: row.revenue === null || row.revenue === undefined ? null : Number(row.revenue),
    })),
    trend: trendResult.rows.map((row) => ({
      date: row.date,
      conversations: Number(row.conversations || 0),
      unknownConversations: Number(row.unknown_conversations || 0),
    })),
  };
}

export async function getAttributionConversations(
  filters: AttributionFilters & { limit?: number; offset?: number } = {},
) {
  if (!databaseConfigured()) return { configured: false, rows: [], total: 0 };
  await ensureSchema();
  const { where, values } = sqlFilters(filters);
  const limit = Math.max(1, Math.min(300, Math.trunc(filters.limit || 100)));
  const offset = Math.max(0, Math.trunc(filters.offset || 0));
  const db = getPool();
  const totalResult = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM chatwoot_conversation_attribution c WHERE ${where}`,
    values,
  );
  values.push(limit, offset);
  const rows = await db.query<Record<string, unknown>>(
    `SELECT conversation_id, latest_touch_at, channel, platform, source, medium, campaign_id, campaign_name,
            adset_id, adset_name, ad_id, ad_name, creative_id, creative_name, placement,
            utm_source, utm_medium, utm_campaign, utm_content, utm_term,
            branch_id, branch_name, attribution_method, confidence, unknown_reason,
            crm_status, crm_won, crm_lost, revenue
       FROM chatwoot_conversation_attribution c WHERE ${where}
      ORDER BY latest_touch_at DESC NULLS LAST LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  const baseUrl = (process.env.CHATWOOT_BASE_URL || "").replace(/\/+$/, "");
  const accountId = process.env.CHATWOOT_ACCOUNT_ID || "";
  return {
    configured: true,
    total: Number(totalResult.rows[0]?.count || 0),
    rows: rows.rows.map((row) => ({
      ...row,
      chatwootUrl:
        baseUrl && accountId
          ? `${baseUrl}/app/accounts/${encodeURIComponent(accountId)}/conversations/${row.conversation_id}`
          : null,
    })),
  };
}

export async function getAttributionHealth() {
  if (!databaseConfigured()) return { configured: false };
  await ensureSchema();
  const db = getPool();
  const [events, touches, latest] = await Promise.all([
    db.query<Record<string, string>>(
      `SELECT count(*)::int AS received,
              count(*) FILTER (WHERE status = 'failed')::int AS failures,
              count(*) FILTER (WHERE status IN ('pending', 'processing'))::int AS pending,
              coalesce(sum(duplicate_deliveries), 0)::int AS duplicate_deliveries,
              count(*) FILTER (WHERE attempts > 1)::int AS retried_events,
              max(received_at) AS last_received_at,
              max(processed_at) AS last_processed_at
         FROM chatwoot_event_inbox`,
    ),
    db.query<Record<string, string>>(
      `SELECT count(*)::int AS touches,
              count(*) FILTER (WHERE attribution_method = 'meta_referral' AND ad_id = '')::int AS unresolved_meta_source_ids,
              count(*) FILTER (WHERE attribution_method = 'unknown')::int AS unknown_touches
         FROM chatwoot_attribution_touches`,
    ),
    db.query<Record<string, string>>(
      `SELECT count(*)::int AS conversations,
              count(*) FILTER (WHERE confidence = 'exact')::int AS exact,
              count(*) FILTER (WHERE confidence = 'inferred')::int AS inferred,
              count(*) FILTER (WHERE attribution_method = 'unknown')::int AS unknown
         FROM chatwoot_conversation_attribution`,
    ),
  ]);
  return {
    configured: true,
    events: events.rows[0],
    touches: touches.rows[0],
    conversations: latest.rows[0],
    syncMode: syncMode(),
  };
}

/**
 * Deletes expiring marketing evidence while retaining the non-identifying
 * conversation projection needed for aggregate reporting. Invoke only from a
 * scheduled private job or an operator runbook; no public endpoint exposes it.
 */
export async function purgeExpiredAttributionData(input: { retentionDays?: number } = {}) {
  if (!databaseConfigured()) throw new Error("DATABASE_URL is required for attribution retention");
  await ensureSchema();
  const configuredDays = Number(process.env.CHATWOOT_ATTRIBUTION_RETENTION_DAYS) || 365;
  const retentionDays = Math.max(
    30,
    Math.min(3_650, Math.trunc(input.retentionDays ?? configuredDays)),
  );
  const db = getPool();
  const [touches, events, tokens] = await Promise.all([
    db.query(
      `DELETE FROM chatwoot_attribution_touches
        WHERE occurred_at < now() - ($1::text || ' days')::interval`,
      [retentionDays],
    ),
    db.query(
      `DELETE FROM chatwoot_event_inbox
        WHERE occurred_at < now() - ($1::text || ' days')::interval`,
      [retentionDays],
    ),
    db.query(`DELETE FROM chatwoot_attribution_tokens WHERE expires_at < now()`),
  ]);
  return {
    retentionDays,
    deleted: {
      touches: touches.rowCount || 0,
      events: events.rowCount || 0,
      expiredTokens: tokens.rowCount || 0,
    },
  };
}
