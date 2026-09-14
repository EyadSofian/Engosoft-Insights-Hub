import { Pool } from "pg";
import {
  chatwootChannelSql,
  sourcePlatformSql,
  summarizeAcquisitionGroups,
  type AcquisitionGroup,
} from "./acquisition-attribution";

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

export function getPool(): Pool {
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
  dashboardRows: boolean;
}> {
  const result = await getPool().query<Row>(
    `SELECT to_regclass('public.meta_lead_acquisitions') AS leads,
            to_regclass('public.chatwoot_conversation_attribution') AS conversations,
            to_regclass('public.landing_attribution_sessions') AS landing,
            to_regclass('public.dashboard_rows') AS dashboard_rows`,
  );
  const row = result.rows[0] ?? {};
  return {
    leads: Boolean(row.leads),
    conversations: Boolean(row.conversations),
    landing: Boolean(row.landing),
    dashboardRows: Boolean(row.dashboard_rows),
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
  SELECT 'meta_lead:' || lead_id, 'meta_lead', lead_id, source_type, ${sourcePlatformSql("source_platform")}, 'meta_instant_form',
    'meta_lead:' || lead_id, '', lead_id, page_id, page_name, form_id, form_name,
    '', '', '', account_id, campaign_id, campaign_name,
    adset_id, adset_name, ad_id, ad_name, creative_id, creative_name, '',
    '', '', '', '', '', '', '',
    attribution_method, attribution_confidence, attribution_scope, occurred_at, received_at, processed_at,
    unknown_reason, NULL::text, NULL::boolean, NULL::numeric
  FROM meta_lead_acquisitions`;

// Mirrors chatwootSourceType in acquisition-attribution.ts.
const CONVERSATION_SOURCE_TYPE = `CASE
      WHEN c.attribution_method IN ('meta_whatsapp_referral','meta_messenger_referral','meta_instagram_referral') THEN c.attribution_method
      WHEN c.attribution_method = 'meta_referral' AND resolved.destination = 'whatsapp' THEN 'meta_whatsapp_referral'
      WHEN c.attribution_method = 'meta_referral' AND resolved.destination = 'messenger' THEN 'meta_messenger_referral'
      WHEN c.attribution_method = 'meta_referral' AND resolved.destination = 'instagram_dm' THEN 'meta_instagram_referral'
      WHEN c.attribution_method IN ('utm','signed_tracking_token','referrer') THEN 'website_chat'
      WHEN c.attribution_method = 'organic_direct' AND c.confidence = 'exact' THEN 'direct_or_organic'
      ELSE 'unknown'
    END`;

const CONVERSATIONS_SQL = `
  SELECT 'chatwoot_conversation:' || c.conversation_id, 'chatwoot_conversation', c.conversation_id::text,
    ${CONVERSATION_SOURCE_TYPE},
    CASE ${CONVERSATION_SOURCE_TYPE}
      WHEN 'unknown' THEN 'unknown'
      WHEN 'direct_or_organic' THEN 'direct'
      ELSE ${sourcePlatformSql("COALESCE(NULLIF(c.platform,''), NULLIF(c.source,''), NULLIF(c.utm_source,''))")}
    END,
    resolved.destination,
    '', c.provider_message_id, '', c.destination_page_id, '', '', '',
    '', '', '', '', c.campaign_id, c.campaign_name,
    c.adset_id, c.adset_name, c.ad_id, c.ad_name, c.creative_id, c.creative_name, c.placement,
    c.utm_source, c.utm_medium, c.utm_campaign, c.utm_content, c.utm_term, c.referral_source_id, c.ctwa_clid,
    c.attribution_method, c.confidence, c.attribution_scope, c.first_touch_at, c.first_touch_at, c.updated_at,
    CASE WHEN c.attribution_method = 'unknown' AND c.unknown_reason = '' THEN 'historical_evidence_missing' ELSE c.unknown_reason END,
    c.crm_status, c.crm_won, c.revenue
  FROM chatwoot_conversation_attribution c
  CROSS JOIN LATERAL (
    SELECT ${chatwootChannelSql(
      `COALESCE(NULLIF(c.channel,''),
        (SELECT max(x.channel) FROM chatwoot_conversation_attribution x WHERE x.inbox_id = c.inbox_id AND x.channel <> ''))`,
    )} AS destination
  ) resolved`;

function landingSql(entity: "landing_submission" | "landing_visit"): string {
  const submission = entity === "landing_submission";
  return `
  SELECT '${entity}:' || session_id, '${entity}', ${submission ? "COALESCE(submission_id, session_id)" : "session_id"},
    CASE COALESCE(first_attribution_method, 'unknown') WHEN 'unknown' THEN 'unknown'
      ELSE '${submission ? "landing_page_form" : "landing_page_visit"}' END,
    CASE WHEN first_attribution_method = 'direct' THEN 'direct' ELSE ${sourcePlatformSql("first_source")} END,
    'landing_page',
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

export async function eventsCte(): Promise<{ cte: string | null; dashboardRows: boolean }> {
  const sources = await existingSources();
  const parts = [
    sources.leads ? META_LEADS_SQL : "",
    sources.conversations ? CONVERSATIONS_SQL : "",
    sources.landing ? landingSql("landing_submission") : "",
    sources.landing ? landingSql("landing_visit") : "",
  ].filter(Boolean);
  return {
    cte: parts.length
      ? `WITH acquisition_events (${COLUMNS}) AS (${parts.join("\n  UNION ALL\n")})`
      : null,
    dashboardRows: sources.dashboardRows,
  };
}

/** The dashboard's business day. Every acquisition window is a Cairo calendar day, not a UTC one. */
export const BUSINESS_TIME_ZONE = "Africa/Cairo";
const LOCAL_OCCURRED_AT = `(occurred_at AT TIME ZONE '${BUSINESS_TIME_ZONE}')`;

export function where(filters: AcquisitionFilters): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    clauses.push(sql.replace("?", `$${params.length}`));
  };
  if (filters.from && DATE.test(filters.from)) add(`${LOCAL_OCCURRED_AT} >= ?::date`, filters.from);
  if (filters.to && DATE.test(filters.to))
    add(`${LOCAL_OCCURRED_AT} < (?::date + interval '1 day')`, filters.to);
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

/** A synced sheet cell as a number, or 0 when it is blank or not numeric. */
export function numericCell(key: string): string {
  const cell = `replace(btrim(COALESCE(row_data->>'${key}', '')), ',', '')`;
  return `(CASE WHEN ${cell} ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN ${cell}::numeric ELSE 0 END)`;
}

const ISO_DAY = `'^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])'`;

/**
 * A synced ad row's day. Older Meta rows carry their date only in the sheet's
 * `التاريخ` cell and have no stored record_date, so reading record_date alone
 * would drop them from any date window.
 */
export const AD_ROW_DATE = `COALESCE(record_date,
  CASE WHEN row_data->>'التاريخ' ~ ${ISO_DAY} THEN left(row_data->>'التاريخ', 10)::date END,
  CASE WHEN row_data->>'Date' ~ ${ISO_DAY} THEN left(row_data->>'Date', 10)::date END)`;

/**
 * The window and ID filters that also make sense for synced ad-platform rows.
 * Values are validated by DATE and ID above before they are inlined.
 */
export function adRowsWhere(filters: AcquisitionFilters): string {
  const clauses: string[] = [];
  if (filters.from && DATE.test(filters.from))
    clauses.push(`${AD_ROW_DATE} >= '${filters.from}'::date`);
  if (filters.to && DATE.test(filters.to)) clauses.push(`${AD_ROW_DATE} <= '${filters.to}'::date`);
  for (const [key, column] of [
    ["campaignId", "__campaign_id"],
    ["adsetId", "__adset_id"],
    ["adId", "__ad_id"],
  ] as const) {
    const value = filters[key];
    if (value && ID.test(value)) clauses.push(`row_data->>'${column}' = '${value}'`);
  }
  return clauses.map((clause) => ` AND ${clause}`).join("");
}

export interface MetaAggregateLeads {
  available: boolean;
  /** Meta-reported on-Facebook lead-form results. Aggregate only; never individual leads. */
  platformLeads: number;
  campaigns: number;
  from: string | null;
  to: string | null;
  /** Filters that describe individual events and cannot narrow an aggregate report. */
  ignoredFilters: string[];
}

export async function getAcquisitionSummary(filters: AcquisitionFilters = {}) {
  if (!acquisitionDatabaseConfigured()) return { configured: false };
  const { cte, dashboardRows } = await eventsCte();
  if (!cte) return { configured: true, empty: true };
  const { sql, params } = where(filters);
  const adWhere = adRowsWhere(filters);
  const spendCampaigns = dashboardRows
    ? `SELECT DISTINCT row_data->>'__campaign_id' AS campaign_id FROM dashboard_rows
        WHERE dataset IN ('meta_ads','snap_ads') AND COALESCE(row_data->>'__campaign_id','') <> ''
          AND ${numericCell("Spend (Cost)")} > 0${adWhere}`
    : `SELECT NULL::text AS campaign_id WHERE false`;
  const filtered = `${cte}, filtered AS (SELECT * FROM acquisition_events ${sql}), spend_campaigns AS (${spendCampaigns})`;

  const [groups, campaigns, forms, trend, adRows] = await Promise.all([
    getPool().query<Row>(
      `${filtered}
       SELECT entity_type, source_type, destination_channel, source_platform, count(*)::int AS events,
              count(*) FILTER (WHERE attribution_confidence='exact' AND campaign_id<>'')::int AS exact,
              count(*) FILTER (WHERE attribution_confidence='exact' AND campaign_id<>''
                AND campaign_id IN (SELECT campaign_id FROM spend_campaigns))::int AS spend_covered
         FROM filtered GROUP BY 1,2,3,4 ORDER BY events DESC`,
      params,
    ),
    getPool().query<Row>(
      `${filtered}
       SELECT campaign_id, max(campaign_name) AS campaign_name, adset_id, max(adset_name) AS adset_name,
              ad_id, max(ad_name) AS ad_name, entity_type, destination_channel, count(*)::int AS events
         FROM filtered WHERE campaign_id <> '' AND entity_type <> 'landing_visit'
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
       SELECT to_char(date_trunc('day', ${LOCAL_OCCURRED_AT}), 'YYYY-MM-DD') AS date, entity_type, count(*)::int AS events
         FROM filtered WHERE occurred_at IS NOT NULL GROUP BY 1,2 ORDER BY 1`,
      params,
    ),
    dashboardRows
      ? getPool().query<Row>(
          `SELECT count(*) FILTER (WHERE ${numericCell("Spend (Cost)")} > 0)::int AS spend_rows,
                  count(*) FILTER (WHERE dataset = 'meta_ads')::int AS meta_rows,
                  COALESCE(round(sum(${numericCell("Leads (on facebook Leads)")}) FILTER (WHERE dataset = 'meta_ads')), 0)::int AS platform_leads,
                  count(DISTINCT row_data->>'__campaign_id')
                    FILTER (WHERE dataset = 'meta_ads' AND ${numericCell("Leads (on facebook Leads)")} > 0)::int AS lead_campaigns,
                  to_char(min(${AD_ROW_DATE}) FILTER (WHERE dataset = 'meta_ads'), 'YYYY-MM-DD') AS from_date,
                  to_char(max(${AD_ROW_DATE}) FILTER (WHERE dataset = 'meta_ads'), 'YYYY-MM-DD') AS to_date
             FROM dashboard_rows WHERE dataset IN ('meta_ads','snap_ads')${adWhere}`,
        )
      : Promise.resolve({ rows: [] as Row[] }),
  ]);

  const breakdown = groups.rows.map((row) => ({
    entity_type: String(row.entity_type ?? ""),
    source_type: String(row.source_type ?? ""),
    destination_channel: String(row.destination_channel ?? ""),
    source_platform: String(row.source_platform ?? ""),
    events: Number(row.events ?? 0),
    exact: Number(row.exact ?? 0),
    spend_covered: Number(row.spend_covered ?? 0),
  })) satisfies AcquisitionGroup[];
  const ad = adRows.rows[0] ?? {};
  const spendDataAvailable = Number(ad.spend_rows ?? 0) > 0;
  const metaAggregate: MetaAggregateLeads = {
    available: Number(ad.meta_rows ?? 0) > 0,
    platformLeads: Number(ad.platform_leads ?? 0),
    campaigns: Number(ad.lead_campaigns ?? 0),
    from: (ad.from_date as string) || null,
    to: (ad.to_date as string) || null,
    ignoredFilters: (["entityType", "sourceType", "destination", "formId"] as const).filter((key) =>
      Boolean(filters[key]),
    ),
  };

  return {
    configured: true,
    cards: summarizeAcquisitionGroups(breakdown, { spendDataAvailable }),
    breakdown,
    campaigns: campaigns.rows,
    forms: forms.rows,
    trend: trend.rows,
    spendDataAvailable,
    metaAggregate,
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
  const { cte } = await eventsCte();
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
