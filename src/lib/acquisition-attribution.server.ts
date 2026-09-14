import { Pool } from "pg";
import { ACQUISITION_COUNTED_ENTITIES } from "./acquisition-attribution";

/**
 * Unified acquisition attribution.
 *
 * One canonical event shape over the provider projections that already exist:
 * Meta instant-form leads, Chatwoot conversations, and landing sessions. It is
 * a query model, not a copy, so no adapter can drift from its own evidence.
 * Nothing here reads CRM to decide attribution and nothing calls Meta Graph;
 * CRM status and revenue appear only where an existing downstream join exists.
 */

let pool: Pool | null = null;

type Row = Record<string, unknown>;

export interface AcquisitionFilters {
  from?: string;
  to?: string;
  entityType?: string;
  sourceType?: string;
  destination?: string;
  campaignId?: string;
  adsetId?: string;
  adId?: string;
  formId?: string;
  limit?: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[\w.:-]{1,64}$/;

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 4,
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

export function acquisitionDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

async function existingSources(): Promise<{
  leads: boolean;
  conversations: boolean;
  landing: boolean;
}> {
  const result = await getPool().query<Row>(
    `SELECT to_regclass('public.meta_lead_acquisitions') AS leads,
            to_regclass('public.chatwoot_conversation_attribution') AS conversations,
            to_regclass('public.landing_attribution_sessions') AS landing`,
  );
  const row = result.rows[0] ?? {};
  return {
    leads: Boolean(row.leads),
    conversations: Boolean(row.conversations),
    landing: Boolean(row.landing),
  };
}

/** Canonical columns, in order, shared by every branch of the union. */
const COLUMNS = `acquisition_event_id, entity_type, entity_id, source_type, source_platform, destination_channel,
  provider_event_id, provider_message_id, provider_lead_id, page_id, page_name, form_id, form_name,
  landing_page_id, landing_page_name, landing_page_url, account_id, campaign_id, campaign_name,
  adset_id, adset_name, ad_id, ad_name, creative_id, creative_name, placement,
  utm_source, utm_medium, utm_campaign, utm_content, utm_term, referral_source_id, ctwa_clid,
  attribution_method, attribution_confidence, attribution_scope, occurred_at, received_at, processed_at,
  unknown_reason, crm_status, crm_won, revenue`;

const META_LEADS_SQL = `
  SELECT 'meta_lead:' || lead_id, 'meta_lead', lead_id, source_type, source_platform, 'meta_instant_form',
    'meta_lead:' || lead_id, '', lead_id, page_id, page_name, form_id, form_name,
    '', '', '', account_id, campaign_id, campaign_name,
    adset_id, adset_name, ad_id, ad_name, creative_id, creative_name, '',
    '', '', '', '', '', '', '',
    attribution_method, attribution_confidence, attribution_scope, occurred_at, received_at, processed_at,
    unknown_reason, NULL::text, NULL::boolean, NULL::numeric
  FROM meta_lead_acquisitions`;

// Mirrors chatwootSourceType / chatwootDestinationChannel in acquisition-attribution.ts.
const CONVERSATIONS_SQL = `
  SELECT 'chatwoot_conversation:' || c.conversation_id, 'chatwoot_conversation', c.conversation_id::text,
    CASE
      WHEN c.attribution_method IN ('meta_whatsapp_referral','meta_messenger_referral','meta_instagram_referral') THEN c.attribution_method
      WHEN c.attribution_method = 'meta_referral' AND resolved.channel = 'Channel::Whatsapp' THEN 'meta_whatsapp_referral'
      WHEN c.attribution_method = 'meta_referral' AND resolved.channel = 'Channel::FacebookPage' THEN 'meta_messenger_referral'
      WHEN c.attribution_method = 'meta_referral' AND resolved.channel = 'Channel::Instagram' THEN 'meta_instagram_referral'
      WHEN c.attribution_method IN ('utm','signed_tracking_token','referrer') THEN 'website_chat'
      WHEN c.attribution_method = 'organic_direct' AND c.confidence = 'exact' THEN 'direct_or_organic'
      ELSE 'unknown'
    END,
    COALESCE(NULLIF(c.platform,''), NULLIF(c.source,''), ''),
    CASE resolved.channel
      WHEN 'Channel::Whatsapp' THEN 'whatsapp'
      WHEN 'Channel::FacebookPage' THEN 'messenger'
      WHEN 'Channel::Instagram' THEN 'instagram_dm'
      WHEN 'Channel::WebWidget' THEN 'website_chat'
      WHEN 'Channel::Api' THEN 'website_chat'
      ELSE 'unknown'
    END,
    '', c.provider_message_id, '', c.destination_page_id, '', '', '',
    '', '', '', '', c.campaign_id, c.campaign_name,
    c.adset_id, c.adset_name, c.ad_id, c.ad_name, c.creative_id, c.creative_name, c.placement,
    c.utm_source, c.utm_medium, c.utm_campaign, c.utm_content, c.utm_term, c.referral_source_id, c.ctwa_clid,
    c.attribution_method, c.confidence, c.attribution_scope, c.first_touch_at, c.first_touch_at, c.updated_at,
    CASE WHEN c.attribution_method = 'unknown' AND c.unknown_reason = '' THEN 'historical_evidence_missing' ELSE c.unknown_reason END,
    c.crm_status, c.crm_won, c.revenue
  FROM chatwoot_conversation_attribution c
  CROSS JOIN LATERAL (
    SELECT COALESCE(NULLIF(c.channel,''),
      (SELECT max(x.channel) FROM chatwoot_conversation_attribution x WHERE x.inbox_id = c.inbox_id AND x.channel <> '')) AS channel
  ) resolved`;

function landingSql(entity: "landing_submission" | "landing_visit"): string {
  const submission = entity === "landing_submission";
  return `
  SELECT '${entity}:' || session_id, '${entity}', ${submission ? "COALESCE(submission_id, session_id)" : "session_id"},
    '${submission ? "landing_page_form" : "landing_page_visit"}',
    COALESCE(NULLIF(first_source,''), ''), 'landing_page',
    '', '', '', '', '', '', '',
    landing_page_id, COALESCE(landing_page_name,''), COALESCE(first_touch->>'landingPageUrl',''), '', '', '',
    '', '', '', '', '', '', '',
    COALESCE(first_source,''), COALESCE(first_medium,''), COALESCE(first_campaign,''), COALESCE(first_content,''), COALESCE(first_term,''), '', '',
    first_attribution_method,
    CASE first_attribution_method WHEN 'utm' THEN 'declared' WHEN 'tracking_token' THEN 'declared' WHEN 'referrer' THEN 'inferred' ELSE 'unknown' END,
    'session', ${submission ? "submitted_at" : "first_seen"}, first_seen, latest_seen,
    CASE WHEN first_attribution_method IN ('direct','unknown') THEN 'no_utm' ELSE '' END,
    NULL::text, NULL::boolean, NULL::numeric
  FROM landing_attribution_sessions${submission ? " WHERE submitted_at IS NOT NULL" : ""}`;
}

async function eventsCte(): Promise<string | null> {
  const sources = await existingSources();
  const parts = [
    sources.leads ? META_LEADS_SQL : "",
    sources.conversations ? CONVERSATIONS_SQL : "",
    sources.landing ? landingSql("landing_submission") : "",
    sources.landing ? landingSql("landing_visit") : "",
  ].filter(Boolean);
  if (!parts.length) return null;
  return `WITH acquisition_events (${COLUMNS}) AS (${parts.join("\n  UNION ALL\n")})`;
}

function where(filters: AcquisitionFilters): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    clauses.push(sql.replace("?", `$${params.length}`));
  };
  if (filters.from && DATE.test(filters.from)) add("occurred_at >= ?::date", filters.from);
  if (filters.to && DATE.test(filters.to))
    add("occurred_at < (?::date + interval '1 day')", filters.to);
  for (const [key, column] of [
    ["entityType", "entity_type"],
    ["sourceType", "source_type"],
    ["destination", "destination_channel"],
    ["campaignId", "campaign_id"],
    ["adsetId", "adset_id"],
    ["adId", "ad_id"],
    ["formId", "form_id"],
  ] as const) {
    const value = filters[key];
    if (value && ID.test(value)) add(`${column} = ?`, value);
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

const COUNTED = ACQUISITION_COUNTED_ENTITIES.map((entity) => `'${entity}'`).join(",");

export async function getAcquisitionSummary(filters: AcquisitionFilters = {}) {
  if (!acquisitionDatabaseConfigured()) return { configured: false };
  const cte = await eventsCte();
  if (!cte) return { configured: true, empty: true };
  const { sql, params } = where(filters);
  const filtered = `${cte}, filtered AS (SELECT * FROM acquisition_events ${sql})`;
  const [totals, breakdown, campaigns, forms, trend] = await Promise.all([
    getPool().query<Row>(
      `${filtered}
       SELECT
         count(*) FILTER (WHERE entity_type IN (${COUNTED}))::int AS acquisition_events,
         count(*) FILTER (WHERE entity_type='meta_lead')::int AS meta_instant_form_leads,
         count(*) FILTER (WHERE entity_type='chatwoot_conversation' AND destination_channel IN ('whatsapp','messenger','instagram_dm'))::int AS messaging_conversations,
         count(*) FILTER (WHERE entity_type='chatwoot_conversation' AND destination_channel='whatsapp')::int AS whatsapp_conversations,
         count(*) FILTER (WHERE entity_type='chatwoot_conversation' AND destination_channel='messenger')::int AS messenger_conversations,
         count(*) FILTER (WHERE entity_type='chatwoot_conversation' AND destination_channel='instagram_dm')::int AS instagram_conversations,
         count(*) FILTER (WHERE entity_type='chatwoot_conversation' AND destination_channel IN ('website_chat','unknown'))::int AS other_conversations,
         count(*) FILTER (WHERE entity_type='landing_submission')::int AS landing_submissions,
         count(*) FILTER (WHERE entity_type='landing_visit')::int AS landing_visits,
         count(*) FILTER (WHERE entity_type IN (${COUNTED}) AND attribution_confidence='exact' AND campaign_id<>'')::int AS exact_attributed,
         count(*) FILTER (WHERE entity_type IN (${COUNTED}) AND source_type='unknown')::int AS unknown,
         count(*) FILTER (WHERE entity_type IN (${COUNTED}) AND source_type='direct_or_organic')::int AS organic_direct
       FROM filtered`,
      params,
    ),
    getPool().query<Row>(
      `${filtered}
       SELECT entity_type, source_type, destination_channel, source_platform, count(*)::int AS events,
              count(*) FILTER (WHERE attribution_confidence='exact' AND campaign_id<>'')::int AS exact
         FROM filtered GROUP BY 1,2,3,4 ORDER BY events DESC LIMIT 200`,
      params,
    ),
    getPool().query<Row>(
      `${filtered}
       SELECT campaign_id, max(campaign_name) AS campaign_name, adset_id, max(adset_name) AS adset_name,
              ad_id, max(ad_name) AS ad_name, entity_type, destination_channel, count(*)::int AS events
         FROM filtered WHERE campaign_id <> '' AND entity_type IN (${COUNTED})
        GROUP BY campaign_id, adset_id, ad_id, entity_type, destination_channel
        ORDER BY events DESC LIMIT 1000`,
      params,
    ),
    getPool().query<Row>(
      `${filtered}
       SELECT form_id, max(form_name) AS form_name, max(page_id) AS page_id, max(page_name) AS page_name,
              campaign_id, max(campaign_name) AS campaign_name, adset_id, max(adset_name) AS adset_name,
              ad_id, max(ad_name) AS ad_name, count(*)::int AS leads,
              count(*) FILTER (WHERE attribution_scope='organic')::int AS organic_leads
         FROM filtered WHERE entity_type='meta_lead'
        GROUP BY form_id, campaign_id, adset_id, ad_id
        ORDER BY leads DESC LIMIT 1000`,
      params,
    ),
    getPool().query<Row>(
      `${filtered}
       SELECT to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') AS date, entity_type, count(*)::int AS events
         FROM filtered WHERE occurred_at IS NOT NULL GROUP BY 1,2 ORDER BY 1`,
      params,
    ),
  ]);
  return {
    configured: true,
    totals: totals.rows[0],
    breakdown: breakdown.rows,
    campaigns: campaigns.rows,
    forms: forms.rows,
    trend: trend.rows,
    // Spend and CRM outcomes for Meta leads are shown only once an exact join is proven.
    formOutcomesAvailable: false,
  };
}

function chatwootConversationUrl(conversationId: string): string | null {
  const base = process.env.CHATWOOT_BASE_URL?.trim().replace(/\/+$/, "");
  const account = process.env.CHATWOOT_ACCOUNT_ID?.trim();
  return base && account && /^\d+$/.test(conversationId)
    ? `${base}/app/accounts/${account}/conversations/${conversationId}`
    : null;
}

export async function getAcquisitionEvents(filters: AcquisitionFilters = {}) {
  if (!acquisitionDatabaseConfigured()) return { configured: false, total: 0, rows: [] };
  const cte = await eventsCte();
  if (!cte) return { configured: true, total: 0, rows: [] };
  const { sql, params } = where(filters);
  const limit = Math.min(Math.max(Number(filters.limit) || 500, 1), 2000);
  const [rows, count] = await Promise.all([
    getPool().query<Row>(
      `${cte} SELECT acquisition_event_id, entity_type, entity_id, source_type, source_platform, destination_channel,
         provider_message_id, provider_lead_id, page_id, page_name, form_id, form_name, landing_page_id,
         landing_page_name, account_id, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name,
         creative_id, creative_name, utm_source, utm_medium, utm_campaign, utm_content,
         attribution_method, attribution_confidence, attribution_scope, occurred_at, unknown_reason,
         crm_status, crm_won, revenue
       FROM acquisition_events ${sql} ORDER BY occurred_at DESC NULLS LAST LIMIT ${limit}`,
      params,
    ),
    getPool().query<Row>(
      `${cte} SELECT count(*)::int AS total FROM acquisition_events ${sql}`,
      params,
    ),
  ]);
  return {
    configured: true,
    total: Number(count.rows[0]?.total ?? 0),
    rows: rows.rows.map((row) => ({
      ...row,
      chatwootUrl:
        row.entity_type === "chatwoot_conversation"
          ? chatwootConversationUrl(String(row.entity_id))
          : null,
    })),
  };
}
