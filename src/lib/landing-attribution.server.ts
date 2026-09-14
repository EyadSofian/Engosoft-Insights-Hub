import { createHash } from "node:crypto";
import { Pool } from "pg";
import {
  LANDING_EVENT_TYPES,
  type AttributionMethod,
  type ClickIds,
  type LandingEventType,
  type LandingTouch,
  type ReferrerType,
  type UtmValues,
  safeLandingPageUrl,
  safeLandingReferrer,
} from "./landing-attribution";

const MAX_EVENT_BYTES = 64 * 1024;
const EVENT_TYPES = new Set<string>(LANDING_EVENT_TYPES);
const METHODS = new Set<AttributionMethod>([
  "utm",
  "tracking_token",
  "referrer",
  "direct",
  "unknown",
]);
const REFERRER_TYPES = new Set<ReferrerType>(["search", "social", "referral", "direct", "unknown"]);
const REJECTION_REASONS = new Set([
  "body_too_large",
  "invalid_json",
  "invalid_payload",
  "origin_not_allowed",
  "rate_limited",
]);

let pool: Pool | null = null;
let schemaPromise: Promise<void> | null = null;

export function landingAttributionDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  if (!pool) {
    const isRailwayInternal = connectionString.includes(".railway.internal");
    pool = new Pool({
      connectionString,
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
      ssl:
        isRailwayInternal || process.env.PGSSLMODE === "disable"
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
        CREATE TABLE IF NOT EXISTS landing_attribution_events (
          event_id text PRIMARY KEY,
          event_type text NOT NULL CHECK (event_type IN ('landing_page_view', 'form_started', 'form_submitted')),
          visitor_id text NOT NULL,
          session_id text NOT NULL,
          form_id text,
          submission_id text,
          latest_touch jsonb NOT NULL,
          first_touch jsonb NOT NULL,
          received_at timestamptz NOT NULL DEFAULT now(),
          origin text,
          duplicate_deliveries integer NOT NULL DEFAULT 0
        );
        CREATE UNIQUE INDEX IF NOT EXISTS landing_attribution_submission_once_idx
          ON landing_attribution_events (submission_id)
          WHERE event_type = 'form_submitted' AND submission_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS landing_attribution_events_received_idx
          ON landing_attribution_events (received_at DESC);
        CREATE INDEX IF NOT EXISTS landing_attribution_events_session_idx
          ON landing_attribution_events (session_id, received_at DESC);

        CREATE TABLE IF NOT EXISTS landing_attribution_sessions (
          session_id text PRIMARY KEY,
          visitor_id text NOT NULL,
          landing_page_id text NOT NULL,
          landing_page_name text,
          landing_page_slug text,
          first_touch jsonb NOT NULL,
          latest_touch jsonb NOT NULL,
          first_source text,
          first_medium text,
          first_campaign text,
          first_content text,
          first_term text,
          latest_source text,
          latest_medium text,
          latest_campaign text,
          latest_content text,
          latest_term text,
          first_attribution_method text NOT NULL,
          latest_attribution_method text NOT NULL,
          first_referrer_type text NOT NULL,
          latest_referrer_type text NOT NULL,
          first_seen timestamptz NOT NULL DEFAULT now(),
          latest_seen timestamptz NOT NULL DEFAULT now(),
          form_started_at timestamptz,
          submitted_at timestamptz,
          submission_id text,
          view_count integer NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS landing_attribution_sessions_first_seen_idx
          ON landing_attribution_sessions (first_seen DESC);
        CREATE INDEX IF NOT EXISTS landing_attribution_sessions_page_idx
          ON landing_attribution_sessions (landing_page_id, first_seen DESC);
        CREATE INDEX IF NOT EXISTS landing_attribution_sessions_first_source_idx
          ON landing_attribution_sessions (first_source, first_seen DESC);
        CREATE INDEX IF NOT EXISTS landing_attribution_sessions_latest_source_idx
          ON landing_attribution_sessions (latest_source, latest_seen DESC);

        -- Deliberately stores a reason and time only—not malformed payloads or IPs.
        CREATE TABLE IF NOT EXISTS landing_attribution_rejections (
          id bigserial PRIMARY KEY,
          reason text NOT NULL,
          received_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS landing_attribution_rejections_received_idx
          ON landing_attribution_rejections (received_at DESC);
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

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown, max: number): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const next = value.trim();
  return next.length <= max ? next || null : undefined;
}

function requiredString(value: unknown, max: number): string | undefined {
  const next = optionalString(value, max);
  return typeof next === "string" ? next : undefined;
}

function exactKeys(value: UnknownRecord, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function readUtm(value: unknown): UtmValues | undefined {
  if (!isRecord(value) || !exactKeys(value, ["source", "medium", "campaign", "content", "term"]))
    return undefined;
  const source = optionalString(value.source, 300);
  const medium = optionalString(value.medium, 300);
  const campaign = optionalString(value.campaign, 500);
  const content = optionalString(value.content, 500);
  const term = optionalString(value.term, 500);
  if ([source, medium, campaign, content, term].some((entry) => entry === undefined))
    return undefined;
  return {
    source: source ?? null,
    medium: medium ?? null,
    campaign: campaign ?? null,
    content: content ?? null,
    term: term ?? null,
  };
}

function readClickIds(value: unknown): ClickIds | undefined {
  if (!isRecord(value) || !exactKeys(value, ["fbclid", "gclid", "ttclid"])) return undefined;
  const fbclid = optionalString(value.fbclid, 500);
  const gclid = optionalString(value.gclid, 500);
  const ttclid = optionalString(value.ttclid, 500);
  if ([fbclid, gclid, ttclid].some((entry) => entry === undefined)) return undefined;
  return { fbclid: fbclid ?? null, gclid: gclid ?? null, ttclid: ttclid ?? null };
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function readTouch(value: unknown): LandingTouch | undefined {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "landingPageId",
      "landingPageName",
      "landingPageSlug",
      "landingPageUrl",
      "landingPagePath",
      "rawUtm",
      "normalizedUtm",
      "clickIds",
      "referrer",
      "referrerType",
      "attributionMethod",
    ])
  ) {
    return undefined;
  }
  const landingPageId = requiredString(value.landingPageId, 160);
  const landingPageName = optionalString(value.landingPageName, 200);
  const landingPageSlug = optionalString(value.landingPageSlug, 200);
  const landingPageUrl = requiredString(value.landingPageUrl, 2_048);
  const landingPagePath = requiredString(value.landingPagePath, 1_024);
  const referrer = optionalString(value.referrer, 2_048);
  const rawUtm = readUtm(value.rawUtm);
  const normalizedUtm = readUtm(value.normalizedUtm);
  const clickIds = readClickIds(value.clickIds);
  if (
    !landingPageId ||
    landingPageName === undefined ||
    landingPageSlug === undefined ||
    !landingPageUrl ||
    !validHttpUrl(landingPageUrl) ||
    safeLandingPageUrl(landingPageUrl) !== landingPageUrl ||
    !landingPagePath ||
    !landingPagePath.startsWith("/") ||
    referrer === undefined ||
    (referrer && !validHttpUrl(referrer)) ||
    (referrer && safeLandingReferrer(referrer) !== referrer) ||
    !rawUtm ||
    !normalizedUtm ||
    !clickIds ||
    typeof value.referrerType !== "string" ||
    !REFERRER_TYPES.has(value.referrerType as ReferrerType) ||
    typeof value.attributionMethod !== "string" ||
    !METHODS.has(value.attributionMethod as AttributionMethod)
  ) {
    return undefined;
  }
  return {
    landingPageId,
    landingPageName: landingPageName ?? null,
    landingPageSlug: landingPageSlug ?? null,
    landingPageUrl,
    landingPagePath,
    rawUtm,
    normalizedUtm,
    clickIds,
    referrer: referrer ?? null,
    referrerType: value.referrerType as ReferrerType,
    attributionMethod: value.attributionMethod as AttributionMethod,
  };
}

export interface ValidLandingEvent {
  eventId: string;
  eventType: LandingEventType;
  visitorId: string;
  sessionId: string;
  formId: string | null;
  submissionId: string | null;
  firstTouch: LandingTouch;
  latestTouch: LandingTouch;
}

/** Strictly accept the small, versioned event contract and nothing else. */
export function validateLandingEvent(value: unknown): ValidLandingEvent | undefined {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "event_id",
      "event_type",
      "visitor_id",
      "session_id",
      "form_id",
      "submission_id",
      "first_touch",
      "latest_touch",
    ])
  ) {
    return undefined;
  }
  const eventId = requiredString(value.event_id, 160);
  const visitorId = requiredString(value.visitor_id, 160);
  const sessionId = requiredString(value.session_id, 160);
  const formId = optionalString(value.form_id, 160);
  const submissionId = optionalString(value.submission_id, 160);
  const firstTouch = readTouch(value.first_touch);
  const latestTouch = readTouch(value.latest_touch);
  if (
    !eventId ||
    !visitorId ||
    !sessionId ||
    formId === undefined ||
    submissionId === undefined ||
    typeof value.event_type !== "string" ||
    !EVENT_TYPES.has(value.event_type) ||
    !firstTouch ||
    !latestTouch ||
    (value.event_type === "form_submitted" && !submissionId)
  ) {
    return undefined;
  }
  return {
    eventId,
    eventType: value.event_type as LandingEventType,
    visitorId,
    sessionId,
    formId: formId ?? null,
    submissionId: submissionId ?? null,
    firstTouch,
    latestTouch,
  };
}

function touchValues(touch: LandingTouch) {
  return [
    touch.landingPageId,
    touch.landingPageName,
    touch.landingPageSlug,
    JSON.stringify(touch),
    touch.normalizedUtm.source,
    touch.normalizedUtm.medium,
    touch.normalizedUtm.campaign,
    touch.normalizedUtm.content,
    touch.normalizedUtm.term,
    touch.attributionMethod,
    touch.referrerType,
  ];
}

export async function recordLandingAttributionRejection(reason: string): Promise<void> {
  if (!landingAttributionDatabaseConfigured() || !REJECTION_REASONS.has(reason)) return;
  try {
    await ensureSchema();
    await getPool().query(`INSERT INTO landing_attribution_rejections (reason) VALUES ($1)`, [
      reason,
    ]);
  } catch {
    // Rejection diagnostics can never turn a rejected request into an outage.
  }
}

export async function ingestLandingAttributionEvent(
  event: ValidLandingEvent,
  origin: string | null,
): Promise<{ duplicate: boolean }> {
  await ensureSchema();
  const db = getPool();
  const inserted = await db.query<{ event_id: string }>(
    `INSERT INTO landing_attribution_events
       (event_id, event_type, visitor_id, session_id, form_id, submission_id, latest_touch, first_touch, origin)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
     ON CONFLICT DO NOTHING
     RETURNING event_id`,
    [
      event.eventId,
      event.eventType,
      event.visitorId,
      event.sessionId,
      event.formId,
      event.submissionId,
      JSON.stringify(event.latestTouch),
      JSON.stringify(event.firstTouch),
      origin,
    ],
  );
  if (!inserted.rowCount) {
    await db.query(
      `UPDATE landing_attribution_events
          SET duplicate_deliveries = duplicate_deliveries + 1
        WHERE event_id = $1
           OR ($2 = 'form_submitted' AND submission_id = $3)`,
      [event.eventId, event.eventType, event.submissionId],
    );
    return { duplicate: true };
  }

  const first = touchValues(event.firstTouch);
  const latest = touchValues(event.latestTouch);
  await db.query(
    `INSERT INTO landing_attribution_sessions (
       session_id, visitor_id, landing_page_id, landing_page_name, landing_page_slug,
       first_touch, latest_touch,
       first_source, first_medium, first_campaign, first_content, first_term,
       latest_source, latest_medium, latest_campaign, latest_content, latest_term,
       first_attribution_method, latest_attribution_method, first_referrer_type, latest_referrer_type,
       form_started_at, submitted_at, submission_id, view_count
     ) VALUES (
       $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb,
       $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21,
       CASE WHEN $22 = 'form_started' THEN now() END,
       CASE WHEN $22 = 'form_submitted' THEN now() END,
       CASE WHEN $22 = 'form_submitted' THEN $23 END,
       CASE WHEN $22 = 'landing_page_view' THEN 1 ELSE 0 END
     )
     ON CONFLICT (session_id) DO UPDATE SET
       visitor_id = landing_attribution_sessions.visitor_id,
       latest_touch = EXCLUDED.latest_touch,
       latest_source = EXCLUDED.latest_source,
       latest_medium = EXCLUDED.latest_medium,
       latest_campaign = EXCLUDED.latest_campaign,
       latest_content = EXCLUDED.latest_content,
       latest_term = EXCLUDED.latest_term,
       latest_attribution_method = EXCLUDED.latest_attribution_method,
       latest_referrer_type = EXCLUDED.latest_referrer_type,
       latest_seen = now(),
       form_started_at = COALESCE(landing_attribution_sessions.form_started_at, EXCLUDED.form_started_at),
       submitted_at = COALESCE(landing_attribution_sessions.submitted_at, EXCLUDED.submitted_at),
       submission_id = COALESCE(landing_attribution_sessions.submission_id, EXCLUDED.submission_id),
       view_count = landing_attribution_sessions.view_count + EXCLUDED.view_count`,
    [
      event.sessionId,
      event.visitorId,
      first[0],
      first[1],
      first[2],
      first[3],
      latest[3],
      first[4],
      first[5],
      first[6],
      first[7],
      first[8],
      latest[4],
      latest[5],
      latest[6],
      latest[7],
      latest[8],
      first[9],
      latest[9],
      first[10],
      latest[10],
      event.eventType,
      event.submissionId,
    ],
  );
  return { duplicate: false };
}

const rateBuckets = new Map<string, { startedAt: number; count: number }>();

/** Best-effort in-process rate limit; deploy a platform edge limit as well in Phase B. */
export function allowLandingAttributionRequest(request: Request): boolean {
  const raw =
    request.headers.get("x-forwarded-for")?.split(",")[0] ||
    request.headers.get("cf-connecting-ip") ||
    "anonymous";
  const key = createHash("sha256").update(raw).digest("hex");
  const now = Date.now();
  const current = rateBuckets.get(key);
  if (!current || now - current.startedAt >= 60_000) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    if (rateBuckets.size > 5_000) {
      for (const [bucketKey, bucket] of rateBuckets)
        if (now - bucket.startedAt > 60_000) rateBuckets.delete(bucketKey);
    }
    return true;
  }
  current.count += 1;
  return current.count <= 120;
}

export function allowedLandingOrigins(): string[] {
  return (process.env.LANDING_ATTRIBUTION_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter((origin) => /^https:\/\//.test(origin));
}

export function isLandingOriginAllowed(origin: string | null): boolean {
  const allowed = allowedLandingOrigins();
  if (!allowed.length) return true;
  return Boolean(origin && allowed.includes(origin.replace(/\/$/, "")));
}

export function landingCorsHeaders(origin: string | null): HeadersInit {
  const allowed = allowedLandingOrigins();
  if (!origin || !allowed.includes(origin.replace(/\/$/, ""))) return { vary: "Origin" };
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

export const LANDING_EVENT_MAX_BYTES = MAX_EVENT_BYTES;

export interface LandingSummaryFilters {
  from?: string;
  to?: string;
  landingPageId?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  touch?: "first" | "latest";
}

function safeDate(value: string | undefined): string | undefined {
  return value &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    ? value
    : undefined;
}

function safeFilter(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next && next.length <= 500 ? next : undefined;
}

function sessionWhere(filters: LandingSummaryFilters): {
  clause: string;
  values: string[];
  prefix: "first" | "latest";
} {
  const prefix = filters.touch === "latest" ? "latest" : "first";
  const values: string[] = [];
  const where: string[] = [];
  const from = safeDate(filters.from);
  const to = safeDate(filters.to);
  const add = (column: string, value: string | undefined) => {
    if (!value) return;
    values.push(value);
    where.push(`${column} = $${values.length}`);
  };
  if (from) {
    values.push(from);
    where.push(`first_seen >= $${values.length}::date`);
  }
  if (to) {
    values.push(to);
    where.push(`first_seen < ($${values.length}::date + interval '1 day')`);
  }
  add("landing_page_id", safeFilter(filters.landingPageId));
  add(`${prefix}_source`, safeFilter(filters.source));
  add(`${prefix}_medium`, safeFilter(filters.medium));
  add(`${prefix}_campaign`, safeFilter(filters.campaign));
  add(`${prefix}_content`, safeFilter(filters.content));
  return { clause: where.length ? `WHERE ${where.join(" AND ")}` : "", values, prefix };
}

function receivedWhere(filters: LandingSummaryFilters): { clause: string; values: string[] } {
  const values: string[] = [];
  const where: string[] = [];
  const from = safeDate(filters.from);
  const to = safeDate(filters.to);
  if (from) {
    values.push(from);
    where.push(`received_at >= $${values.length}::date`);
  }
  if (to) {
    values.push(to);
    where.push(`received_at < ($${values.length}::date + interval '1 day')`);
  }
  return { clause: where.length ? `WHERE ${where.join(" AND ")}` : "", values };
}

type SummaryRow = Record<string, string | number | null>;

function numberOf(row: SummaryRow | undefined, key: string): number {
  return Number(row?.[key] ?? 0);
}

function label(value: string | null): string {
  return value || "(not set)";
}

export async function getLandingAttributionSummary(filters: LandingSummaryFilters) {
  if (!landingAttributionDatabaseConfigured()) {
    return {
      configured: false,
      totals: null,
      landingPages: [],
      sources: [],
      mediums: [],
      campaigns: [],
      contents: [],
      referrers: [],
      trend: [],
      quality: null,
    };
  }
  await ensureSchema();
  const db = getPool();
  const { clause, values, prefix } = sessionWhere(filters);
  const received = receivedWhere(filters);
  const totalsResult = await db.query<SummaryRow>(
    `SELECT
       COALESCE(sum(view_count), 0)::text AS views,
       count(DISTINCT visitor_id)::text AS unique_visitors,
       count(*)::text AS sessions,
       count(*) FILTER (WHERE form_started_at IS NOT NULL)::text AS form_starts,
       count(*) FILTER (WHERE submitted_at IS NOT NULL)::text AS submissions
     FROM landing_attribution_sessions ${clause}`,
    values,
  );
  const breakdown = async (field: string, alias: string) =>
    db.query<SummaryRow>(
      `SELECT COALESCE(${field}, '') AS ${alias},
              COALESCE(sum(view_count), 0)::text AS views,
              count(DISTINCT visitor_id)::text AS unique_visitors,
              count(*) FILTER (WHERE form_started_at IS NOT NULL)::text AS form_starts,
              count(*) FILTER (WHERE submitted_at IS NOT NULL)::text AS submissions
         FROM landing_attribution_sessions ${clause}
        GROUP BY COALESCE(${field}, '')
        ORDER BY submissions DESC, views DESC, ${alias} ASC
        LIMIT 100`,
      values,
    );
  const [
    pages,
    sources,
    mediums,
    campaigns,
    contents,
    referrers,
    trend,
    quality,
    eventDiagnostics,
    rejectionDiagnostics,
  ] = await Promise.all([
    db.query<SummaryRow>(
      `SELECT landing_page_id, COALESCE(landing_page_name, '') AS landing_page_name,
              COALESCE(landing_page_slug, '') AS landing_page_slug,
              COALESCE(sum(view_count), 0)::text AS views,
              count(DISTINCT visitor_id)::text AS unique_visitors,
              count(*) FILTER (WHERE form_started_at IS NOT NULL)::text AS form_starts,
              count(*) FILTER (WHERE submitted_at IS NOT NULL)::text AS submissions,
              COALESCE(mode() WITHIN GROUP (ORDER BY COALESCE(${prefix}_source, '')), '') AS top_source,
              COALESCE(mode() WITHIN GROUP (ORDER BY COALESCE(${prefix}_campaign, '')), '') AS top_campaign
         FROM landing_attribution_sessions ${clause}
        GROUP BY landing_page_id, landing_page_name, landing_page_slug
        ORDER BY submissions DESC, views DESC, landing_page_id ASC
        LIMIT 100`,
      values,
    ),
    breakdown(`${prefix}_source`, "source"),
    breakdown(`${prefix}_medium`, "medium"),
    breakdown(`${prefix}_campaign`, "campaign"),
    breakdown(`${prefix}_content`, "content"),
    breakdown(`${prefix}_referrer_type`, "referrer_type"),
    db.query<SummaryRow>(
      `SELECT to_char(first_seen::date, 'YYYY-MM-DD') AS date,
              COALESCE(sum(view_count), 0)::text AS views,
              count(*) FILTER (WHERE form_started_at IS NOT NULL)::text AS form_starts,
              count(*) FILTER (WHERE submitted_at IS NOT NULL)::text AS submissions
         FROM landing_attribution_sessions ${clause}
        GROUP BY first_seen::date
        ORDER BY first_seen::date ASC`,
      values,
    ),
    db.query<SummaryRow>(
      `SELECT
         count(*) FILTER (WHERE ${prefix}_attribution_method IN ('direct', 'unknown'))::text AS sessions_without_attribution,
         count(*) FILTER (WHERE submitted_at IS NOT NULL AND view_count = 0)::text AS submissions_without_prior_view,
         count(*) FILTER (WHERE ${prefix}_attribution_method = 'utm')::text AS utm_covered_sessions,
         count(*) FILTER (WHERE ${prefix}_attribution_method = 'direct')::text AS direct_sessions,
         count(*) FILTER (WHERE ${prefix}_attribution_method = 'unknown')::text AS unknown_sessions
       FROM landing_attribution_sessions ${clause}`,
      values,
    ),
    db.query<SummaryRow>(
      `SELECT count(*)::text AS events_received,
                COALESCE(sum(duplicate_deliveries), 0)::text AS duplicate_deliveries
           FROM landing_attribution_events ${received.clause}`,
      received.values,
    ),
    db.query<SummaryRow>(
      `SELECT count(*)::text AS events_rejected
           FROM landing_attribution_rejections ${received.clause}`,
      received.values,
    ),
  ]);
  const totals = totalsResult.rows[0];
  const views = numberOf(totals, "views");
  const starts = numberOf(totals, "form_starts");
  const submissions = numberOf(totals, "submissions");
  const tableRows = (rows: SummaryRow[], key: string) =>
    rows.map((row) => ({
      [key]: label(String(row[key] ?? "")),
      views: numberOf(row, "views"),
      uniqueVisitors: numberOf(row, "unique_visitors"),
      formStarts: numberOf(row, "form_starts"),
      submissions: numberOf(row, "submissions"),
    }));
  return {
    configured: true,
    touch: prefix,
    totals: {
      views,
      uniqueVisitors: numberOf(totals, "unique_visitors"),
      sessions: numberOf(totals, "sessions"),
      formStarts: starts,
      submissions,
      viewToStartRate: views ? starts / views : null,
      viewToSubmissionRate: views ? submissions / views : null,
      startToSubmissionRate: starts ? submissions / starts : null,
    },
    landingPages: pages.rows.map((row) => ({
      landingPageId: String(row.landing_page_id ?? ""),
      landingPageName: label(String(row.landing_page_name ?? "")),
      landingPageSlug: String(row.landing_page_slug ?? ""),
      topSource: label(String(row.top_source ?? "")),
      topCampaign: label(String(row.top_campaign ?? "")),
      views: numberOf(row, "views"),
      uniqueVisitors: numberOf(row, "unique_visitors"),
      formStarts: numberOf(row, "form_starts"),
      submissions: numberOf(row, "submissions"),
      viewToSubmissionRate: numberOf(row, "views")
        ? numberOf(row, "submissions") / numberOf(row, "views")
        : null,
    })),
    sources: tableRows(sources.rows, "source"),
    mediums: tableRows(mediums.rows, "medium"),
    campaigns: tableRows(campaigns.rows, "campaign"),
    contents: tableRows(contents.rows, "content"),
    referrers: tableRows(referrers.rows, "referrerType"),
    trend: trend.rows.map((row) => ({
      date: String(row.date ?? ""),
      views: numberOf(row, "views"),
      formStarts: numberOf(row, "form_starts"),
      submissions: numberOf(row, "submissions"),
    })),
    quality: {
      eventsReceived: numberOf(eventDiagnostics.rows[0], "events_received"),
      eventsRejected: numberOf(rejectionDiagnostics.rows[0], "events_rejected"),
      duplicateDeliveries: numberOf(eventDiagnostics.rows[0], "duplicate_deliveries"),
      sessionsWithoutAttribution: numberOf(quality.rows[0], "sessions_without_attribution"),
      submissionsWithoutPriorView: numberOf(quality.rows[0], "submissions_without_prior_view"),
      utmCoveredSessions: numberOf(quality.rows[0], "utm_covered_sessions"),
      directSessions: numberOf(quality.rows[0], "direct_sessions"),
      unknownSessions: numberOf(quality.rows[0], "unknown_sessions"),
    },
  };
}
