import {
  AD_ROW_DATE,
  BUSINESS_TIME_ZONE,
  acquisitionDatabaseConfigured,
  adRowsWhere,
  eventsCte,
  getPool,
  numericCell,
  where,
} from "./acquisition-attribution.server";
import { summarizeAcquisitionGroups, type AcquisitionGroup } from "./acquisition-attribution";
import { TRACKED_LANDING_PAGES } from "./landing-pages";
import {
  PERFORMANCE_GRAINS,
  confidenceBucket,
  costPer,
  landingPageForUrl,
  type PerformanceGrain,
} from "./acquisition-performance";

/**
 * Acquisition performance: where today's and this period's leads and messages
 * came from, down to campaign, ad set, ad, creative, landing page and form.
 *
 * Every count is an event from the canonical acquisition layer. A campaign,
 * ad or creative is credited only with events that carry its exact provider ID
 * and exact confidence; nothing is matched by name. Synced Meta ad rows supply
 * spend and Meta's own aggregate lead totals, which are always reported apart
 * from event counts. A Meta creative's landing URL is destination context for
 * a landing page, never proof that a session came from that campaign.
 */

type Row = Record<string, unknown>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const n = (value: unknown): number => Number(value ?? 0) || 0;
const s = (value: unknown): string => (value == null ? "" : String(value));

const GRAIN_KEYS: Record<PerformanceGrain, readonly string[]> = {
  campaign: ["campaign_id"],
  adset: ["campaign_id", "adset_id"],
  ad: ["campaign_id", "adset_id", "ad_id"],
  creative: ["campaign_id", "adset_id", "ad_id", "creative_id"],
};

const NAME_COLUMNS: Record<string, string> = {
  campaign_id: "campaign_name",
  adset_id: "adset_name",
  ad_id: "ad_name",
  creative_id: "creative_name",
};

export function businessToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function resolveRange(from?: string, to?: string): { from: string; to: string } {
  const today = businessToday();
  const end = to && DATE.test(to) ? to : today;
  const start = from && DATE.test(from) ? from : `${end.slice(0, 7)}-01`;
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}

/** Synced Meta ad rows in the window, one row per ad per day. */
function spendRowsSql(range: { from: string; to: string }, dashboardRows: boolean): string {
  if (!dashboardRows) {
    return `SELECT ''::text AS campaign_id, ''::text AS campaign_name, ''::text AS adset_id, ''::text AS adset_name,
              ''::text AS ad_id, ''::text AS ad_name, ''::text AS creative_id, ''::text AS creative_name,
              0::numeric AS spend, 0::numeric AS platform_leads, NULL::date AS day WHERE false`;
  }
  return `SELECT row_data->>'__campaign_id' AS campaign_id,
            COALESCE(NULLIF(row_data->>'اسم الكامبين',''), row_data->>'Campaign Name', '') AS campaign_name,
            COALESCE(row_data->>'__adset_id','') AS adset_id,
            COALESCE(NULLIF(row_data->>'Ad set name',''), row_data->>'Ad Set Name', '') AS adset_name,
            COALESCE(row_data->>'__ad_id','') AS ad_id,
            COALESCE(row_data->>'Ad Name','') AS ad_name,
            COALESCE(NULLIF(row_data->>'__creative_id',''), row_data->>'Creative ID', '') AS creative_id,
            COALESCE(row_data->>'Creative Name','') AS creative_name,
            ${numericCell("Spend (Cost)")} AS spend,
            ${numericCell("Leads (on facebook Leads)")} AS platform_leads,
            ${AD_ROW_DATE} AS day
       FROM dashboard_rows
      WHERE dataset = 'meta_ads' AND COALESCE(row_data->>'__campaign_id','') <> ''${adRowsWhere(range)}`;
}

const EXACT = `attribution_confidence = 'exact' AND campaign_id <> ''`;
const COUNTED = `entity_type IN ('meta_lead','chatwoot_conversation','landing_submission')`;

function grainSql(grain: PerformanceGrain): string {
  const keys = GRAIN_KEYS[grain];
  const keyList = keys.join(", ");
  const names = keys.map((key) => NAME_COLUMNS[key]);
  const spendNames = names.map((name) => `max(NULLIF(${name},'')) AS ${name}`).join(", ");
  const eventNames = names.map((name) => `max(NULLIF(${name},'')) AS ${name}`).join(", ");
  return `
    spend_${grain} AS (
      SELECT ${keyList}, ${spendNames}, sum(spend) AS spend, sum(platform_leads) AS platform_leads
        FROM spend_rows GROUP BY ${keyList}
    ),
    events_${grain} AS (
      SELECT ${keyList}, ${eventNames},
             string_agg(DISTINCT source_platform, ',') AS platforms,
             string_agg(DISTINCT destination_channel, ',') AS destinations,
             string_agg(DISTINCT NULLIF(placement,''), ',') AS placements,
             count(*) FILTER (WHERE entity_type = 'chatwoot_conversation')::int AS conversations,
             count(*) FILTER (WHERE entity_type = 'meta_lead')::int AS meta_leads,
             count(*) FILTER (WHERE entity_type = 'landing_submission')::int AS landing_submissions,
             count(*) FILTER (WHERE entity_type = 'landing_visit')::int AS landing_visits
        FROM filtered WHERE ${EXACT} GROUP BY ${keyList}
    ),
    grain_${grain} AS (
      SELECT ${keyList},
             ${names.map((name) => `COALESCE(e.${name}, sp.${name}, '') AS ${name}`).join(", ")},
             COALESCE(sp.spend, 0) AS spend, sp.spend IS NOT NULL AS has_spend_rows,
             COALESCE(sp.platform_leads, 0) AS platform_leads,
             COALESCE(e.platforms, '') AS platforms, COALESCE(e.destinations, '') AS destinations,
             COALESCE(e.placements, '') AS placements,
             COALESCE(e.conversations, 0) AS conversations, COALESCE(e.meta_leads, 0) AS meta_leads,
             COALESCE(e.landing_submissions, 0) AS landing_submissions,
             COALESCE(e.landing_visits, 0) AS landing_visits
        FROM spend_${grain} sp FULL OUTER JOIN events_${grain} e USING (${keyList})
    )`;
}

export interface PerformanceRow {
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  ad_id: string;
  ad_name: string;
  creative_id: string;
  creative_name: string;
  platforms: string[];
  destinations: string[];
  placements: string[];
  conversations: number;
  meta_leads: number;
  landing_visits: number;
  landing_submissions: number;
  exact_acquisitions: number;
  spend: number;
  has_spend_rows: boolean;
  platform_leads_aggregate: number;
  cost_per_acquisition: number | null;
}

function performanceRow(row: Row): PerformanceRow {
  const exact = n(row.conversations) + n(row.meta_leads) + n(row.landing_submissions);
  const list = (value: unknown) => s(value).split(",").filter(Boolean);
  return {
    campaign_id: s(row.campaign_id),
    campaign_name: s(row.campaign_name),
    adset_id: s(row.adset_id),
    adset_name: s(row.adset_name),
    ad_id: s(row.ad_id),
    ad_name: s(row.ad_name),
    creative_id: s(row.creative_id),
    creative_name: s(row.creative_name),
    platforms: list(row.platforms),
    destinations: list(row.destinations),
    placements: list(row.placements),
    conversations: n(row.conversations),
    meta_leads: n(row.meta_leads),
    landing_visits: n(row.landing_visits),
    landing_submissions: n(row.landing_submissions),
    exact_acquisitions: exact,
    spend: Math.round(n(row.spend) * 100) / 100,
    has_spend_rows: row.has_spend_rows === true,
    platform_leads_aggregate: Math.round(n(row.platform_leads)),
    cost_per_acquisition: costPer(n(row.spend), exact),
  };
}

async function blockers() {
  const pool = getPool();
  const table = async (name: string) =>
    Boolean(
      (await pool.query<Row>(`SELECT to_regclass($1) AS present`, [`public.${name}`])).rows[0]
        ?.present,
    );
  const [touches, messageEvents, leadgenEvents, leadRows, crmLinks] = await Promise.all([
    table("chatwoot_attribution_touches"),
    table("meta_message_attribution_events"),
    table("meta_leadgen_events"),
    table("meta_lead_acquisitions"),
    table("acquisition_crm_links"),
  ]);
  const one = async (present: boolean, sql: string) =>
    present ? ((await pool.query<Row>(sql)).rows[0] ?? {}) : {};
  const [touch, message, leadgen, leads, carried] = await Promise.all([
    one(
      touches,
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE referral_source_id <> '' OR ctwa_clid <> '' OR referral_source_url <> '')::int AS with_referral,
              max(occurred_at) AS latest
         FROM chatwoot_attribution_touches`,
    ),
    one(
      messageEvents,
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'resolved')::int AS resolved,
              max(received_at) AS latest FROM meta_message_attribution_events`,
    ),
    one(
      leadgenEvents,
      `SELECT count(*)::int AS total, max(received_at) AS latest FROM meta_leadgen_events`,
    ),
    one(leadRows, `SELECT count(*)::int AS total FROM meta_lead_acquisitions`),
    one(
      crmLinks,
      `SELECT count(*)::int AS total FROM acquisition_crm_links
        WHERE is_primary AND match_method = 'crm_carried_provider_lead_id'`,
    ),
  ]);
  const leadAdsTokenConfigured = Boolean(process.env.META_LEAD_ADS_ACCESS_TOKEN?.trim());
  const items: { id: string; ok: boolean; en: string; ar: string }[] = [
    {
      id: "chatwoot_referral_evidence",
      ok: n(touch.with_referral) > 0,
      en: `Chatwoot deliveries with a Meta referral: ${n(touch.with_referral)} of ${n(touch.total)} recorded touches. Without referral data from Chatwoot, WhatsApp, Messenger and Instagram conversations stay unknown.`,
      ar: `رسائل Chatwoot التي تحمل إحالة Meta: ${n(touch.with_referral)} من ${n(touch.total)} لمسة مسجلة. بدون بيانات الإحالة تبقى محادثات واتساب وماسنجر وإنستغرام غير معروفة.`,
    },
    {
      id: "meta_message_listener",
      ok: n(message.resolved) > 0,
      en: `Meta messaging listener: deliveries received ${n(message.total)}, resolved to an exact campaign ${n(message.resolved)}. No real WhatsApp/Messenger/Instagram delivery has been resolved yet.`,
      ar: `مستقبل رسائل Meta: ${n(message.total)} رسالة مستلمة، ${n(message.resolved)} حُلّت إلى حملة دقيقة. لم تُحل أي رسالة حقيقية بعد.`,
    },
    {
      id: "meta_lead_ads",
      ok: n(leads.total) > 0 || n(carried.total) > 0,
      en: leadAdsTokenConfigured
        ? `Meta Lead Ads: ${n(leadgen.total)} webhook events and ${n(leads.total)} lead records stored; ${n(carried.total)} more instant-form leads carried into the CRM with their Meta lead ID.`
        : `Meta Lead Ads: META_LEAD_ADS_ACCESS_TOKEN is not configured, so no form ID or answers arrive from Meta directly. ${n(carried.total)} instant-form leads are still exact through the Meta lead and ad IDs the CRM integration carries; the form ID stays unknown for them.`,
      ar: leadAdsTokenConfigured
        ? `Meta Lead Ads: ${n(leadgen.total)} حدث webhook و${n(leads.total)} سجل عميل، و${n(carried.total)} عميل نموذج آخر وصل إلى CRM بمعرّف عميل Meta.`
        : `Meta Lead Ads: لم يُضبط META_LEAD_ADS_ACCESS_TOKEN، لذلك لا يصل معرّف النموذج أو الإجابات من Meta مباشرة. ${n(carried.total)} عميل نموذج ما زالوا دقيقين عبر معرّف عميل Meta ومعرّف الإعلان المحمولين في CRM، ويبقى معرّف النموذج غير معروف لهم.`,
    },
  ];
  return items;
}

async function buildWindow(range: { from: string; to: string }, detailed: boolean) {
  const { cte, dashboardRows } = await eventsCte();
  if (!cte) return null;
  const pool = getPool();
  const { sql, params } = where(range);
  const base = `${cte},
    filtered AS (SELECT * FROM acquisition_events ${sql}),
    spend_rows AS (${spendRowsSql(range, dashboardRows)}),
    ${PERFORMANCE_GRAINS.map(grainSql).join(",")}`;

  const grainQuery = (grain: PerformanceGrain) =>
    pool.query<Row>(
      `${base} SELECT * FROM grain_${grain}
        ORDER BY (conversations + meta_leads + landing_submissions) DESC, spend DESC LIMIT 2000`,
      params,
    );

  const [groups, confidence, unmatched, spendTotals, messaging, matrix, forms, landing] =
    await Promise.all([
      pool.query<Row>(
        `${base} SELECT entity_type, source_type, destination_channel, source_platform, count(*)::int AS events,
                count(*) FILTER (WHERE ${EXACT})::int AS exact,
                count(*) FILTER (WHERE ${EXACT} AND campaign_id IN (SELECT campaign_id FROM spend_rows WHERE spend > 0))::int AS spend_covered
           FROM filtered GROUP BY 1,2,3,4`,
        params,
      ),
      pool.query<Row>(
        `${base} SELECT attribution_confidence, (campaign_id <> '') AS has_campaign, count(*)::int AS events
           FROM filtered WHERE ${COUNTED} GROUP BY 1,2`,
        params,
      ),
      pool.query<Row>(
        `${base} SELECT
            count(*) FILTER (WHERE ${COUNTED} AND NOT (${EXACT}))::int AS without_exact_campaign,
            count(*) FILTER (WHERE ${COUNTED} AND ${EXACT}
              AND campaign_id NOT IN (SELECT campaign_id FROM spend_rows))::int AS exact_without_spend_rows,
            (SELECT count(*) FROM grain_campaign WHERE spend > 0
              AND conversations + meta_leads + landing_submissions = 0)::int AS spending_campaigns_without_acquisitions,
            (SELECT COALESCE(sum(spend), 0) FROM grain_campaign WHERE spend > 0
              AND conversations + meta_leads + landing_submissions = 0) AS spend_without_acquisitions
           FROM filtered`,
        params,
      ),
      pool.query<Row>(
        `${base} SELECT COALESCE(sum(spend), 0) AS spend, COALESCE(sum(platform_leads), 0) AS platform_leads,
                count(DISTINCT campaign_id) FILTER (WHERE platform_leads > 0)::int AS lead_campaigns,
                count(*)::int AS rows, to_char(max(day), 'YYYY-MM-DD') AS latest_day,
                (SELECT COALESCE(sum(spend), 0) FROM grain_campaign
                  WHERE conversations + meta_leads + landing_submissions > 0) AS covered_spend
           FROM spend_rows`,
        params,
      ),
      pool.query<Row>(
        `${base} SELECT destination_channel,
                CASE WHEN source_type LIKE 'meta\\_%\\_referral' THEN 'meta_referral'
                     WHEN source_type IN ('website_chat','direct_or_organic') THEN source_type
                     ELSE 'unknown' END AS source_category,
                count(*)::int AS conversations, count(*) FILTER (WHERE ${EXACT})::int AS exact
           FROM filtered WHERE entity_type = 'chatwoot_conversation' GROUP BY 1,2`,
        params,
      ),
      pool.query<Row>(
        `${base} SELECT source_platform, destination_channel, entity_type, source_type = 'unknown' AS unknown,
                count(*)::int AS events, count(*) FILTER (WHERE ${EXACT})::int AS exact,
                COALESCE(array_agg(DISTINCT campaign_id) FILTER (WHERE ${EXACT}), '{}') AS campaigns
           FROM filtered GROUP BY 1,2,3,4`,
        params,
      ),
      pool.query<Row>(
        `${base}, ad_spend AS (SELECT ad_id, sum(spend) AS spend FROM spend_rows GROUP BY ad_id)
         SELECT f.form_id, max(f.form_name) AS form_name, max(f.page_id) AS page_id, max(f.page_name) AS page_name,
                f.campaign_id, max(f.campaign_name) AS campaign_name, f.adset_id, max(f.adset_name) AS adset_name,
                f.ad_id, max(f.ad_name) AS ad_name, f.creative_id, max(f.creative_name) AS creative_name,
                count(*)::int AS leads, count(*) FILTER (WHERE f.attribution_confidence = 'exact' AND f.campaign_id <> '')::int AS exact_leads,
                count(*) FILTER (WHERE f.attribution_scope = 'organic')::int AS organic_leads,
                max(a.spend) AS ad_spend
           FROM filtered f LEFT JOIN ad_spend a ON a.ad_id <> '' AND a.ad_id = f.ad_id
          WHERE f.entity_type = 'meta_lead'
          GROUP BY f.form_id, f.campaign_id, f.adset_id, f.ad_id, f.creative_id
          ORDER BY leads DESC LIMIT 2000`,
        params,
      ),
      landingWindow(range, detailed),
    ]);

  // Today's summary needs only the campaign and creative leaders.
  const grainsToQuery: readonly PerformanceGrain[] = detailed
    ? PERFORMANCE_GRAINS
    : ["campaign", "creative"];
  const grainResults = await Promise.all(grainsToQuery.map(grainQuery));
  const hierarchy = Object.fromEntries(
    PERFORMANCE_GRAINS.map((grain) => [grain, [] as PerformanceRow[]]),
  ) as Record<PerformanceGrain, PerformanceRow[]>;
  grainsToQuery.forEach((grain, index) => {
    hierarchy[grain] = grainResults[index].rows.map(performanceRow);
  });

  const breakdown = groups.rows.map((row) => ({
    entity_type: s(row.entity_type),
    source_type: s(row.source_type),
    destination_channel: s(row.destination_channel),
    source_platform: s(row.source_platform),
    events: n(row.events),
    exact: n(row.exact),
    spend_covered: n(row.spend_covered),
  })) satisfies AcquisitionGroup[];
  const spend = spendTotals.rows[0] ?? {};
  const spendDataAvailable = n(spend.rows) > 0;
  const cards = summarizeAcquisitionGroups(breakdown, { spendDataAvailable });

  const confidenceCounts = { exact: 0, declared: 0, inferred: 0, unknown: 0 };
  for (const row of confidence.rows) {
    confidenceCounts[confidenceBucket(s(row.attribution_confidence), row.has_campaign === true)] +=
      n(row.events);
  }

  const campaignSpend = new Map(
    hierarchy.campaign.map((row) => [row.campaign_id, row.spend] as const),
  );
  const matrixCells = new Map<
    string,
    {
      source_platform: string;
      destination_channel: string;
      events: number;
      exact: number;
      unknown: number;
      landing_visits: number;
      landing_submissions: number;
      campaigns: Set<string>;
    }
  >();
  for (const row of matrix.rows) {
    const key = `${s(row.source_platform)}|${s(row.destination_channel)}`;
    const cell = matrixCells.get(key) ?? {
      source_platform: s(row.source_platform),
      destination_channel: s(row.destination_channel),
      events: 0,
      exact: 0,
      unknown: 0,
      landing_visits: 0,
      landing_submissions: 0,
      campaigns: new Set<string>(),
    };
    if (s(row.entity_type) === "landing_visit") cell.landing_visits += n(row.events);
    else {
      cell.events += n(row.events);
      cell.exact += n(row.exact);
      if (row.unknown === true) cell.unknown += n(row.events);
    }
    if (s(row.entity_type) === "landing_submission") cell.landing_submissions += n(row.events);
    for (const id of (row.campaigns as string[]) ?? []) if (id) cell.campaigns.add(id);
    matrixCells.set(key, cell);
  }

  const exactAcquisitions = cards.exactAttribution;
  const coveredSpend = n(spend.covered_spend);
  const channels = cards.conversationsByChannel;

  return {
    period: range,
    kpis: {
      ...cards,
      whatsappConversations: channels.whatsapp ?? 0,
      messengerConversations: channels.messenger ?? 0,
      instagramConversations: channels.instagram_dm ?? 0,
      websiteConversations: channels.website_chat ?? 0,
      landingViews: landing.totals.views,
      landingUniqueVisitors: landing.totals.uniqueVisitors,
      landingSessions: landing.totals.sessions,
      landingFormStarts: landing.totals.formStarts,
      landingPageSubmissions: landing.totals.submissions,
      spend: spendDataAvailable ? Math.round(n(spend.spend) * 100) / 100 : null,
      spendThrough: s(spend.latest_day) || null,
      spendCoveredSpend: spendDataAvailable ? Math.round(coveredSpend * 100) / 100 : null,
      costPerExactAcquisition: spendDataAvailable ? costPer(coveredSpend, exactAcquisitions) : null,
    },
    confidence: confidenceCounts,
    metaAggregate: {
      available: spendDataAvailable,
      platformLeads: Math.round(n(spend.platform_leads)),
      campaigns: n(spend.lead_campaigns),
    },
    unmatched: {
      withoutExactCampaign: n(unmatched.rows[0]?.without_exact_campaign),
      exactWithoutSpendRows: n(unmatched.rows[0]?.exact_without_spend_rows),
      spendingCampaignsWithoutAcquisitions: n(
        unmatched.rows[0]?.spending_campaigns_without_acquisitions,
      ),
      spendWithoutAcquisitions:
        Math.round(n(unmatched.rows[0]?.spend_without_acquisitions) * 100) / 100,
    },
    hierarchy,
    messaging: messaging.rows.map((row) => ({
      destination_channel: s(row.destination_channel),
      source_category: s(row.source_category),
      conversations: n(row.conversations),
      exact: n(row.exact),
    })),
    matrix: [...matrixCells.values()].map((cell) => {
      const cellSpend = [...cell.campaigns].reduce(
        (sum, id) => sum + (campaignSpend.get(id) ?? 0),
        0,
      );
      return {
        source_platform: cell.source_platform,
        destination_channel: cell.destination_channel,
        events: cell.events,
        exact: cell.exact,
        unknown: cell.unknown,
        landing_visits: cell.landing_visits,
        exact_campaigns: cell.campaigns.size,
        spend: Math.round(cellSpend * 100) / 100,
        conversion_rate:
          cell.destination_channel === "landing_page" && cell.landing_visits > 0
            ? cell.landing_submissions / cell.landing_visits
            : null,
      };
    }),
    forms: forms.rows.map((row) => ({
      form_id: s(row.form_id),
      form_name: s(row.form_name),
      page_id: s(row.page_id),
      page_name: s(row.page_name),
      campaign_id: s(row.campaign_id),
      campaign_name: s(row.campaign_name),
      adset_id: s(row.adset_id),
      adset_name: s(row.adset_name),
      ad_id: s(row.ad_id),
      ad_name: s(row.ad_name),
      creative_id: s(row.creative_id),
      creative_name: s(row.creative_name),
      leads: n(row.leads),
      exact_leads: n(row.exact_leads),
      organic_leads: n(row.organic_leads),
      ad_spend: row.ad_spend == null ? null : Math.round(n(row.ad_spend) * 100) / 100,
    })),
    aggregateLeadsByCampaign: hierarchy.campaign
      .filter((row) => row.platform_leads_aggregate > 0)
      .map((row) => ({
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name,
        platform_leads: row.platform_leads_aggregate,
        spend: row.spend,
      }))
      .sort((a, b) => b.platform_leads - a.platform_leads),
    landing,
  };
}

async function landingWindow(range: { from: string; to: string }, detailed: boolean) {
  const pool = getPool();
  const present = Boolean(
    (await pool.query<Row>(`SELECT to_regclass('public.landing_attribution_sessions') AS t`))
      .rows[0]?.t,
  );
  const empty = {
    totals: { views: 0, uniqueVisitors: 0, sessions: 0, formStarts: 0, submissions: 0 },
    pages: [] as ReturnType<typeof landingPageRow>[],
    breakdown: [] as Row[],
    sessions: [] as Row[],
  };
  if (!present) return { ...empty, pointingCampaigns: [], unresolvedCreativeUrls: 0 };
  const local = (column: string) => `(${column} AT TIME ZONE '${BUSINESS_TIME_ZONE}')`;
  const inWindow = (column: string) =>
    `${column} IS NOT NULL AND ${local(column)} >= $1::date AND ${local(column)} < ($2::date + interval '1 day')`;
  const base = `WITH s AS (
      SELECT *, (${inWindow("first_seen")}) AS seen_in, (${inWindow("form_started_at")}) AS started_in,
             (${inWindow("submitted_at")}) AS submitted_in
        FROM landing_attribution_sessions
       WHERE (${inWindow("first_seen")}) OR (${inWindow("submitted_at")}) OR (${inWindow("form_started_at")})
    )`;
  const measures = `COALESCE(sum(view_count) FILTER (WHERE seen_in), 0)::int AS views,
      count(DISTINCT visitor_id) FILTER (WHERE seen_in)::int AS unique_visitors,
      count(*) FILTER (WHERE seen_in)::int AS sessions,
      count(*) FILTER (WHERE started_in)::int AS form_starts,
      count(*) FILTER (WHERE submitted_in)::int AS submissions,
      count(*) FILTER (WHERE submitted_in AND first_attribution_method IN ('utm','tracking_token'))::int AS declared_submissions,
      count(*) FILTER (WHERE submitted_in AND first_attribution_method = 'referrer')::int AS inferred_submissions`;
  const values = [range.from, range.to];
  const [totals, pages, breakdown, sessions, creativeUrls] = await Promise.all([
    pool.query<Row>(`${base} SELECT ${measures} FROM s`, values),
    pool.query<Row>(
      `${base} SELECT landing_page_id, max(landing_page_name) AS landing_page_name,
              max(landing_page_slug) AS landing_page_slug, ${measures}
         FROM s GROUP BY landing_page_id`,
      values,
    ),
    pool.query<Row>(
      `${base} SELECT landing_page_id, COALESCE(first_source,'') AS source, COALESCE(first_medium,'') AS medium,
              COALESCE(first_campaign,'') AS campaign, COALESCE(first_content,'') AS content,
              COALESCE(first_attribution_method,'unknown') AS method, ${measures}
         FROM s GROUP BY 1,2,3,4,5,6 ORDER BY submissions DESC, sessions DESC LIMIT 1000`,
      values,
    ),
    detailed
      ? pool.query<Row>(
          `${base} SELECT session_id, landing_page_id, to_char(first_seen AT TIME ZONE '${BUSINESS_TIME_ZONE}', 'YYYY-MM-DD HH24:MI') AS first_seen,
                  COALESCE(first_source,'') AS source, COALESCE(first_medium,'') AS medium,
                  COALESCE(first_campaign,'') AS campaign, COALESCE(first_content,'') AS content,
                  COALESCE(first_attribution_method,'unknown') AS method, COALESCE(first_referrer_type,'') AS referrer_type,
                  view_count, form_started_at IS NOT NULL AS form_started, submitted_at IS NOT NULL AS submitted
             FROM s ORDER BY first_seen DESC NULLS LAST LIMIT 500`,
          values,
        )
      : Promise.resolve({ rows: [] as Row[] }),
    pool
      .query<Row>(
        `SELECT DISTINCT row_data->>'__campaign_id' AS campaign_id,
              COALESCE(row_data->>'Campaign Name','') AS campaign_name,
              row_data->>'Creative Landing Page URL' AS url
         FROM dashboard_rows
        WHERE dataset = 'meta_ad_creatives' AND COALESCE(row_data->>'Creative Landing Page URL','') <> ''
          AND COALESCE(row_data->>'__campaign_id','') <> ''`,
      )
      .catch(() => ({ rows: [] as Row[] })),
  ]);

  const pointing = new Map<string, Map<string, string>>();
  let unresolvedCreativeUrls = 0;
  for (const row of creativeUrls.rows) {
    const page = landingPageForUrl(s(row.url), TRACKED_LANDING_PAGES);
    if (page === null) {
      if (/engosoft\.com\/r\//i.test(s(row.url))) unresolvedCreativeUrls += 1;
      continue;
    }
    const campaigns = pointing.get(page) ?? new Map<string, string>();
    campaigns.set(s(row.campaign_id), s(row.campaign_name));
    pointing.set(page, campaigns);
  }

  const byId = new Map(pages.rows.map((row) => [s(row.landing_page_id), row]));
  const pageRows = [
    ...TRACKED_LANDING_PAGES.map((page) =>
      landingPageRow(byId.get(page.id) ?? { landing_page_id: page.id }, page.name, page.slug),
    ),
    ...pages.rows
      .filter((row) => !TRACKED_LANDING_PAGES.some((page) => page.id === s(row.landing_page_id)))
      .map((row) => landingPageRow(row, s(row.landing_page_name), s(row.landing_page_slug))),
  ];
  const t = totals.rows[0] ?? {};
  return {
    totals: {
      views: n(t.views),
      uniqueVisitors: n(t.unique_visitors),
      sessions: n(t.sessions),
      formStarts: n(t.form_starts),
      submissions: n(t.submissions),
    },
    pages: pageRows,
    breakdown: breakdown.rows,
    sessions: sessions.rows,
    pointingCampaigns: [...pointing.entries()].map(([pageId, campaigns]) => ({
      landing_page_id: pageId,
      campaigns: [...campaigns.entries()].map(([campaign_id, campaign_name]) => ({
        campaign_id,
        campaign_name,
      })),
    })),
    unresolvedCreativeUrls,
  };
}

function landingPageRow(row: Row, name: string, slug: string) {
  const sessions = n(row.sessions);
  const submissions = n(row.submissions);
  return {
    landing_page_id: s(row.landing_page_id),
    landing_page_name: name || s(row.landing_page_id),
    landing_page_slug: slug,
    views: n(row.views),
    unique_visitors: n(row.unique_visitors),
    sessions,
    form_starts: n(row.form_starts),
    submissions,
    declared_submissions: n(row.declared_submissions),
    inferred_submissions: n(row.inferred_submissions),
    // Landing sessions carry UTM or referrer evidence, never provider-issued IDs.
    exact_submissions: 0,
    conversion_rate: sessions > 0 ? submissions / sessions : null,
  };
}

type AcquisitionPerformance = Awaited<ReturnType<typeof computeAcquisitionPerformance>>;

/** The page is public and one response runs dozens of queries; a refresh storm must not reach the database. */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: Promise<AcquisitionPerformance> }>();

export async function getAcquisitionPerformance(filters: { from?: string; to?: string } = {}) {
  if (!acquisitionDatabaseConfigured()) return { configured: false as const };
  const range = resolveRange(filters.from, filters.to);
  const key = `${range.from}|${range.to}|${businessToday()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = computeAcquisitionPerformance(range);
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  for (const [entry, { at }] of cache) if (Date.now() - at >= CACHE_TTL_MS) cache.delete(entry);
  return value;
}

async function computeAcquisitionPerformance(range: { from: string; to: string }) {
  const today = businessToday();
  const [window, todayWindow, providerBlockers] = await Promise.all([
    buildWindow(range, true),
    buildWindow({ from: today, to: today }, false),
    blockers(),
  ]);
  if (!window || !todayWindow) return { configured: true as const, empty: true as const };

  const top = <T>(rows: T[], score: (row: T) => number): T | null => {
    const best = [...rows].sort((a, b) => score(b) - score(a))[0];
    return best && score(best) > 0 ? best : null;
  };
  const todayPage = top(todayWindow.landing.pages, (row) => row.submissions * 1000 + row.views);
  const todayForm = top(
    Object.values(
      todayWindow.forms.reduce<
        Record<string, { form_id: string; form_name: string; leads: number }>
      >((acc, row) => {
        const item = acc[row.form_id] ?? {
          form_id: row.form_id,
          form_name: row.form_name,
          leads: 0,
        };
        item.leads += row.leads;
        acc[row.form_id] = item;
        return acc;
      }, {}),
    ),
    (row) => row.leads,
  );

  return {
    configured: true as const,
    businessTimeZone: BUSINESS_TIME_ZONE,
    generatedAt: new Date().toISOString(),
    ...window,
    today: {
      date: today,
      kpis: todayWindow.kpis,
      confidence: todayWindow.confidence,
      topCampaign: top(todayWindow.hierarchy.campaign, (row) => row.exact_acquisitions),
      topCreative: top(
        todayWindow.hierarchy.creative.filter((row) => row.creative_id),
        (row) => row.exact_acquisitions,
      ),
      topLandingPage: todayPage,
      topMetaLeadForm: todayForm,
    },
    blockers: providerBlockers,
  };
}
