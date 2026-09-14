import {
  BUSINESS_TIME_ZONE,
  acquisitionDatabaseConfigured,
  eventsCte,
  getPool,
  numericCell,
  adRowsWhere,
  AD_ROW_DATE,
  where,
} from "./acquisition-attribution.server";
import {
  CLOSED_LOOP_GRAINS,
  addFact,
  closedLoopFunnel,
  coverageOf,
  creativeAssets,
  crmOutcome,
  emptyMetrics,
  finalizeMetrics,
  linkAcquisitionsToCrm,
  rankByLeadQuality,
  rollupByGrain,
  type AcquisitionFactRow,
  type AcquisitionIdentity,
  type AttributionConfidence,
  type ClosedLoopGrain,
  type CreativeAsset,
  type CrmOutcome,
  type CrmRecord,
  type GrainRow,
  type MatchConfidence,
  type PaidInvoiceLine,
  type QualityMetrics,
  type SaleOrderLink,
  type SpendRow,
} from "./closed-loop";

/**
 * Closed-loop Marketing → Sales identity graph.
 *
 * A scheduled refresh materialises five small tables from data the dashboard
 * already syncs plus one Odoo read (sales orders with their opportunity):
 *
 *   meta_entity_graph      Account → Campaign → Ad Set → Ad → Creative, by ad ID
 *   meta_creative_assets   provider video IDs / image hashes per creative (reporting only)
 *   crm_lead_outcomes      lifecycle, orders, invoices and paid revenue per CRM record
 *   crm_sale_order_links   sale.order → opportunity (the deterministic revenue link)
 *   acquisition_crm_links  acquisition_event_id → CRM record, with method and confidence
 *
 * Reads join those tables to the canonical acquisition events. Nothing here
 * matches on a name, and no personal data (phone, email, contact name) is
 * stored in these tables or returned by the read model.
 */

type Row = Record<string, unknown>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const s = (value: unknown): string => (value == null ? "" : String(value).trim());
const n = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

let schemaReady: Promise<void> | null = null;

export function ensureClosedLoopSchema(): Promise<void> {
  schemaReady ??= getPool()
    .query(
      `CREATE TABLE IF NOT EXISTS meta_entity_graph (
         ad_id text PRIMARY KEY,
         ad_name text NOT NULL DEFAULT '',
         account_id text NOT NULL DEFAULT '',
         campaign_id text NOT NULL DEFAULT '',
         campaign_name text NOT NULL DEFAULT '',
         adset_id text NOT NULL DEFAULT '',
         adset_name text NOT NULL DEFAULT '',
         creative_id text NOT NULL DEFAULT '',
         creative_name text NOT NULL DEFAULT '',
         media_type text NOT NULL DEFAULT '',
         headline text NOT NULL DEFAULT '',
         thumbnail_url text NOT NULL DEFAULT '',
         image_url text NOT NULL DEFAULT '',
         video_id text NOT NULL DEFAULT '',
         image_hash text NOT NULL DEFAULT '',
         effective_object_story_id text NOT NULL DEFAULT '',
         source_post_id text NOT NULL DEFAULT '',
         landing_page_url text NOT NULL DEFAULT '',
         permalink_url text NOT NULL DEFAULT '',
         refreshed_at timestamptz NOT NULL DEFAULT now()
       );
       CREATE INDEX IF NOT EXISTS meta_entity_graph_creative_idx ON meta_entity_graph (creative_id);
       CREATE INDEX IF NOT EXISTS meta_entity_graph_campaign_idx ON meta_entity_graph (campaign_id, adset_id);

       CREATE TABLE IF NOT EXISTS meta_creative_assets (
         creative_id text NOT NULL,
         ad_id text NOT NULL DEFAULT '',
         asset_type text NOT NULL,
         asset_id text NOT NULL,
         video_id text NOT NULL DEFAULT '',
         image_hash text NOT NULL DEFAULT '',
         asset_url text NOT NULL DEFAULT '',
         thumbnail_url text NOT NULL DEFAULT '',
         attribution_level text NOT NULL DEFAULT 'reporting',
         PRIMARY KEY (creative_id, asset_type, asset_id)
       );

       CREATE TABLE IF NOT EXISTS crm_sale_order_links (
         sale_order_id text PRIMARY KEY,
         sale_order_name text NOT NULL,
         opportunity_id text NOT NULL,
         state text NOT NULL DEFAULT '',
         date_order timestamptz,
         refreshed_at timestamptz NOT NULL DEFAULT now()
       );
       CREATE INDEX IF NOT EXISTS crm_sale_order_links_opportunity_idx ON crm_sale_order_links (opportunity_id);

       CREATE TABLE IF NOT EXISTS crm_lead_outcomes (
         crm_lead_id text PRIMARY KEY,
         record_type text NOT NULL DEFAULT '',
         business_status text NOT NULL DEFAULT '',
         stage_key text NOT NULL DEFAULT '',
         salesperson text NOT NULL DEFAULT '',
         sales_team text NOT NULL DEFAULT '',
         course text NOT NULL DEFAULT '',
         source text NOT NULL DEFAULT '',
         facebook_lead_id text NOT NULL DEFAULT '',
         ad_id text NOT NULL DEFAULT '',
         crm_campaign_id text NOT NULL DEFAULT '',
         created_at timestamptz,
         won_at timestamptz,
         interested boolean NOT NULL DEFAULT false,
         qualified boolean NOT NULL DEFAULT false,
         quotation boolean NOT NULL DEFAULT false,
         won boolean NOT NULL DEFAULT false,
         lost boolean NOT NULL DEFAULT false,
         sale_order_ids text[] NOT NULL DEFAULT '{}',
         invoice_count integer NOT NULL DEFAULT 0,
         revenue_paid_usd numeric NOT NULL DEFAULT 0,
         first_invoice_at date,
         refreshed_at timestamptz NOT NULL DEFAULT now()
       );
       CREATE INDEX IF NOT EXISTS crm_lead_outcomes_fb_idx ON crm_lead_outcomes (facebook_lead_id);

       CREATE TABLE IF NOT EXISTS acquisition_crm_links (
         id bigserial PRIMARY KEY,
         acquisition_event_id text NOT NULL,
         crm_lead_id text NOT NULL,
         crm_opportunity_id text NOT NULL DEFAULT '',
         partner_id text NOT NULL DEFAULT '',
         chatwoot_conversation_id text NOT NULL DEFAULT '',
         chatwoot_contact_id text NOT NULL DEFAULT '',
         provider_lead_id text NOT NULL DEFAULT '',
         landing_submission_id text NOT NULL DEFAULT '',
         match_method text NOT NULL,
         match_confidence text NOT NULL,
         is_primary boolean NOT NULL DEFAULT false,
         matched_at timestamptz NOT NULL DEFAULT now(),
         UNIQUE (acquisition_event_id, crm_lead_id)
       );
       CREATE UNIQUE INDEX IF NOT EXISTS acquisition_crm_links_primary_idx
         ON acquisition_crm_links (acquisition_event_id) WHERE is_primary;
       CREATE INDEX IF NOT EXISTS acquisition_crm_links_crm_idx ON acquisition_crm_links (crm_lead_id);

       CREATE TABLE IF NOT EXISTS closed_loop_refresh_state (
         id integer PRIMARY KEY DEFAULT 1,
         started_at timestamptz,
         finished_at timestamptz,
         status text NOT NULL DEFAULT 'never',
         summary jsonb NOT NULL DEFAULT '{}'::jsonb,
         last_error text NOT NULL DEFAULT ''
       );`,
    )
    .then(() => undefined)
    .catch((error) => {
      schemaReady = null;
      throw error;
    });
  return schemaReady;
}

/* --- refresh ---------------------------------------------------------------- */

interface GraphRow {
  adId: string;
  adName: string;
  accountId: string;
  campaignId: string;
  campaignName: string;
  adsetId: string;
  adsetName: string;
  creativeId: string;
  creativeName: string;
  mediaType: string;
  headline: string;
  thumbnailUrl: string;
  imageUrl: string;
  videoId: string;
  imageHash: string;
  effectiveObjectStoryId: string;
  sourcePostId: string;
  landingPageUrl: string;
  permalinkUrl: string;
  feedAssets: { type: "video" | "image"; id: string; url?: string; thumbnailUrl?: string }[];
}

async function loadMetaGraph(): Promise<GraphRow[]> {
  const pool = getPool();
  const [creatives, ads] = await Promise.all([
    pool.query<Row>(
      `SELECT row_data FROM dashboard_rows WHERE dataset = 'meta_ad_creatives'
         AND COALESCE(row_data->>'__ad_id','') <> ''`,
    ),
    pool.query<Row>(
      `SELECT DISTINCT ON (row_data->>'__ad_id') row_data
         FROM dashboard_rows
        WHERE dataset = 'meta_ads' AND COALESCE(row_data->>'__ad_id','') <> ''
        ORDER BY row_data->>'__ad_id', ${AD_ROW_DATE} DESC NULLS LAST`,
    ),
  ]);
  const graph = new Map<string, GraphRow>();
  const blank = (adId: string): GraphRow => ({
    adId,
    adName: "",
    accountId: "",
    campaignId: "",
    campaignName: "",
    adsetId: "",
    adsetName: "",
    creativeId: "",
    creativeName: "",
    mediaType: "",
    headline: "",
    thumbnailUrl: "",
    imageUrl: "",
    videoId: "",
    imageHash: "",
    effectiveObjectStoryId: "",
    sourcePostId: "",
    landingPageUrl: "",
    permalinkUrl: "",
    feedAssets: [],
  });
  // Ad insight rows first: they carry the hierarchy for every delivered ad.
  for (const { row_data } of ads.rows) {
    const r = row_data as Row;
    const adId = s(r.__ad_id);
    const row = blank(adId);
    row.adName = s(r["Ad Name"]);
    row.accountId = s(r.__account_id);
    row.campaignId = s(r.__campaign_id);
    row.campaignName = s(r["اسم الكامبين"]) || s(r["Campaign Name"]);
    row.adsetId = s(r.__adset_id);
    row.adsetName = s(r["Ad set name"]) || s(r["Ad Set Name"]);
    row.creativeId = s(r.__creative_id) || s(r["Creative ID"]);
    row.creativeName = s(r["Creative Name"]);
    graph.set(adId, row);
  }
  // Creative sync rows are the authority for creative identity and media.
  for (const { row_data } of creatives.rows) {
    const r = row_data as Row;
    const adId = s(r.__ad_id);
    const row = graph.get(adId) ?? blank(adId);
    row.adName = s(r["Ad Name"]) || row.adName;
    row.accountId = s(r.__account_id) || row.accountId;
    row.campaignId = s(r.__campaign_id) || row.campaignId;
    row.campaignName = s(r["Campaign Name"]) || row.campaignName;
    row.adsetId = s(r.__adset_id) || row.adsetId;
    row.adsetName = s(r["Ad Set Name"]) || row.adsetName;
    row.creativeId = s(r.__creative_id) || s(r["Creative ID"]) || row.creativeId;
    row.creativeName = s(r["Creative Name"]) || row.creativeName;
    row.mediaType = s(r["Media Type"]) || s(r["Creative Type"]);
    row.headline = s(r["Creative Headline"]);
    row.thumbnailUrl = s(r["Creative Thumbnail URL"]);
    row.imageUrl = s(r["Creative Image URL"]);
    row.videoId = s(r["Creative Video ID"]);
    row.imageHash = s(r["Creative Image Hash"]);
    row.effectiveObjectStoryId = s(r.effective_object_story_id);
    row.sourcePostId = s(r.source_post_id);
    row.landingPageUrl = s(r["Creative Landing Page URL"]);
    row.permalinkUrl = s(r["Creative Permalink URL"]);
    try {
      const parsed = JSON.parse(s(r["Creative Assets"]) || "[]");
      if (Array.isArray(parsed)) row.feedAssets = parsed;
    } catch {
      row.feedAssets = [];
    }
    graph.set(adId, row);
  }
  return [...graph.values()];
}

async function loadCrmRecords(): Promise<(CrmRecord & Row)[]> {
  const result = await getPool().query<Row>(
    `SELECT dataset,
            row_data->>'__odoo_id' AS id,
            COALESCE(row_data->>'Record Type','') AS record_type,
            COALESCE(row_data->>'Business Status','') AS business_status,
            COALESCE(row_data->>'Stage Key','') AS stage_key,
            COALESCE(row_data->>'Open Status','') AS open_status,
            COALESCE(row_data->>'Priority','') AS priority,
            COALESCE(row_data->>'أنشئ في','') AS created_at,
            COALESCE(row_data->>'Won Date','') AS won_at,
            btrim(COALESCE(row_data->>'Facebook Lead ID','')) AS facebook_lead_id,
            btrim(COALESCE(row_data->>'Ad ID','')) AS ad_id,
            btrim(COALESCE(row_data->>'Campaign ID','')) AS campaign_id,
            COALESCE(row_data->>'Salesperson','') AS salesperson,
            COALESCE(row_data->>'Sales Team','') AS sales_team,
            COALESCE(NULLIF(row_data->>'Course',''), row_data->>'Courses', '') AS course,
            COALESCE(row_data->>'cleaned Source', row_data->>'Source', '') AS source
       FROM dashboard_rows
      WHERE dataset IN ('crm','lost') AND COALESCE(row_data->>'__odoo_id','') <> ''`,
  );
  // The active and Lost populations are disjoint by contract; keep the first copy defensively.
  const byId = new Map<string, CrmRecord & Row>();
  for (const row of result.rows) {
    const id = s(row.id);
    if (byId.has(id)) continue;
    byId.set(id, {
      ...row,
      id,
      recordType: s(row.record_type),
      businessStatus: s(row.business_status),
      stageKey: s(row.stage_key),
      openStatus: s(row.open_status),
      priority: s(row.priority),
      createdAt: s(row.created_at),
      facebookLeadId: s(row.facebook_lead_id),
      adId: s(row.ad_id),
      campaignId: s(row.campaign_id),
    });
  }
  return [...byId.values()];
}

async function loadSaleOrders(): Promise<{ orders: SaleOrderLink[] | null; error: string }> {
  try {
    const { odooConfigured, odooConfig, searchRead } = await import("./odoo.server");
    if (!odooConfigured()) return { orders: null, error: "Odoo is not configured" };
    const rows = await searchRead<{
      id: number;
      name?: string;
      opportunity_id?: [number, string] | false;
      state?: string;
      date_order?: string;
    }>(
      "sale.order",
      [
        ["state", "in", ["sale", "done"]],
        ["opportunity_id", "!=", false],
        ["date_order", ">=", `${odooConfig().startDate} 00:00:00`],
      ],
      ["name", "opportunity_id", "state", "date_order"],
      { context: { active_test: false } },
    );
    return {
      orders: rows
        .filter((row) => Array.isArray(row.opportunity_id))
        .map((row) => ({
          orderId: String(row.id),
          orderName: s(row.name),
          opportunityId: String((row.opportunity_id as [number, string])[0]),
          state: s(row.state),
          dateOrder: s(row.date_order),
        })) as (SaleOrderLink & { dateOrder: string })[],
      error: "",
    };
  } catch (error) {
    return { orders: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function loadPaidInvoiceLines(): Promise<PaidInvoiceLine[]> {
  const result = await getPool().query<Row>(
    `SELECT COALESCE(row_data->>'Sales Order #','') AS order_name,
            COALESCE(row_data->>'حركة', row_data->>'Movement', '') AS movement,
            COALESCE(row_data->>'$ Sales', row_data->>'USD Paid', '0') AS usd,
            COALESCE(row_data->>'Payment Date', '') AS payment_date
       FROM dashboard_rows
      WHERE dataset = 'accounting' AND COALESCE(row_data->>'Sales Order #','') <> ''`,
  );
  return result.rows.map((row) => {
    const movement = s(row.movement);
    const usd = n(s(row.usd).replace(/[^0-9.-]/g, ""));
    // Customer credit notes (RINV) reduce paid revenue.
    return {
      orderName: s(row.order_name),
      movement,
      usdPaid: /^RINV/i.test(movement) && usd > 0 ? -usd : usd,
      paymentDate: s(row.payment_date).slice(0, 10),
    };
  });
}

async function loadAcquisitionIdentities(
  crm: readonly CrmRecord[],
): Promise<AcquisitionIdentity[]> {
  const pool = getPool();
  const present = async (table: string) =>
    Boolean((await pool.query<Row>(`SELECT to_regclass($1) AS t`, [`public.${table}`])).rows[0]?.t);
  const identities = new Map<string, AcquisitionIdentity>();
  // Meta leads the CRM carries with their provider lead ID.
  for (const record of crm) {
    if (!record.facebookLeadId) continue;
    const id = `meta_lead:${record.facebookLeadId}`;
    identities.set(id, {
      acquisitionEventId: id,
      entityType: "meta_lead",
      providerLeadId: record.facebookLeadId,
      chatwootConversationId: "",
      chatwootContactId: "",
      landingSubmissionId: "",
      chatwootCrmLeadIds: [],
    });
  }
  if (await present("meta_lead_acquisitions")) {
    for (const row of (await pool.query<Row>(`SELECT lead_id FROM meta_lead_acquisitions`)).rows) {
      const leadId = s(row.lead_id);
      identities.set(`meta_lead:${leadId}`, {
        acquisitionEventId: `meta_lead:${leadId}`,
        entityType: "meta_lead",
        providerLeadId: leadId,
        chatwootConversationId: "",
        chatwootContactId: "",
        landingSubmissionId: "",
        chatwootCrmLeadIds: [],
      });
    }
  }
  if (await present("chatwoot_conversation_attribution")) {
    const rows = await pool.query<Row>(
      `SELECT conversation_id::text AS conversation_id, COALESCE(contact_id::text,'') AS contact_id, crm_lead_ids,
              to_char(first_touch_at AT TIME ZONE '${BUSINESS_TIME_ZONE}', 'YYYY-MM-DD HH24:MI:SS') AS occurred_at
         FROM chatwoot_conversation_attribution`,
    );
    for (const row of rows.rows) {
      const id = `chatwoot_conversation:${s(row.conversation_id)}`;
      const crmIds = Array.isArray(row.crm_lead_ids) ? (row.crm_lead_ids as unknown[]).map(s) : [];
      identities.set(id, {
        acquisitionEventId: id,
        entityType: "chatwoot_conversation",
        providerLeadId: "",
        chatwootConversationId: s(row.conversation_id),
        chatwootContactId: s(row.contact_id),
        landingSubmissionId: "",
        chatwootCrmLeadIds: crmIds,
        occurredAt: s(row.occurred_at),
      });
    }
  }
  return [...identities.values()];
}

/** Odoo datetimes arrive as Cairo wall-clock text; store them as instants. */
function cairoInstant(value: string): string | null {
  const text = s(value);
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return null;
  return text.length > 10 ? text.slice(0, 19) : `${text} 00:00:00`;
}

/**
 * Inserts rows through one parameterised `unnest` per chunk. `text[]` columns
 * take a comma-joined string and `cairo_ts` columns take Cairo wall-clock text.
 */
async function bulkInsert(
  client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  table: string,
  columns: {
    name: string;
    type: "text" | "boolean" | "integer" | "numeric" | "date" | "text[]" | "cairo_ts";
  }[],
  rows: unknown[][],
) {
  const CHUNK = 2000;
  const paramType = (type: string) => (type === "text[]" || type === "cairo_ts" ? "text" : type);
  const selectExpr = (type: string, column: string) =>
    type === "text[]"
      ? `COALESCE(string_to_array(NULLIF(${column}, ''), ','), '{}')`
      : type === "cairo_ts"
        ? `(NULLIF(${column}, '')::timestamp AT TIME ZONE '${BUSINESS_TIME_ZONE}')`
        : column;
  for (let offset = 0; offset < rows.length; offset += CHUNK) {
    const chunk = rows.slice(offset, offset + CHUNK);
    await client.query(
      `INSERT INTO ${table} (${columns.map((column) => column.name).join(", ")})
       SELECT ${columns.map((column, index) => selectExpr(column.type, `c${index}`)).join(", ")}
         FROM unnest(${columns.map((column, index) => `$${index + 1}::${paramType(column.type)}[]`).join(", ")})
           AS u(${columns.map((_, index) => `c${index}`).join(", ")})`,
      columns.map((_, index) => chunk.map((row) => row[index] ?? null)),
    );
  }
}

export interface ClosedLoopRefreshSummary {
  metaAds: number;
  metaCreatives: number;
  metaAssets: number;
  crmRecords: number;
  saleOrders: number;
  saleOrdersPreserved: boolean;
  outcomes: number;
  acquisitionIdentities: number;
  links: number;
  primaryLinks: number;
  exactLinks: number;
  inferredLinks: number;
  errors: string[];
  durationMs: number;
}

let refreshing: Promise<ClosedLoopRefreshSummary> | null = null;

/** Rebuilds the identity graph. Idempotent; concurrent calls share one run. */
export function refreshClosedLoop(): Promise<ClosedLoopRefreshSummary> {
  refreshing ??= runRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function runRefresh(): Promise<ClosedLoopRefreshSummary> {
  const started = Date.now();
  await ensureClosedLoopSchema();
  const pool = getPool();
  await pool.query(
    `INSERT INTO closed_loop_refresh_state (id, started_at, status) VALUES (1, now(), 'running')
     ON CONFLICT (id) DO UPDATE SET started_at = now(), status = 'running'`,
  );
  const errors: string[] = [];
  try {
    const [graph, crm, sales, invoices] = await Promise.all([
      loadMetaGraph(),
      loadCrmRecords(),
      loadSaleOrders(),
      loadPaidInvoiceLines(),
    ]);
    if (sales.error) errors.push(`sale orders: ${sales.error}`);

    let orders = sales.orders;
    if (!orders) {
      // Keep the last good order links rather than wiping revenue on an Odoo outage.
      orders = (
        await pool.query<Row>(
          `SELECT sale_order_id, sale_order_name, opportunity_id, state FROM crm_sale_order_links`,
        )
      ).rows.map((row) => ({
        orderId: s(row.sale_order_id),
        orderName: s(row.sale_order_name),
        opportunityId: s(row.opportunity_id),
        state: s(row.state),
      }));
    }

    const ordersByOpportunity = new Map<string, SaleOrderLink[]>();
    for (const order of orders) {
      const list = ordersByOpportunity.get(order.opportunityId) ?? [];
      list.push(order);
      ordersByOpportunity.set(order.opportunityId, list);
    }
    const invoicesByOrder = new Map<string, PaidInvoiceLine[]>();
    for (const line of invoices) {
      const list = invoicesByOrder.get(line.orderName) ?? [];
      list.push(line);
      invoicesByOrder.set(line.orderName, list);
    }
    const outcomes = crm.map((record) => {
      const own = ordersByOpportunity.get(record.id) ?? [];
      const lines = own.flatMap((order) => invoicesByOrder.get(order.orderName) ?? []);
      return { record, outcome: crmOutcome(record, own, lines) };
    });

    const identities = await loadAcquisitionIdentities(crm);
    const links = linkAcquisitionsToCrm(identities, crm);
    const assets: CreativeAsset[] = [];
    for (const row of graph) {
      if (!row.creativeId) continue;
      assets.push(
        ...creativeAssets({
          creativeId: row.creativeId,
          adId: row.adId,
          videoId: row.videoId,
          imageHash: row.imageHash,
          imageUrl: row.imageUrl,
          thumbnailUrl: row.thumbnailUrl,
          feedAssets: row.feedAssets,
        }),
      );
    }
    const uniqueAssets = [
      ...new Map(
        assets.map((asset) => [`${asset.creativeId}|${asset.assetType}|${asset.assetId}`, asset]),
      ).values(),
    ];

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "TRUNCATE meta_entity_graph, meta_creative_assets, crm_lead_outcomes, acquisition_crm_links",
      );
      await bulkInsert(
        client,
        "meta_entity_graph",
        [
          { name: "ad_id", type: "text" },
          { name: "ad_name", type: "text" },
          { name: "account_id", type: "text" },
          { name: "campaign_id", type: "text" },
          { name: "campaign_name", type: "text" },
          { name: "adset_id", type: "text" },
          { name: "adset_name", type: "text" },
          { name: "creative_id", type: "text" },
          { name: "creative_name", type: "text" },
          { name: "media_type", type: "text" },
          { name: "headline", type: "text" },
          { name: "thumbnail_url", type: "text" },
          { name: "image_url", type: "text" },
          { name: "video_id", type: "text" },
          { name: "image_hash", type: "text" },
          { name: "effective_object_story_id", type: "text" },
          { name: "source_post_id", type: "text" },
          { name: "landing_page_url", type: "text" },
          { name: "permalink_url", type: "text" },
        ],
        graph.map((row) => [
          row.adId,
          row.adName,
          row.accountId,
          row.campaignId,
          row.campaignName,
          row.adsetId,
          row.adsetName,
          row.creativeId,
          row.creativeName,
          row.mediaType,
          row.headline,
          row.thumbnailUrl,
          row.imageUrl,
          row.videoId,
          row.imageHash,
          row.effectiveObjectStoryId,
          row.sourcePostId,
          row.landingPageUrl,
          row.permalinkUrl,
        ]),
      );
      await bulkInsert(
        client,
        "meta_creative_assets",
        [
          { name: "creative_id", type: "text" },
          { name: "ad_id", type: "text" },
          { name: "asset_type", type: "text" },
          { name: "asset_id", type: "text" },
          { name: "video_id", type: "text" },
          { name: "image_hash", type: "text" },
          { name: "asset_url", type: "text" },
          { name: "thumbnail_url", type: "text" },
        ],
        uniqueAssets.map((asset) => [
          asset.creativeId,
          asset.adId,
          asset.assetType,
          asset.assetId,
          asset.videoId,
          asset.imageHash,
          asset.assetUrl,
          asset.thumbnailUrl,
        ]),
      );
      if (sales.orders) {
        await client.query("TRUNCATE crm_sale_order_links");
        await bulkInsert(
          client,
          "crm_sale_order_links",
          [
            { name: "sale_order_id", type: "text" },
            { name: "sale_order_name", type: "text" },
            { name: "opportunity_id", type: "text" },
            { name: "state", type: "text" },
            { name: "date_order", type: "cairo_ts" },
          ],
          (sales.orders as (SaleOrderLink & { dateOrder: string })[]).map((order) => [
            order.orderId,
            order.orderName,
            order.opportunityId,
            order.state,
            cairoInstant(order.dateOrder),
          ]),
        );
      }
      await bulkInsert(
        client,
        "crm_lead_outcomes",
        [
          { name: "crm_lead_id", type: "text" },
          { name: "record_type", type: "text" },
          { name: "business_status", type: "text" },
          { name: "stage_key", type: "text" },
          { name: "salesperson", type: "text" },
          { name: "sales_team", type: "text" },
          { name: "course", type: "text" },
          { name: "source", type: "text" },
          { name: "facebook_lead_id", type: "text" },
          { name: "ad_id", type: "text" },
          { name: "crm_campaign_id", type: "text" },
          { name: "created_at", type: "cairo_ts" },
          { name: "won_at", type: "cairo_ts" },
          { name: "interested", type: "boolean" },
          { name: "qualified", type: "boolean" },
          { name: "quotation", type: "boolean" },
          { name: "won", type: "boolean" },
          { name: "lost", type: "boolean" },
          { name: "sale_order_ids", type: "text[]" },
          { name: "invoice_count", type: "integer" },
          { name: "revenue_paid_usd", type: "numeric" },
          { name: "first_invoice_at", type: "date" },
        ],
        outcomes.map(({ record, outcome }) => [
          record.id,
          record.recordType,
          record.businessStatus,
          record.stageKey,
          s(record.salesperson),
          s(record.sales_team),
          s(record.course),
          s(record.source),
          record.facebookLeadId,
          record.adId,
          record.campaignId,
          cairoInstant(record.createdAt),
          cairoInstant(s(record.won_at)),
          outcome.interested,
          outcome.qualified,
          outcome.quotation,
          outcome.won,
          outcome.lost,
          outcome.saleOrderIds.join(","),
          outcome.invoiceCount,
          outcome.revenuePaidUsd,
          outcome.firstInvoiceAt || null,
        ]),
      );
      await bulkInsert(
        client,
        "acquisition_crm_links",
        [
          { name: "acquisition_event_id", type: "text" },
          { name: "crm_lead_id", type: "text" },
          { name: "crm_opportunity_id", type: "text" },
          { name: "chatwoot_conversation_id", type: "text" },
          { name: "chatwoot_contact_id", type: "text" },
          { name: "provider_lead_id", type: "text" },
          { name: "landing_submission_id", type: "text" },
          { name: "match_method", type: "text" },
          { name: "match_confidence", type: "text" },
          { name: "is_primary", type: "boolean" },
        ],
        links.map((link) => [
          link.acquisitionEventId,
          link.crmLeadId,
          link.crmOpportunityId,
          link.chatwootConversationId,
          link.chatwootContactId,
          link.providerLeadId,
          link.landingSubmissionId,
          link.matchMethod,
          link.matchConfidence,
          link.isPrimary,
        ]),
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    const summary: ClosedLoopRefreshSummary = {
      metaAds: graph.length,
      metaCreatives: new Set(graph.map((row) => row.creativeId).filter(Boolean)).size,
      metaAssets: uniqueAssets.length,
      crmRecords: crm.length,
      saleOrders: orders.length,
      saleOrdersPreserved: !sales.orders,
      outcomes: outcomes.length,
      acquisitionIdentities: identities.length,
      links: links.length,
      primaryLinks: links.filter((link) => link.isPrimary).length,
      exactLinks: links.filter((link) => link.isPrimary && link.matchConfidence === "exact").length,
      inferredLinks: links.filter((link) => link.isPrimary && link.matchConfidence === "inferred")
        .length,
      errors,
      durationMs: Date.now() - started,
    };
    await pool.query(
      `UPDATE closed_loop_refresh_state
          SET finished_at = now(), status = $1, summary = $2::jsonb, last_error = $3 WHERE id = 1`,
      [errors.length ? "partial" : "ok", JSON.stringify(summary), errors.join("; ")],
    );
    cache.clear();
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await pool
      .query(
        `UPDATE closed_loop_refresh_state SET finished_at = now(), status = 'failed', last_error = $1 WHERE id = 1`,
        [message.slice(0, 1000)],
      )
      .catch(() => {});
    throw error;
  }
}

export async function closedLoopRefreshState() {
  await ensureClosedLoopSchema();
  const row = (await getPool().query<Row>(`SELECT * FROM closed_loop_refresh_state WHERE id = 1`))
    .rows[0];
  return row
    ? {
        status: s(row.status),
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        summary: row.summary,
        lastError: s(row.last_error),
      }
    : { status: "never", startedAt: null, finishedAt: null, summary: null, lastError: "" };
}

let worker: ReturnType<typeof setInterval> | null = null;

/** Refreshes shortly after boot and then on an interval (CLOSED_LOOP_REFRESH_MINUTES, 0 disables). */
export function startClosedLoopWorker() {
  if (worker || !acquisitionDatabaseConfigured()) return;
  const minutes = Number(process.env.CLOSED_LOOP_REFRESH_MINUTES ?? 30);
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  const run = () =>
    refreshClosedLoop().catch((error) =>
      console.error(
        "[closed-loop] refresh failed:",
        error instanceof Error ? error.message : error,
      ),
    );
  setTimeout(run, 90_000).unref?.();
  worker = setInterval(run, minutes * 60_000);
  worker.unref?.();
}

/* --- read model -------------------------------------------------------------- */

const cache = new Map<string, { at: number; value: Promise<unknown> }>();
const CACHE_TTL_MS = 60_000;

function cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as Promise<T>;
  const value = compute();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}

function businessToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function resolveRange(from?: string, to?: string) {
  const end = to && DATE.test(to) ? to : businessToday();
  const start = from && DATE.test(from) ? from : `${end.slice(0, 7)}-01`;
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}

interface FactRecord extends AcquisitionFactRow {
  occurredAt: string;
  crmLeadId: string;
  matchMethod: string;
  stageKey: string;
  businessStatus: string;
  salesTeam: string;
  source: string;
  wonAt: string;
  mediaThumbnail: string;
}

async function loadFacts(range: { from: string; to: string }): Promise<FactRecord[]> {
  const { cte } = await eventsCte();
  if (!cte) return [];
  const { sql, params } = where(range);
  const result = await getPool().query<Row>(
    `${cte}
     SELECT e.acquisition_event_id, e.entity_type, e.destination_channel, e.source_platform,
            e.attribution_confidence, e.campaign_id, e.campaign_name, e.adset_id, e.adset_name,
            e.ad_id, e.ad_name, e.creative_id, e.creative_name, e.form_id, e.landing_page_id,
            to_char(e.occurred_at AT TIME ZONE '${BUSINESS_TIME_ZONE}', 'YYYY-MM-DD HH24:MI') AS occurred_at,
            l.crm_lead_id, l.match_method, l.match_confidence,
            o.stage_key, o.business_status, o.salesperson, o.sales_team, o.course, o.source,
            to_char(o.won_at AT TIME ZONE '${BUSINESS_TIME_ZONE}', 'YYYY-MM-DD') AS won_at,
            o.interested, o.qualified, o.quotation, o.won, o.lost, o.sale_order_ids,
            o.invoice_count, o.revenue_paid_usd, to_char(o.first_invoice_at, 'YYYY-MM-DD') AS first_invoice_at
       FROM (SELECT * FROM acquisition_events ${sql}) e
       LEFT JOIN acquisition_crm_links l ON l.acquisition_event_id = e.acquisition_event_id AND l.is_primary
       LEFT JOIN crm_lead_outcomes o ON o.crm_lead_id = l.crm_lead_id
      WHERE e.entity_type IN ('meta_lead','chatwoot_conversation','landing_submission')`,
    params,
  );
  return result.rows.map((row) => {
    const linked =
      Boolean(s(row.crm_lead_id)) && row.interested !== null && row.interested !== undefined;
    const outcome: CrmOutcome | null = linked
      ? {
          crmLeadId: s(row.crm_lead_id),
          interested: row.interested === true,
          qualified: row.qualified === true,
          quotation: row.quotation === true,
          won: row.won === true,
          lost: row.lost === true,
          saleOrderIds: Array.isArray(row.sale_order_ids) ? (row.sale_order_ids as string[]) : [],
          invoiceCount: n(row.invoice_count),
          revenuePaidUsd: n(row.revenue_paid_usd),
          firstInvoiceAt: s(row.first_invoice_at).slice(0, 10),
        }
      : null;
    const confidence = s(row.attribution_confidence);
    return {
      acquisitionEventId: s(row.acquisition_event_id),
      entityType: s(row.entity_type),
      destinationChannel: s(row.destination_channel),
      sourcePlatform: s(row.source_platform),
      attributionConfidence: (["exact", "declared", "inferred"].includes(confidence)
        ? confidence
        : confidence === "strong"
          ? "declared"
          : "unknown") as AttributionConfidence,
      campaignId: s(row.campaign_id),
      campaignName: s(row.campaign_name),
      adsetId: s(row.adset_id),
      adsetName: s(row.adset_name),
      adId: s(row.ad_id),
      adName: s(row.ad_name),
      creativeId: s(row.creative_id),
      creativeName: s(row.creative_name),
      formId: s(row.form_id),
      landingPageId: s(row.landing_page_id),
      course: s(row.course),
      salesperson: s(row.salesperson),
      matchConfidence: (linked ? s(row.match_confidence) : "") as MatchConfidence | "",
      outcome,
      occurredAt: s(row.occurred_at),
      crmLeadId: linked ? s(row.crm_lead_id) : "",
      matchMethod: linked ? s(row.match_method) : "",
      stageKey: s(row.stage_key),
      businessStatus: s(row.business_status),
      salesTeam: s(row.sales_team),
      source: s(row.source),
      wonAt: s(row.won_at),
      mediaThumbnail: "",
    };
  });
}

async function loadSpend(range: { from: string; to: string }): Promise<SpendRow[]> {
  const result = await getPool().query<Row>(
    `SELECT r.row_data->>'__ad_id' AS ad_id,
            COALESCE(NULLIF(r.row_data->>'__campaign_id',''), g.campaign_id, '') AS campaign_id,
            COALESCE(NULLIF(r.row_data->>'__adset_id',''), g.adset_id, '') AS adset_id,
            COALESCE(NULLIF(r.row_data->>'__creative_id',''), g.creative_id, '') AS creative_id,
            sum(${numericCell("Spend (Cost)")}) AS spend,
            sum(${numericCell("Impressions")}) AS impressions,
            sum(${numericCell("Link Clicks")}) AS clicks
       FROM dashboard_rows r
       LEFT JOIN meta_entity_graph g ON g.ad_id = r.row_data->>'__ad_id'
      WHERE r.dataset = 'meta_ads' AND COALESCE(r.row_data->>'__ad_id','') <> ''${adRowsWhere(range).replaceAll("row_data", "r.row_data").replaceAll("record_date", "r.record_date")}
      GROUP BY 1,2,3,4`,
  );
  return result.rows.map((row) => ({
    adId: s(row.ad_id),
    campaignId: s(row.campaign_id),
    adsetId: s(row.adset_id),
    creativeId: s(row.creative_id),
    spend: n(row.spend),
    impressions: n(row.impressions),
    clicks: n(row.clicks),
  }));
}

const DIMENSIONS = [
  "platform",
  "campaign",
  "adset",
  "ad",
  "creative",
  "form",
  "landing_page",
  "course",
  "salesperson",
] as const;
type Dimension = (typeof DIMENSIONS)[number];

function dimensionValue(fact: FactRecord, dimension: Dimension): { key: string; label: string } {
  switch (dimension) {
    case "platform":
      return { key: fact.sourcePlatform || "unknown", label: fact.sourcePlatform || "unknown" };
    case "campaign":
      return fact.attributionConfidence === "exact" && fact.campaignId
        ? { key: fact.campaignId, label: fact.campaignName || fact.campaignId }
        : { key: "", label: "" };
    case "adset":
      return fact.attributionConfidence === "exact" && fact.adsetId
        ? { key: fact.adsetId, label: fact.adsetName || fact.adsetId }
        : { key: "", label: "" };
    case "ad":
      return fact.attributionConfidence === "exact" && fact.adId
        ? { key: fact.adId, label: fact.adName || fact.adId }
        : { key: "", label: "" };
    case "creative":
      return fact.attributionConfidence === "exact" && fact.creativeId
        ? { key: fact.creativeId, label: fact.creativeName || fact.creativeId }
        : { key: "", label: "" };
    case "form":
      return { key: fact.formId, label: fact.formId };
    case "landing_page":
      return { key: fact.landingPageId, label: fact.landingPageId };
    case "course":
      return fact.outcome
        ? { key: fact.course || "—", label: fact.course || "—" }
        : { key: "", label: "" };
    case "salesperson":
      return fact.outcome
        ? { key: fact.salesperson || "—", label: fact.salesperson || "—" }
        : { key: "", label: "" };
  }
}

function coverageByType(facts: readonly FactRecord[]) {
  const groups: Record<string, FactRecord[]> = {
    meta_instant_form: [],
    whatsapp: [],
    messenger: [],
    instagram: [],
    website_chat: [],
    landing_submission: [],
  };
  for (const fact of facts) {
    if (fact.entityType === "meta_lead") groups.meta_instant_form.push(fact);
    else if (fact.entityType === "landing_submission") groups.landing_submission.push(fact);
    else if (fact.destinationChannel === "instagram_dm") groups.instagram.push(fact);
    else if (fact.destinationChannel in groups) groups[fact.destinationChannel].push(fact);
  }
  return Object.entries(groups).map(([type, rows]) => ({ type, ...coverageOf(rows) }));
}

export async function getClosedLoop(filters: { from?: string; to?: string } = {}) {
  if (!acquisitionDatabaseConfigured()) return { configured: false as const };
  const range = resolveRange(filters.from, filters.to);
  return cached(`closed-loop|${range.from}|${range.to}`, async () => {
    await ensureClosedLoopSchema();
    const pool = getPool();
    const [facts, spend, graphRows, catalog, refresh, crmTotals] = await Promise.all([
      loadFacts(range),
      loadSpend(range),
      pool.query<Row>(
        `SELECT DISTINCT ON (creative_id) creative_id, creative_name, media_type, headline, thumbnail_url,
                image_url, video_id, landing_page_url, permalink_url
           FROM meta_entity_graph WHERE creative_id <> '' ORDER BY creative_id, (thumbnail_url <> '') DESC`,
      ),
      pool.query<Row>(
        `SELECT count(DISTINCT campaign_id) FILTER (WHERE campaign_id <> '')::int AS campaigns,
                count(DISTINCT adset_id) FILTER (WHERE adset_id <> '')::int AS adsets,
                count(*)::int AS ads,
                count(DISTINCT creative_id) FILTER (WHERE creative_id <> '')::int AS creatives,
                (SELECT count(*)::int FROM meta_creative_assets) AS assets,
                (SELECT count(*)::int FROM meta_creative_assets WHERE asset_type = 'video') AS video_assets,
                (SELECT count(*)::int FROM meta_creative_assets WHERE asset_type = 'image') AS image_assets
           FROM meta_entity_graph`,
      ),
      closedLoopRefreshState(),
      pool.query<Row>(
        `SELECT count(*)::int AS crm_records,
                count(*) FILTER (WHERE (created_at AT TIME ZONE '${BUSINESS_TIME_ZONE}')::date BETWEEN $1::date AND $2::date)::int AS crm_created_in_period,
                count(*) FILTER (WHERE facebook_lead_id <> '')::int AS with_facebook_lead_id,
                (SELECT count(*)::int FROM crm_sale_order_links) AS sale_orders_linked
           FROM crm_lead_outcomes`,
        [range.from, range.to],
      ),
    ]);

    const media = new Map(graphRows.rows.map((row) => [s(row.creative_id), row]));
    const grains = Object.fromEntries(
      CLOSED_LOOP_GRAINS.map((grain) => [grain, rollupByGrain(facts, spend, grain)]),
    ) as Record<ClosedLoopGrain, GrainRow[]>;
    for (const row of grains.creative) {
      const m = media.get(row.creativeId);
      Object.assign(row, {
        thumbnailUrl: s(m?.thumbnail_url) || s(m?.image_url),
        mediaType: s(m?.media_type),
        videoId: s(m?.video_id),
        headline: s(m?.headline),
        creativeName: row.creativeName || s(m?.creative_name),
      });
    }
    // Names for spend-only rows come from the Meta graph, never from CRM text.
    const graphNames = await pool.query<Row>(
      `SELECT ad_id, ad_name, campaign_id, campaign_name, adset_id, adset_name, creative_id, creative_name FROM meta_entity_graph`,
    );
    const names = {
      campaign: new Map<string, string>(),
      adset: new Map<string, string>(),
      ad: new Map<string, string>(),
      creative: new Map<string, string>(),
    };
    for (const row of graphNames.rows) {
      if (s(row.campaign_id)) names.campaign.set(s(row.campaign_id), s(row.campaign_name));
      if (s(row.adset_id)) names.adset.set(s(row.adset_id), s(row.adset_name));
      if (s(row.ad_id)) names.ad.set(s(row.ad_id), s(row.ad_name));
      if (s(row.creative_id)) names.creative.set(s(row.creative_id), s(row.creative_name));
    }
    for (const grain of CLOSED_LOOP_GRAINS) {
      for (const row of grains[grain]) {
        row.campaignName ||= names.campaign.get(row.campaignId) ?? "";
        row.adsetName ||= names.adset.get(row.adsetId) ?? "";
        row.adName ||= names.ad.get(row.adId) ?? "";
        row.creativeName ||= names.creative.get(row.creativeId) ?? "";
      }
    }

    const assets = await pool.query<Row>(
      `SELECT creative_id, asset_type, asset_id, asset_url, thumbnail_url FROM meta_creative_assets`,
    );
    const creativeById = new Map(grains.creative.map((row) => [row.creativeId, row]));
    const assetRows = assets.rows
      .map((asset) => {
        const creative = creativeById.get(s(asset.creative_id));
        return {
          assetType: s(asset.asset_type),
          assetId: s(asset.asset_id),
          assetUrl: s(asset.asset_url),
          thumbnailUrl: s(asset.thumbnail_url),
          creativeId: s(asset.creative_id),
          creativeName: creative?.creativeName ?? names.creative.get(s(asset.creative_id)) ?? "",
          attributionLevel: "reporting" as const,
          creative: creative ?? null,
        };
      })
      .filter((row) => row.creative);

    const totals = emptyMetrics();
    facts.forEach((fact) => addFact(totals, fact));
    totals.spend = spend.reduce((sum, row) => sum + row.spend, 0);
    totals.impressions = spend.reduce((sum, row) => sum + row.impressions, 0);
    totals.clicks = spend.reduce((sum, row) => sum + row.clicks, 0);
    finalizeMetrics(totals);
    const exactTotals = emptyMetrics();
    facts
      .filter((fact) => fact.attributionConfidence === "exact")
      .forEach((fact) => addFact(exactTotals, fact));
    exactTotals.spend = grains.campaign
      .filter((row) => row.leads > 0)
      .reduce((sum, row) => sum + row.spend, 0);
    finalizeMetrics(exactTotals);

    const byDimension = Object.fromEntries(
      DIMENSIONS.map((dimension) => {
        const buckets = new Map<string, { key: string; label: string; metrics: QualityMetrics }>();
        for (const fact of facts) {
          const value = dimensionValue(fact, dimension);
          if (!value.key) continue;
          const bucket = buckets.get(value.key) ?? { ...value, metrics: emptyMetrics() };
          addFact(bucket.metrics, fact);
          buckets.set(value.key, bucket);
        }
        const spendByKey = new Map<string, number>();
        const spendKey = {
          campaign: "campaignId",
          adset: "adsetId",
          ad: "adId",
          creative: "creativeId",
        } as const;
        if (dimension in spendKey) {
          for (const row of spend) {
            const key = row[spendKey[dimension as keyof typeof spendKey]];
            if (key) spendByKey.set(key, (spendByKey.get(key) ?? 0) + row.spend);
          }
        }
        return [
          dimension,
          [...buckets.values()]
            .map((bucket) => {
              bucket.metrics.spend = spendByKey.get(bucket.key) ?? 0;
              finalizeMetrics(bucket.metrics);
              return bucket;
            })
            .sort(
              (a, b) => b.metrics.revenue - a.metrics.revenue || b.metrics.leads - a.metrics.leads,
            )
            .slice(0, 100),
        ];
      }),
    );

    const coverage = coverageOf(facts);
    // Rates and ROAS need a sample big enough to mean something.
    const MIN_MATCHED = 20;
    const MIN_SPEND = 100;
    const best = (score: (row: GrainRow) => number, rows = grains.creative) =>
      [...rows].filter((row) => score(row) > 0).sort((a, b) => score(b) - score(a))[0] ?? null;

    return {
      configured: true as const,
      period: range,
      businessTimeZone: BUSINESS_TIME_ZONE,
      refresh,
      marketing: {
        campaigns: n(catalog.rows[0]?.campaigns),
        adsets: n(catalog.rows[0]?.adsets),
        ads: n(catalog.rows[0]?.ads),
        creatives: n(catalog.rows[0]?.creatives),
        assets: n(catalog.rows[0]?.assets),
        videoAssets: n(catalog.rows[0]?.video_assets),
        imageAssets: n(catalog.rows[0]?.image_assets),
      },
      crm: {
        records: n(crmTotals.rows[0]?.crm_records),
        createdInPeriod: n(crmTotals.rows[0]?.crm_created_in_period),
        withFacebookLeadId: n(crmTotals.rows[0]?.with_facebook_lead_id),
        saleOrdersLinked: n(crmTotals.rows[0]?.sale_orders_linked),
      },
      coverage,
      coverageByType: coverageByType(facts),
      matches: {
        exact: facts.filter((fact) => fact.outcome && fact.matchConfidence === "exact").length,
        inferred: facts.filter((fact) => fact.outcome && fact.matchConfidence === "inferred")
          .length,
        unmatched: facts.filter((fact) => !fact.outcome).length,
      },
      totals,
      exactTotals,
      funnel: closedLoopFunnel({
        impressions: totals.impressions || null,
        clicks: totals.clicks || null,
        metrics: exactTotals,
      }),
      funnelAll: closedLoopFunnel({ impressions: null, clicks: null, metrics: totals }),
      grains,
      assets: assetRows.map(({ creative, ...row }) => ({
        ...row,
        spend: creative?.spend ?? 0,
        leads: creative?.leads ?? 0,
        crmMatched: creative?.crmMatched ?? 0,
        won: creative?.won ?? 0,
        revenue: creative?.revenue ?? 0,
      })),
      leadQuality: Object.fromEntries(
        CLOSED_LOOP_GRAINS.map((grain) => [
          grain,
          rankByLeadQuality(grains[grain].filter((row) => row.leads > 0)).slice(0, 100),
        ]),
      ),
      byDimension,
      best: {
        leads: best((row) => row.leads),
        qualified: best((row) => row.qualified),
        winRate: best((row) => (row.crmMatched >= MIN_MATCHED ? (row.winRate ?? 0) : 0)),
        revenue: best((row) => row.revenue),
        roas: best((row) =>
          row.spend >= MIN_SPEND && row.crmMatched >= MIN_MATCHED ? (row.roas ?? 0) : 0,
        ),
      },
      outcomes: facts
        .filter((fact) => fact.outcome)
        .sort(
          (a, b) =>
            (b.outcome?.revenuePaidUsd ?? 0) - (a.outcome?.revenuePaidUsd ?? 0) ||
            b.occurredAt.localeCompare(a.occurredAt),
        )
        .slice(0, 1000)
        .map(outcomeRecord),
    };
  });
}

function outcomeRecord(fact: FactRecord) {
  return {
    acquisitionEventId: fact.acquisitionEventId,
    occurredAt: fact.occurredAt,
    entityType: fact.entityType,
    destinationChannel: fact.destinationChannel,
    sourcePlatform: fact.sourcePlatform,
    attributionConfidence: fact.attributionConfidence,
    campaignId: fact.campaignId,
    campaignName: fact.campaignName,
    adsetId: fact.adsetId,
    adsetName: fact.adsetName,
    adId: fact.adId,
    adName: fact.adName,
    creativeId: fact.creativeId,
    creativeName: fact.creativeName,
    formId: fact.formId,
    landingPageId: fact.landingPageId,
    crmLeadId: fact.crmLeadId,
    matchMethod: fact.matchMethod,
    matchConfidence: fact.matchConfidence,
    stageKey: fact.stageKey,
    businessStatus: fact.businessStatus,
    salesperson: fact.salesperson,
    salesTeam: fact.salesTeam,
    course: fact.course,
    interested: fact.outcome?.interested ?? false,
    qualified: fact.outcome?.qualified ?? false,
    quotation: fact.outcome?.quotation ?? false,
    won: fact.outcome?.won ?? false,
    lost: fact.outcome?.lost ?? false,
    saleOrderIds: fact.outcome?.saleOrderIds ?? [],
    invoiceCount: fact.outcome?.invoiceCount ?? 0,
    revenue: fact.outcome?.revenuePaidUsd ?? 0,
    wonAt: fact.wonAt,
    firstInvoiceAt: fact.outcome?.firstInvoiceAt ?? "",
  };
}

/** Everything about one creative: media, hierarchy, spend, acquisitions, quality and sales. */
export async function getCreativeDetail(
  creativeId: string,
  filters: { from?: string; to?: string } = {},
) {
  if (!acquisitionDatabaseConfigured()) return { configured: false as const };
  const id = s(creativeId);
  if (!/^[\w.:-]{1,64}$/.test(id)) return { configured: true as const, found: false as const };
  const range = resolveRange(filters.from, filters.to);
  return cached(`creative|${id}|${range.from}|${range.to}`, async () => {
    await ensureClosedLoopSchema();
    const pool = getPool();
    const [ads, assets, facts, spend, historical] = await Promise.all([
      pool.query<Row>(
        `SELECT * FROM meta_entity_graph WHERE creative_id = $1 ORDER BY campaign_name, adset_name, ad_name`,
        [id],
      ),
      pool.query<Row>(
        `SELECT asset_type, asset_id, asset_url, thumbnail_url, attribution_level FROM meta_creative_assets WHERE creative_id = $1`,
        [id],
      ),
      loadFacts(range),
      loadSpend(range),
      pool.query<Row>(
        `SELECT count(*)::int AS leads, count(*) FILTER (WHERE o.won)::int AS won,
                COALESCE(sum(o.revenue_paid_usd), 0) AS revenue
           FROM crm_lead_outcomes o JOIN meta_entity_graph g ON g.ad_id = o.ad_id
          WHERE g.creative_id = $1 AND o.facebook_lead_id <> ''`,
        [id],
      ),
    ]);
    if (!ads.rows.length)
      return { configured: true as const, found: false as const, period: range };
    const adIds = new Set(ads.rows.map((row) => s(row.ad_id)));
    const creativeFacts = facts.filter(
      (fact) => fact.creativeId === id || (fact.adId && adIds.has(fact.adId)),
    );
    const exactFacts = creativeFacts.filter(
      (fact) => fact.attributionConfidence === "exact" && fact.creativeId === id,
    );
    const creativeSpend = spend.filter((row) => row.creativeId === id || adIds.has(row.adId));
    const metrics = emptyMetrics();
    exactFacts.forEach((fact) => addFact(metrics, fact));
    metrics.spend = creativeSpend.reduce((sum, row) => sum + row.spend, 0);
    metrics.impressions = creativeSpend.reduce((sum, row) => sum + row.impressions, 0);
    metrics.clicks = creativeSpend.reduce((sum, row) => sum + row.clicks, 0);
    finalizeMetrics(metrics);
    const first = ads.rows[0];
    return {
      configured: true as const,
      found: true as const,
      period: range,
      creative: {
        creativeId: id,
        creativeName: s(first.creative_name),
        mediaType: s(first.media_type),
        headline: s(first.headline),
        thumbnailUrl: s(first.thumbnail_url) || s(first.image_url),
        imageUrl: s(first.image_url),
        videoId: s(first.video_id),
        landingPageUrl: s(first.landing_page_url),
        permalinkUrl: s(first.permalink_url),
        effectiveObjectStoryId: s(first.effective_object_story_id),
        sourcePostId: s(first.source_post_id),
      },
      hierarchy: ads.rows.map((row) => ({
        accountId: s(row.account_id),
        campaignId: s(row.campaign_id),
        campaignName: s(row.campaign_name),
        adsetId: s(row.adset_id),
        adsetName: s(row.adset_name),
        adId: s(row.ad_id),
        adName: s(row.ad_name),
      })),
      assets: assets.rows,
      metrics,
      funnel: closedLoopFunnel({
        impressions: metrics.impressions || null,
        clicks: metrics.clicks || null,
        metrics,
      }),
      coverage: {
        ...coverageOf(creativeFacts),
        exactForCreative: exactFacts.length,
        unmatched: exactFacts.filter((fact) => !fact.outcome).length,
      },
      allTime: {
        crmLeads: n(historical.rows[0]?.leads),
        won: n(historical.rows[0]?.won),
        revenue: n(historical.rows[0]?.revenue),
      },
      records: exactFacts
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
        .slice(0, 500)
        .map(outcomeRecord),
    };
  });
}
