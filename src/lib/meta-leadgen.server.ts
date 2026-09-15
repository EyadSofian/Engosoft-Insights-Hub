import { createHash } from "node:crypto";
import { Pool } from "pg";
import { metaLeadSourceType } from "./acquisition-attribution";
import {
  META_LEAD_FIELDS,
  META_LEAD_FORM_FIELDS,
  metaLeadEventKey,
  metaLeadPlatform,
  metaLeadScope,
  normalizeMetaLeadgenWebhook,
  parseMetaLeadForm,
  parseMetaLeadRecord,
  type MetaLeadRecord,
} from "./meta-leadgen";

/**
 * Meta Lead Ads (instant form) adapter.
 *
 * Page `leadgen` webhook → durable reduced event → background retrieval of the
 * lead's own marketing identifiers → exact identity resolution → one row per
 * lead in `meta_lead_acquisitions`. Form answers are never requested, stored,
 * or logged, and nothing here reads CRM.
 *
 * Credentials: `META_LEAD_ADS_ACCESS_TOKEN` is a system-user credential issued
 * for the Engosoft Attribution app. Page credentials are derived from it in
 * memory only and never persisted or logged.
 */

const DEFAULT_API_VERSION = "v21.0";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 8;
const WORKER_BATCH = 25;
const PAGE_CREDENTIAL_TTL_MS = 50 * 60 * 1000;
const FORM_REFRESH_MS = 24 * 60 * 60 * 1000;
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 341, 613, 80000, 80001, 80004]);
const ACCESS_CODES = new Set([10, 100, 190, 200, 294]);

let pool: Pool | null = null;
let schemaPromise: Promise<void> | null = null;
let workerTimer: ReturnType<typeof setInterval> | null = null;
let workerStarted = false;
const pageCredentials = new Map<string, { value: string; at: number }>();

type Json = Record<string, unknown>;
type Row = Record<string, unknown>;

const obj = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";

export class MetaGraphError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly subcode: number,
    readonly status: number,
  ) {
    super(message);
  }
  get retryable(): boolean {
    return this.status >= 500 || RETRYABLE_CODES.has(this.code);
  }
  get accessProblem(): boolean {
    return ACCESS_CODES.has(this.code);
  }
}

export function metaLeadAdsDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function metaLeadAdsCredentialConfigured(): boolean {
  return Boolean(process.env.META_LEAD_ADS_ACCESS_TOKEN?.trim());
}

function credential(): string {
  return process.env.META_LEAD_ADS_ACCESS_TOKEN?.trim() ?? "";
}

function apiBase(): string {
  return `https://graph.facebook.com/${process.env.META_API_VERSION?.trim() || DEFAULT_API_VERSION}/`;
}

function redact(message: string): string {
  let out = message;
  for (const secret of [credential(), ...[...pageCredentials.values()].map((entry) => entry.value)])
    if (secret) out = out.replaceAll(secret, "<redacted>");
  return out
    .replace(/access[_-]?token[=:][^&\s]+/gi, "access_token=<redacted>")
    .replace(/\s+/g, " ")
    .slice(0, 300);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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

export async function ensureMetaLeadAdsSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = getPool()
      .query(
        `
        CREATE TABLE IF NOT EXISTS meta_leadgen_events (
          id bigserial PRIMARY KEY,
          event_key text NOT NULL UNIQUE,
          lead_id text NOT NULL UNIQUE,
          page_id text NOT NULL DEFAULT '',
          form_id text NOT NULL DEFAULT '',
          ad_id text NOT NULL DEFAULT '',
          adset_id text NOT NULL DEFAULT '',
          campaign_id text NOT NULL DEFAULT '',
          creative_id text NOT NULL DEFAULT '',
          ingestion_source text NOT NULL DEFAULT 'webhook',
          occurred_at timestamptz,
          received_at timestamptz NOT NULL DEFAULT now(),
          processed_at timestamptz,
          status text NOT NULL DEFAULT 'received',
          attempts integer NOT NULL DEFAULT 0,
          next_attempt_at timestamptz NOT NULL DEFAULT now(),
          duplicate_deliveries integer NOT NULL DEFAULT 0,
          last_error text NOT NULL DEFAULT '',
          reduced_evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
          payload_hash text NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS meta_leadgen_events_retry_idx
          ON meta_leadgen_events (status, next_attempt_at);
        CREATE INDEX IF NOT EXISTS meta_leadgen_events_form_idx ON meta_leadgen_events (form_id);

        CREATE TABLE IF NOT EXISTS meta_lead_form_catalog (
          form_id text PRIMARY KEY,
          page_id text NOT NULL DEFAULT '',
          page_name text NOT NULL DEFAULT '',
          form_name text NOT NULL DEFAULT '',
          status text NOT NULL DEFAULT '',
          locale text NOT NULL DEFAULT '',
          created_time timestamptz,
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS meta_lead_acquisitions (
          lead_id text PRIMARY KEY,
          page_id text NOT NULL DEFAULT '',
          page_name text NOT NULL DEFAULT '',
          form_id text NOT NULL DEFAULT '',
          form_name text NOT NULL DEFAULT '',
          account_id text NOT NULL DEFAULT '',
          campaign_id text NOT NULL DEFAULT '',
          campaign_name text NOT NULL DEFAULT '',
          adset_id text NOT NULL DEFAULT '',
          adset_name text NOT NULL DEFAULT '',
          ad_id text NOT NULL DEFAULT '',
          ad_name text NOT NULL DEFAULT '',
          creative_id text NOT NULL DEFAULT '',
          creative_name text NOT NULL DEFAULT '',
          source_platform text NOT NULL DEFAULT '',
          is_organic boolean,
          attribution_scope text NOT NULL DEFAULT 'unknown',
          source_type text NOT NULL DEFAULT 'unknown',
          attribution_method text NOT NULL DEFAULT 'meta_lead_ads',
          attribution_confidence text NOT NULL DEFAULT 'unknown',
          unknown_reason text NOT NULL DEFAULT '',
          identity_discrepancy text NOT NULL DEFAULT '',
          ingestion_source text NOT NULL DEFAULT 'webhook',
          occurred_at timestamptz,
          received_at timestamptz NOT NULL DEFAULT now(),
          processed_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS meta_lead_acquisitions_occurred_idx
          ON meta_lead_acquisitions (occurred_at DESC);
        CREATE INDEX IF NOT EXISTS meta_lead_acquisitions_campaign_idx
          ON meta_lead_acquisitions (campaign_id, adset_id, ad_id);
        CREATE INDEX IF NOT EXISTS meta_lead_acquisitions_form_idx ON meta_lead_acquisitions (form_id);

        CREATE TABLE IF NOT EXISTS meta_leadgen_backfill_state (
          form_id text PRIMARY KEY,
          page_id text NOT NULL DEFAULT '',
          cursor text NOT NULL DEFAULT '',
          leads_seen integer NOT NULL DEFAULT 0,
          leads_inserted integer NOT NULL DEFAULT 0,
          oldest_created_time timestamptz,
          newest_created_time timestamptz,
          completed_at timestamptz,
          last_error text NOT NULL DEFAULT '',
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        `,
      )
      .then(() => undefined)
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }
  return schemaPromise;
}

async function graph(path: string, token: string, init: RequestInit = {}): Promise<Json> {
  const url = path.startsWith("https://") ? path : `${apiBase()}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = obj(await response.json().catch(() => ({})));
  const error = obj(payload.error);
  if (!response.ok || Object.keys(error).length) {
    throw new MetaGraphError(
      redact(text(error.message) || `Meta returned HTTP ${response.status}`),
      Number(error.code) || 0,
      Number(error.error_subcode) || 0,
      response.status,
    );
  }
  return payload;
}

async function pageCredential(pageId: string): Promise<string> {
  const cached = pageCredentials.get(pageId);
  if (cached && Date.now() - cached.at < PAGE_CREDENTIAL_TTL_MS) return cached.value;
  const payload = await graph(`${pageId}?fields=access_token`, credential());
  const value = text(payload.access_token);
  if (!value) throw new MetaGraphError("Page credential unavailable for this Page", 200, 0, 403);
  pageCredentials.set(pageId, { value, at: Date.now() });
  return value;
}

/* --- ingestion ----------------------------------------------------------- */

export async function ingestMetaLeadgenWebhook(input: {
  payload: unknown;
  rawBody: string;
}): Promise<{ accepted: number; duplicates: number; ignored: boolean }> {
  if (!metaLeadAdsDatabaseConfigured())
    throw new Error("DATABASE_URL is required for durable Lead Ads ingestion");
  await ensureMetaLeadAdsSchema();
  const events = normalizeMetaLeadgenWebhook(input.payload);
  const payloadHash = hash(input.rawBody);
  let accepted = 0;
  let duplicates = 0;
  for (const event of events) {
    const result = await getPool().query(
      `INSERT INTO meta_leadgen_events
         (event_key, lead_id, page_id, form_id, ad_id, adset_id, occurred_at, reduced_evidence_json, payload_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
       ON CONFLICT (lead_id) DO UPDATE SET
         duplicate_deliveries = meta_leadgen_events.duplicate_deliveries + 1
       RETURNING (xmax = 0) AS inserted`,
      [
        event.eventKey,
        event.leadId,
        event.pageId,
        event.formId,
        event.adId,
        event.adsetId,
        event.occurredAt,
        JSON.stringify({
          lead_id: event.leadId,
          page_id: event.pageId,
          form_id: event.formId,
          ad_id: event.adId,
          adgroup_id: event.adsetId,
          created_time: event.occurredAt,
        }),
        payloadHash,
      ],
    );
    if (result.rows[0]?.inserted) accepted += 1;
    else duplicates += 1;
  }
  return { accepted, duplicates, ignored: events.length === 0 };
}

/* --- identity ------------------------------------------------------------- */

interface FormIdentity {
  formId: string;
  formName: string;
  pageId: string;
  pageName: string;
}

async function resolveForm(formId: string, pageId: string): Promise<FormIdentity> {
  const empty = { formId, formName: "", pageId, pageName: "" };
  if (!formId) return empty;
  const cached = await getPool().query<Row>(
    `SELECT form_id, form_name, page_id, page_name, updated_at FROM meta_lead_form_catalog WHERE form_id=$1`,
    [formId],
  );
  const hit = cached.rows[0];
  if (
    hit &&
    Date.now() - new Date(String(hit.updated_at)).getTime() < FORM_REFRESH_MS &&
    text(hit.form_name)
  )
    return {
      formId,
      formName: text(hit.form_name),
      pageId: text(hit.page_id) || pageId,
      pageName: text(hit.page_name),
    };
  try {
    const token = pageId ? await pageCredential(pageId) : credential();
    const form = parseMetaLeadForm(
      await graph(`${formId}?fields=${META_LEAD_FORM_FIELDS}`, token),
      pageId,
    );
    const resolvedPageId = form?.pageId || pageId;
    const page = resolvedPageId
      ? await graph(`${resolvedPageId}?fields=name`, credential()).catch(() => ({}))
      : {};
    const identity = {
      formId,
      formName: form?.name ?? "",
      pageId: resolvedPageId,
      pageName: text(obj(page).name),
    };
    await getPool().query(
      `INSERT INTO meta_lead_form_catalog (form_id, page_id, page_name, form_name, status, locale, created_time, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,now())
       ON CONFLICT (form_id) DO UPDATE SET page_id=EXCLUDED.page_id, page_name=EXCLUDED.page_name,
         form_name=EXCLUDED.form_name, status=EXCLUDED.status, locale=EXCLUDED.locale,
         created_time=EXCLUDED.created_time, updated_at=now()`,
      [
        formId,
        identity.pageId,
        identity.pageName,
        identity.formName,
        form?.status ?? "",
        form?.locale ?? "",
        form?.createdTime ?? null,
      ],
    );
    return identity;
  } catch {
    // Form names are presentation only; the exact form ID on the lead is kept regardless.
    return hit
      ? {
          formId,
          formName: text(hit.form_name),
          pageId: text(hit.page_id) || pageId,
          pageName: text(hit.page_name),
        }
      : empty;
  }
}

interface AdIdentity {
  accountId: string;
  campaignId: string;
  campaignName: string;
  adsetId: string;
  adsetName: string;
  adName: string;
  creativeId: string;
  creativeName: string;
}

async function catalogTableExists(): Promise<boolean> {
  const result = await getPool().query<Row>(
    `SELECT to_regclass('public.meta_entity_identity_catalog') AS name`,
  );
  return Boolean(result.rows[0]?.name);
}

/** Exact ad ID only. Names are never used to find an identity. */
async function resolveAd(adId: string): Promise<AdIdentity | null> {
  if (!adId) return null;
  const hasCatalog = await catalogTableExists();
  if (hasCatalog) {
    const cached = await getPool().query<Row>(
      `SELECT account_id, campaign_id, campaign_name, adset_id, adset_name, ad_name, creative_id, creative_name
         FROM meta_entity_identity_catalog WHERE ad_id=$1`,
      [adId],
    );
    const row = cached.rows[0];
    if (row && text(row.campaign_id))
      return {
        accountId: text(row.account_id),
        campaignId: text(row.campaign_id),
        campaignName: text(row.campaign_name),
        adsetId: text(row.adset_id),
        adsetName: text(row.adset_name),
        adName: text(row.ad_name),
        creativeId: text(row.creative_id),
        creativeName: text(row.creative_name),
      };
  }
  const token = process.env.META_ACCESS_TOKEN?.trim() || credential();
  try {
    const ad = await graph(
      `${adId}?fields=account_id,name,campaign{id,name},adset{id,name},creative{id,name}`,
      token,
    );
    const identity = {
      accountId: text(ad.account_id),
      campaignId: text(obj(ad.campaign).id),
      campaignName: text(obj(ad.campaign).name),
      adsetId: text(obj(ad.adset).id),
      adsetName: text(obj(ad.adset).name),
      adName: text(ad.name),
      creativeId: text(obj(ad.creative).id),
      creativeName: text(obj(ad.creative).name),
    };
    if (hasCatalog && identity.campaignId) {
      await getPool().query(
        `INSERT INTO meta_entity_identity_catalog
           (ad_id, account_id, campaign_id, campaign_name, adset_id, adset_name, ad_name, creative_id, creative_name, source, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'graph_lead_ads',now())
         ON CONFLICT (ad_id) DO UPDATE SET account_id=EXCLUDED.account_id, campaign_id=EXCLUDED.campaign_id,
           campaign_name=EXCLUDED.campaign_name, adset_id=EXCLUDED.adset_id, adset_name=EXCLUDED.adset_name,
           ad_name=EXCLUDED.ad_name, creative_id=EXCLUDED.creative_id, creative_name=EXCLUDED.creative_name,
           source=EXCLUDED.source, updated_at=now()`,
        [
          adId,
          identity.accountId,
          identity.campaignId,
          identity.campaignName,
          identity.adsetId,
          identity.adsetName,
          identity.adName,
          identity.creativeId,
          identity.creativeName,
        ],
      );
    }
    return identity;
  } catch {
    return null;
  }
}

/* --- projection ----------------------------------------------------------- */

async function projectLead(
  record: MetaLeadRecord,
  context: { pageId: string; formId: string; ingestionSource: string; receivedAt?: string | null },
): Promise<{ campaignId: string; adsetId: string; adId: string; creativeId: string }> {
  const { scope, unknownReason } = metaLeadScope(record);
  const form = await resolveForm(record.formId || context.formId, context.pageId);
  const ad = await resolveAd(record.adId);
  // The lead's own IDs are provider truth; the catalog only fills gaps and names.
  const campaignId = record.campaignId || ad?.campaignId || "";
  const adsetId = record.adsetId || ad?.adsetId || "";
  const discrepancies = [
    ad && record.campaignId && ad.campaignId && ad.campaignId !== record.campaignId
      ? "campaign_id"
      : "",
    ad && record.adsetId && ad.adsetId && ad.adsetId !== record.adsetId ? "adset_id" : "",
  ].filter(Boolean);
  const exact = scope === "paid" && Boolean(record.adId && campaignId);
  const confidence = scope === "organic" || exact ? "exact" : "unknown";
  const reason = scope === "paid" && !campaignId ? "meta_campaign_unresolved" : unknownReason;
  await getPool().query(
    `INSERT INTO meta_lead_acquisitions (
       lead_id, page_id, page_name, form_id, form_name, account_id, campaign_id, campaign_name,
       adset_id, adset_name, ad_id, ad_name, creative_id, creative_name, source_platform, is_organic,
       attribution_scope, source_type, attribution_confidence, unknown_reason, identity_discrepancy,
       ingestion_source, occurred_at, received_at, processed_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,COALESCE($24::timestamptz, now()),now())
     ON CONFLICT (lead_id) DO UPDATE SET
       page_id=EXCLUDED.page_id, page_name=EXCLUDED.page_name, form_id=EXCLUDED.form_id, form_name=EXCLUDED.form_name,
       account_id=EXCLUDED.account_id, campaign_id=EXCLUDED.campaign_id, campaign_name=EXCLUDED.campaign_name,
       adset_id=EXCLUDED.adset_id, adset_name=EXCLUDED.adset_name, ad_id=EXCLUDED.ad_id, ad_name=EXCLUDED.ad_name,
       creative_id=EXCLUDED.creative_id, creative_name=EXCLUDED.creative_name, source_platform=EXCLUDED.source_platform,
       is_organic=EXCLUDED.is_organic, attribution_scope=EXCLUDED.attribution_scope, source_type=EXCLUDED.source_type,
       attribution_confidence=EXCLUDED.attribution_confidence, unknown_reason=EXCLUDED.unknown_reason,
       identity_discrepancy=EXCLUDED.identity_discrepancy, processed_at=now()`,
    [
      record.leadId,
      form.pageId,
      form.pageName,
      form.formId,
      form.formName,
      ad?.accountId ?? "",
      campaignId,
      record.campaignName || ad?.campaignName || "",
      adsetId,
      record.adsetName || ad?.adsetName || "",
      record.adId,
      record.adName || ad?.adName || "",
      ad?.creativeId ?? "",
      ad?.creativeName ?? "",
      metaLeadPlatform(record.platform),
      record.isOrganic,
      scope,
      metaLeadSourceType(scope),
      confidence,
      reason,
      discrepancies.join(","),
      context.ingestionSource,
      record.createdTime,
      context.receivedAt ?? null,
    ],
  );
  return { campaignId, adsetId, adId: record.adId, creativeId: ad?.creativeId ?? "" };
}

/* --- worker --------------------------------------------------------------- */

function backoffMinutes(attempts: number): number {
  return Math.min(2 ** Math.max(0, attempts), 360);
}

async function processClaimed(
  event: Row,
): Promise<"resolved" | "retry" | "unresolved" | "waiting_access"> {
  const eventId = Number(event.id);
  const leadId = text(event.lead_id);
  const pageId = text(event.page_id);
  if (!metaLeadAdsCredentialConfigured()) {
    await getPool().query(
      `UPDATE meta_leadgen_events SET status='waiting_for_meta_access', last_error=$2, next_attempt_at=now()+interval '1 hour' WHERE id=$1`,
      [eventId, "META_LEAD_ADS_ACCESS_TOKEN is not configured"],
    );
    return "waiting_access";
  }
  try {
    let payload: Json;
    try {
      payload = await graph(`${leadId}?fields=${META_LEAD_FIELDS}`, credential());
    } catch (error) {
      if (!(error instanceof MetaGraphError) || !error.accessProblem || !pageId) throw error;
      payload = await graph(`${leadId}?fields=${META_LEAD_FIELDS}`, await pageCredential(pageId));
    }
    const record = parseMetaLeadRecord(payload);
    if (!record) {
      await getPool().query(
        `UPDATE meta_leadgen_events SET status='unresolved', last_error='meta_lead_unreadable', processed_at=now() WHERE id=$1`,
        [eventId],
      );
      return "unresolved";
    }
    const identity = await projectLead(record, {
      pageId,
      formId: text(event.form_id),
      ingestionSource: text(event.ingestion_source) || "webhook",
      receivedAt: event.received_at ? new Date(String(event.received_at)).toISOString() : null,
    });
    await getPool().query(
      `UPDATE meta_leadgen_events SET status='resolved', processed_at=now(), last_error='',
         form_id=COALESCE(NULLIF($2,''), form_id), ad_id=COALESCE(NULLIF($3,''), ad_id),
         adset_id=COALESCE(NULLIF($4,''), adset_id), campaign_id=$5, creative_id=$6
       WHERE id=$1`,
      [
        eventId,
        record.formId,
        identity.adId,
        identity.adsetId,
        identity.campaignId,
        identity.creativeId,
      ],
    );
    return "resolved";
  } catch (error) {
    const attempts = Number(event.attempts) + 1;
    const message = error instanceof Error ? redact(error.message) : "processing failed";
    if (error instanceof MetaGraphError && error.accessProblem) {
      // A permission gap is not the lead's fault; keep it waiting without burning attempts.
      await getPool().query(
        `UPDATE meta_leadgen_events SET status='waiting_for_meta_access', last_error=$2, next_attempt_at=now()+interval '1 hour' WHERE id=$1`,
        [eventId, message],
      );
      return "waiting_access";
    }
    const exhausted = attempts >= MAX_ATTEMPTS;
    await getPool().query(
      `UPDATE meta_leadgen_events SET status=$2, attempts=$3, last_error=$4,
         next_attempt_at=now() + make_interval(mins => $5)
       WHERE id=$1`,
      [
        eventId,
        exhausted ? "failed" : "waiting_for_meta",
        attempts,
        message,
        backoffMinutes(attempts),
      ],
    );
    return exhausted ? "unresolved" : "retry";
  }
}

export async function processPendingMetaLeadgenEvents(limit = WORKER_BATCH) {
  if (!metaLeadAdsDatabaseConfigured()) return { claimed: 0, processed: 0 };
  await ensureMetaLeadAdsSchema();
  const client = await getPool().connect();
  let rows: Row[] = [];
  try {
    await client.query("BEGIN");
    const result = await client.query<Row>(
      `SELECT * FROM meta_leadgen_events
        WHERE status IN ('received','waiting_for_meta','waiting_for_meta_access') AND next_attempt_at <= now()
        ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    rows = result.rows;
    if (rows.length)
      await client.query(
        `UPDATE meta_leadgen_events SET next_attempt_at=now()+interval '10 minutes' WHERE id = ANY($1::bigint[])`,
        [rows.map((row) => Number(row.id))],
      );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  let processed = 0;
  for (const row of rows) if ((await processClaimed(row)) === "resolved") processed += 1;
  return { claimed: rows.length, processed };
}

export function startMetaLeadAdsWorker(): { enabled: boolean; started: boolean } {
  const enabled = text(process.env.META_LEAD_ADS_WORKER_ENABLED).toLowerCase() === "true";
  if (!enabled || workerStarted) return { enabled, started: workerStarted };
  const run = () => {
    void processPendingMetaLeadgenEvents().catch((error) =>
      console.error("[meta-lead-ads] worker failed", {
        message: error instanceof Error ? redact(error.message).slice(0, 240) : "processing failed",
      }),
    );
  };
  workerTimer = setInterval(run, 30_000);
  workerTimer.unref?.();
  setTimeout(run, 5_000).unref?.();
  workerStarted = true;
  return { enabled, started: true };
}

export function stopMetaLeadAdsWorker(): void {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
  workerStarted = false;
}

/* --- operations ------------------------------------------------------------ */

export async function listMetaLeadForms(pageIds: string[]) {
  await ensureMetaLeadAdsSchema();
  const pages: { pageId: string; forms: number; error: string }[] = [];
  const forms: {
    formId: string;
    pageId: string;
    name: string;
    status: string;
    locale: string;
    createdTime: string | null;
  }[] = [];
  for (const pageId of pageIds) {
    try {
      const token = await pageCredential(pageId);
      let next: string | null = `${pageId}/leadgen_forms?fields=${META_LEAD_FORM_FIELDS}&limit=100`;
      let count = 0;
      while (next) {
        const payload = await graph(next, token);
        for (const item of Array.isArray(payload.data) ? payload.data : []) {
          const form = parseMetaLeadForm(item, pageId);
          if (!form) continue;
          forms.push(form);
          count += 1;
          await getPool().query(
            `INSERT INTO meta_lead_form_catalog (form_id, page_id, form_name, status, locale, created_time, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,now())
             ON CONFLICT (form_id) DO UPDATE SET page_id=EXCLUDED.page_id, form_name=EXCLUDED.form_name,
               status=EXCLUDED.status, locale=EXCLUDED.locale, created_time=EXCLUDED.created_time, updated_at=now()`,
            [form.formId, form.pageId, form.name, form.status, form.locale, form.createdTime],
          );
        }
        next = text(obj(payload.paging).next) || null;
      }
      pages.push({ pageId, forms: count, error: "" });
    } catch (error) {
      pages.push({
        pageId,
        forms: 0,
        error: error instanceof Error ? redact(error.message) : "failed",
      });
    }
  }
  return { pages, forms };
}

/**
 * Adds this app's `leadgen` subscription on each Page. The Page credential
 * identifies this app, so other apps subscribed to the Page are untouched;
 * fields this app already has on the Page are kept.
 */
export async function subscribeMetaLeadgenPages(
  pageIds: string[],
  options: { dryRun: boolean; fields?: string[] },
) {
  const wanted = [...new Set(["leadgen", ...(options.fields ?? [])])];
  const appId = process.env.META_ATTRIBUTION_APP_ID?.trim() ?? "";
  const results: {
    pageId: string;
    before: string[];
    after: string[];
    otherApps: number;
    changed: boolean;
    error: string;
  }[] = [];
  for (const pageId of pageIds) {
    try {
      const token = await pageCredential(pageId);
      const current = await graph(`${pageId}/subscribed_apps`, token);
      const apps = Array.isArray(current.data) ? current.data.map(obj) : [];
      const mine = apps.find((app) => text(app.id) === appId);
      const before = Array.isArray(mine?.subscribed_fields) ? mine.subscribed_fields.map(text) : [];
      const after = [...new Set([...before, ...wanted])];
      const changed = wanted.some((field) => !before.includes(field));
      if (changed && !options.dryRun) {
        await graph(
          `${pageId}/subscribed_apps?subscribed_fields=${encodeURIComponent(after.join(","))}`,
          token,
          {
            method: "POST",
          },
        );
      }
      results.push({
        pageId,
        before,
        after,
        otherApps: apps.filter((app) => text(app.id) !== appId).length,
        changed,
        error: "",
      });
    } catch (error) {
      results.push({
        pageId,
        before: [],
        after: [],
        otherApps: 0,
        changed: false,
        error: error instanceof Error ? redact(error.message) : "failed",
      });
    }
  }
  return { dryRun: options.dryRun, results };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Backfills real lead records only, per form, from Meta's leads edge. Resumable
 * through `meta_leadgen_backfill_state`, idempotent on the lead ID, and a dry
 * run by default. Aggregate Meta lead counts are never turned into rows.
 */
export async function backfillMetaLeads(options: {
  formIds: string[];
  dryRun: boolean;
  maxLeadsPerForm?: number;
  restart?: boolean;
}) {
  await ensureMetaLeadAdsSchema();
  const summary: {
    formId: string;
    seen: number;
    inserted: number;
    duplicates: number;
    oldest: string | null;
    newest: string | null;
    completed: boolean;
    error: string;
  }[] = [];
  for (const formId of options.formIds) {
    const state = options.restart
      ? null
      : (
          await getPool().query<Row>(`SELECT * FROM meta_leadgen_backfill_state WHERE form_id=$1`, [
            formId,
          ])
        ).rows[0];
    let cursor = options.dryRun ? "" : text(state?.cursor);
    let seen = 0;
    let inserted = 0;
    let duplicates = 0;
    let oldest: string | null = null;
    let newest: string | null = null;
    let completed = false;
    let error = "";
    const catalog = (
      await getPool().query<Row>(`SELECT page_id FROM meta_lead_form_catalog WHERE form_id=$1`, [
        formId,
      ])
    ).rows[0];
    const pageId = text(catalog?.page_id);
    try {
      let retries = 0;
      while (true) {
        if (options.maxLeadsPerForm && seen >= options.maxLeadsPerForm) break;
        const path = `${formId}/leads?fields=${META_LEAD_FIELDS}&limit=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`;
        let payload: Json;
        try {
          payload = await graph(path, credential());
          retries = 0;
        } catch (graphError) {
          if (graphError instanceof MetaGraphError && graphError.retryable && retries < 5) {
            retries += 1;
            await sleep(15_000 * retries);
            continue;
          }
          throw graphError;
        }
        const rows = Array.isArray(payload.data) ? payload.data : [];
        for (const item of rows) {
          const record = parseMetaLeadRecord(item);
          if (!record) continue;
          seen += 1;
          if (record.createdTime) {
            if (!oldest || record.createdTime < oldest) oldest = record.createdTime;
            if (!newest || record.createdTime > newest) newest = record.createdTime;
          }
          if (options.dryRun) continue;
          const insert = await getPool().query(
            `INSERT INTO meta_leadgen_events
               (event_key, lead_id, page_id, form_id, ad_id, adset_id, campaign_id, ingestion_source, occurred_at, status, reduced_evidence_json)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'backfill',$8,'backfill_projecting',$9::jsonb)
             ON CONFLICT (lead_id) DO NOTHING RETURNING id`,
            [
              metaLeadEventKey(record.leadId),
              record.leadId,
              pageId,
              record.formId || formId,
              record.adId,
              record.adsetId,
              record.campaignId,
              record.createdTime,
              JSON.stringify({
                lead_id: record.leadId,
                form_id: record.formId || formId,
                ad_id: record.adId,
                adset_id: record.adsetId,
                campaign_id: record.campaignId,
                created_time: record.createdTime,
              }),
            ],
          );
          if (!insert.rows.length) {
            duplicates += 1;
            continue;
          }
          const identity = await projectLead(record, {
            pageId,
            formId,
            ingestionSource: "backfill",
          });
          await getPool().query(
            `UPDATE meta_leadgen_events SET status='resolved', processed_at=now(), campaign_id=$2, creative_id=$3 WHERE id=$1`,
            [Number(insert.rows[0].id), identity.campaignId, identity.creativeId],
          );
          inserted += 1;
        }
        const next = text(obj(obj(payload.paging).cursors).after);
        const hasNext = Boolean(text(obj(payload.paging).next));
        if (!options.dryRun) {
          await getPool().query(
            `INSERT INTO meta_leadgen_backfill_state (form_id, page_id, cursor, leads_seen, leads_inserted, oldest_created_time, newest_created_time, completed_at, last_error, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'',now())
             ON CONFLICT (form_id) DO UPDATE SET cursor=EXCLUDED.cursor,
               leads_seen=meta_leadgen_backfill_state.leads_seen+$4, leads_inserted=meta_leadgen_backfill_state.leads_inserted+$5,
               oldest_created_time=LEAST(meta_leadgen_backfill_state.oldest_created_time, EXCLUDED.oldest_created_time),
               newest_created_time=GREATEST(meta_leadgen_backfill_state.newest_created_time, EXCLUDED.newest_created_time),
               completed_at=EXCLUDED.completed_at, last_error='', updated_at=now()`,
            [
              formId,
              pageId,
              hasNext ? next : "",
              rows.length,
              inserted,
              oldest,
              newest,
              hasNext ? null : new Date().toISOString(),
            ],
          );
        }
        if (!hasNext || !next) {
          completed = true;
          break;
        }
        cursor = next;
      }
    } catch (failure) {
      error = failure instanceof Error ? redact(failure.message) : "failed";
      if (!options.dryRun)
        await getPool()
          .query(
            `INSERT INTO meta_leadgen_backfill_state (form_id, page_id, last_error, updated_at) VALUES ($1,$2,$3,now())
             ON CONFLICT (form_id) DO UPDATE SET last_error=EXCLUDED.last_error, updated_at=now()`,
            [formId, pageId, error],
          )
          .catch(() => undefined);
    }
    summary.push({ formId, seen, inserted, duplicates, oldest, newest, completed, error });
  }
  return { dryRun: options.dryRun, forms: summary };
}

export async function getMetaLeadAdsHealth() {
  if (!metaLeadAdsDatabaseConfigured()) return { configured: false };
  await ensureMetaLeadAdsSchema();
  const [events, acquisitions, forms, backfill] = await Promise.all([
    getPool().query<Row>(
      `SELECT count(*)::int received,
              count(*) FILTER (WHERE status='resolved')::int resolved,
              count(*) FILTER (WHERE status IN ('waiting_for_meta','received'))::int waiting,
              count(*) FILTER (WHERE status='waiting_for_meta_access')::int waiting_for_access,
              count(*) FILTER (WHERE status IN ('failed','unresolved'))::int failed,
              count(*) FILTER (WHERE ingestion_source='webhook')::int webhook,
              count(*) FILTER (WHERE ingestion_source='backfill')::int backfill,
              coalesce(sum(duplicate_deliveries),0)::int duplicate_deliveries,
              max(received_at) FILTER (WHERE ingestion_source='webhook') last_webhook_at
         FROM meta_leadgen_events`,
    ),
    getPool().query<Row>(
      `SELECT count(*)::int leads,
              count(*) FILTER (WHERE attribution_scope='paid')::int paid,
              count(*) FILTER (WHERE attribution_scope='organic')::int organic,
              count(*) FILTER (WHERE attribution_confidence='exact' AND campaign_id<>'')::int exact_campaign,
              count(*) FILTER (WHERE identity_discrepancy<>'')::int identity_discrepancies,
              min(occurred_at) oldest, max(occurred_at) newest
         FROM meta_lead_acquisitions`,
    ),
    getPool().query<Row>(`SELECT count(*)::int forms FROM meta_lead_form_catalog`),
    getPool().query<Row>(
      `SELECT count(*)::int forms, count(*) FILTER (WHERE completed_at IS NOT NULL)::int completed,
              min(oldest_created_time) oldest FROM meta_leadgen_backfill_state`,
    ),
  ]);
  return {
    configured: true,
    credentialConfigured: metaLeadAdsCredentialConfigured(),
    workerEnabled: text(process.env.META_LEAD_ADS_WORKER_ENABLED).toLowerCase() === "true",
    events: events.rows[0],
    acquisitions: acquisitions.rows[0],
    formCatalog: forms.rows[0],
    backfill: backfill.rows[0],
  };
}

/**
 * CRM records that carry Meta's lead ID but no ad ID. The lead record at Meta
 * holds its ad, ad set, campaign and form, so each one is queued for an exact
 * lookup by lead ID. Without leads_retrieval the event waits (status
 * waiting_for_meta_access) and resolves by itself once the credential exists.
 * Idempotent: a lead already queued or already stored is skipped.
 */
export async function queueCrmMetaLeadsWithoutAdId(): Promise<{ queued: number }> {
  if (!metaLeadAdsDatabaseConfigured()) return { queued: 0 };
  await ensureMetaLeadAdsSchema();
  const present = await getPool().query<Row>(`SELECT to_regclass('public.crm_lead_outcomes') AS t`);
  if (!present.rows[0]?.t) return { queued: 0 };
  const result = await getPool().query(
    `INSERT INTO meta_leadgen_events
       (event_key, lead_id, ingestion_source, status, next_attempt_at, reduced_evidence_json, payload_hash)
     SELECT 'crm_recovery:' || o.facebook_lead_id, o.facebook_lead_id, 'crm_recovery', $1, now(),
            jsonb_build_object('lead_id', o.facebook_lead_id, 'reason', 'crm_record_without_ad_id'), ''
       FROM crm_lead_outcomes o
      WHERE o.facebook_lead_id ~ '^[0-9]{6,}$' AND o.ad_id = ''
        AND NOT EXISTS (SELECT 1 FROM meta_lead_acquisitions m WHERE m.lead_id = o.facebook_lead_id)
     ON CONFLICT DO NOTHING`,
    [metaLeadAdsCredentialConfigured() ? "received" : "waiting_for_meta_access"],
  );
  return { queued: result.rowCount ?? 0 };
}
