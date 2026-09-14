import { acquisitionDatabaseConfigured, getPool } from "./acquisition-attribution.server";
import { writeDashboardDataset } from "./dashboard-db.server";
import {
  META_CREATIVE_AD_FIELDS,
  creativeStorageRow,
  enlargeCreativeThumbnails,
  normalizeMetaGraphAd,
} from "./meta-creatives.server";
import {
  graphUsagePercent,
  isThrottleError,
  reconcileTargets,
  redactMetaSecrets,
  type ReconcileCandidate,
} from "./meta-catalog-reconcile";
import type { AdCreative } from "./types";

/**
 * Historical Meta catalog reconciliation.
 *
 * Every ad that ever produced spend (meta_ads) or a CRM lead (CRM "Ad ID") is
 * read from Meta by its exact Ad ID to recover the creative, its media, the
 * lead form configured on it, and image URLs for image hashes. It is:
 *
 *   bounded      one run reads at most `maxAds` ads
 *   checkpointed progress is written after every batch; a rerun skips ads
 *                that already carry a current-schema creative row
 *   idempotent   rows are upserted by ad ID
 *   rate-aware   sequential batches, a pause between them, and a stop as soon
 *                as Meta reports throttling or usage above 75%
 *
 * Nothing is joined by name. Ads Meta will not return are recorded with the
 * reason Meta gave, so "still missing" always has an explanation.
 */

type Row = Record<string, unknown>;
const s = (value: unknown): string => (value == null ? "" : String(value).trim());

const BATCH_SIZE = 40;
const IMAGE_BATCH_SIZE = 50;
const PAUSE_MS = 1_200;
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_API_VERSION = "v25.0";

export interface ReconcileSummary {
  status: "ok" | "partial" | "throttled" | "failed" | "not_configured" | "running";
  startedAt: string;
  finishedAt: string;
  candidates: number;
  targets: number;
  requested: number;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  leadForms: number;
  imageHashes: number;
  imagesResolved: number;
  failureReasons: Record<string, number>;
  message: string;
}

let running: Promise<ReconcileSummary> | null = null;
let schemaReady: Promise<void> | null = null;

function ensureSchema(): Promise<void> {
  schemaReady ??= getPool()
    .query(
      `CREATE TABLE IF NOT EXISTS meta_catalog_reconcile_state (
         id integer PRIMARY KEY DEFAULT 1,
         status text NOT NULL DEFAULT 'never',
         started_at timestamptz,
         finished_at timestamptz,
         summary jsonb NOT NULL DEFAULT '{}'::jsonb
       );
       CREATE TABLE IF NOT EXISTS meta_ad_lead_forms (
         ad_id text PRIMARY KEY,
         creative_id text NOT NULL DEFAULT '',
         form_id text NOT NULL,
         source text NOT NULL DEFAULT 'ad_creative_call_to_action',
         observed_at timestamptz NOT NULL DEFAULT now()
       );
       CREATE INDEX IF NOT EXISTS meta_ad_lead_forms_form_idx ON meta_ad_lead_forms (form_id);
       CREATE TABLE IF NOT EXISTS meta_image_assets (
         account_id text NOT NULL,
         image_hash text NOT NULL,
         url text NOT NULL DEFAULT '',
         permalink_url text NOT NULL DEFAULT '',
         width integer,
         height integer,
         name text NOT NULL DEFAULT '',
         observed_at timestamptz NOT NULL DEFAULT now(),
         PRIMARY KEY (account_id, image_hash)
       );
       CREATE TABLE IF NOT EXISTS meta_catalog_reconcile_failures (
         ad_id text PRIMARY KEY,
         reason text NOT NULL,
         observed_at timestamptz NOT NULL DEFAULT now()
       );`,
    )
    .then(() => undefined)
    .catch((error) => {
      schemaReady = null;
      throw error;
    });
  return schemaReady;
}

async function writeState(status: string, summary: Partial<ReconcileSummary>, finished = false) {
  await getPool().query(
    `INSERT INTO meta_catalog_reconcile_state (id, status, started_at, finished_at, summary)
     VALUES (1, $1, $2::timestamptz, $3::timestamptz, $4::jsonb)
     ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, started_at = EXCLUDED.started_at,
       finished_at = EXCLUDED.finished_at, summary = EXCLUDED.summary`,
    [
      status,
      summary.startedAt ?? null,
      finished ? new Date().toISOString() : null,
      JSON.stringify(summary),
    ],
  );
}

export async function metaCatalogReconcileState() {
  if (!acquisitionDatabaseConfigured()) return { configured: false as const };
  await ensureSchema();
  const pool = getPool();
  const [state, coverage] = await Promise.all([
    pool.query<Row>(
      `SELECT status, started_at, finished_at, summary FROM meta_catalog_reconcile_state WHERE id = 1`,
    ),
    pool.query<Row>(
      `SELECT (SELECT count(*)::int FROM meta_ad_lead_forms) AS ads_with_form,
              (SELECT count(DISTINCT form_id)::int FROM meta_ad_lead_forms) AS forms,
              (SELECT count(*)::int FROM meta_image_assets WHERE url <> '') AS images_with_url,
              (SELECT count(*)::int FROM meta_catalog_reconcile_failures) AS unreadable_ads`,
    ),
  ]);
  const row = state.rows[0];
  return {
    configured: true as const,
    status: s(row?.status) || "never",
    startedAt: row?.started_at ?? null,
    finishedAt: row?.finished_at ?? null,
    summary: (row?.summary as Row) ?? {},
    catalog: coverage.rows[0] ?? {},
  };
}

async function loadCandidates(): Promise<ReconcileCandidate[]> {
  const result = await getPool().query<Row>(
    `WITH ads AS (
       SELECT DISTINCT ON (row_data->>'__ad_id') row_data->>'__ad_id' AS ad_id,
              row_data->>'__account_id' AS account_id,
              row_data->>'__campaign_id' AS campaign_id,
              row_data->>'__adset_id' AS adset_id
         FROM dashboard_rows
        WHERE dataset = 'meta_ads' AND COALESCE(row_data->>'__ad_id','') <> ''
        ORDER BY row_data->>'__ad_id'
     ),
     crm_ads AS (
       SELECT DISTINCT btrim(row_data->>'Ad ID') AS ad_id
         FROM dashboard_rows
        WHERE dataset IN ('crm','lost') AND btrim(COALESCE(row_data->>'Ad ID','')) ~ '^[0-9]{6,}$'
     ),
     ids AS (SELECT ad_id FROM ads UNION SELECT ad_id FROM crm_ads)
     SELECT ids.ad_id,
            COALESCE(ads.account_id,'') AS account_id,
            COALESCE(ads.campaign_id,'') AS campaign_id,
            COALESCE(ads.adset_id,'') AS adset_id,
            cr.row_data IS NOT NULL AS has_creative_row,
            COALESCE(cr.row_data ? 'Lead Form ID', false) AS current_schema,
            COALESCE(cr.row_data->>'__synced_at','') AS synced_at,
            f.reason AS last_failure
       FROM ids
       LEFT JOIN ads USING (ad_id)
       LEFT JOIN LATERAL (
         SELECT row_data FROM dashboard_rows
          WHERE dataset = 'meta_ad_creatives' AND row_data->>'__ad_id' = ids.ad_id
          ORDER BY row_data->>'__synced_at' DESC LIMIT 1
       ) cr ON true
       LEFT JOIN meta_catalog_reconcile_failures f ON f.ad_id = ids.ad_id`,
  );
  return result.rows.map((row) => ({
    adId: s(row.ad_id),
    accountId: s(row.account_id),
    campaignId: s(row.campaign_id),
    adsetId: s(row.adset_id),
    hasCreativeRow: Boolean(row.has_creative_row),
    currentSchema: Boolean(row.current_schema),
    syncedAt: s(row.synced_at),
    lastFailure: s(row.last_failure),
  }));
}

const blankCreative = (candidate: ReconcileCandidate): AdCreative => ({
  platform: "meta",
  account: "",
  accountId: candidate.accountId,
  campaign: "",
  campaignId: candidate.campaignId,
  campaignKey: candidate.campaignId ? `id:${candidate.campaignId}` : "",
  adset: "",
  adsetId: candidate.adsetId,
  ad: "",
  adId: candidate.adId,
  creativeId: "",
  creativeName: "",
  creativeType: "",
  mediaType: "",
  headline: "",
  body: "",
  price: "",
  imageUrl: "",
  thumbnailUrl: "",
  videoUrl: "",
  videoId: "",
  permalinkUrl: "",
  landingPageUrl: "",
  status: "",
  reviewStatus: "",
  reviewReason: "",
  createdAt: "",
  updatedAt: "",
  syncedAt: "",
});

async function graphGet(url: URL, token: string) {
  url.searchParams.set("access_token", token);
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const usage = graphUsagePercent({
    app: response.headers.get("x-app-usage"),
    business: response.headers.get("x-business-use-case-usage"),
    account: response.headers.get("x-ad-account-usage"),
  });
  const payload = (await response.json().catch(() => ({}))) as Row;
  return { ok: response.ok, status: response.status, usage, payload };
}

const redact = redactMetaSecrets;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function runMetaCatalogReconcile(
  options: { maxAds?: number; force?: boolean } = {},
): Promise<ReconcileSummary> {
  running ??= reconcile(options).finally(() => {
    running = null;
  });
  return running;
}

export function metaCatalogReconcileRunning(): boolean {
  return running !== null;
}

async function reconcile(options: { maxAds?: number; force?: boolean }): Promise<ReconcileSummary> {
  const startedAt = new Date().toISOString();
  const summary: ReconcileSummary = {
    status: "running",
    startedAt,
    finishedAt: "",
    candidates: 0,
    targets: 0,
    requested: 0,
    fetched: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    leadForms: 0,
    imageHashes: 0,
    imagesResolved: 0,
    failureReasons: {},
    message: "",
  };
  const token = process.env.META_ACCESS_TOKEN?.trim() ?? "";
  if (!acquisitionDatabaseConfigured() || !token) {
    return {
      ...summary,
      status: "not_configured",
      message: "Database or META_ACCESS_TOKEN is not configured.",
    };
  }
  await ensureSchema();
  await writeState("running", summary);
  const apiVersion = process.env.META_API_VERSION?.trim() || DEFAULT_API_VERSION;
  const pool = getPool();

  try {
    const candidates = await loadCandidates();
    const plan = reconcileTargets(candidates, {
      maxAds: options.maxAds ?? 2_000,
      force: Boolean(options.force),
    });
    summary.candidates = candidates.length;
    summary.targets = plan.targets.length;
    summary.skipped = plan.skipped;

    const imageHashesByAccount = new Map<string, Set<string>>();
    let throttled = false;

    const pendingRows: { creative: AdCreative; existed: boolean }[] = [];
    async function flushBatch() {
      if (!pendingRows.length) return;
      const rows = pendingRows.splice(0);
      await enlargeCreativeThumbnails(
        rows.map((entry) => entry.creative),
        token,
        apiVersion,
      );
      await writeDashboardDataset(
        "meta_ad_creatives",
        rows.map((entry) => creativeStorageRow(entry.creative)),
        {
          mode: "upsert",
          syncedAt: rows[0]!.creative.syncedAt,
          metadata: { source: "meta-catalog-reconcile", grain: "ad-creative", rows: rows.length },
        },
      );
      for (const entry of rows) {
        if (entry.existed) summary.updated += 1;
        else summary.inserted += 1;
      }
    }

    async function handleEntry(candidate: ReconcileCandidate, entry: Row) {
      const error = entry.error as Row | undefined;
      if (error) {
        summary.failed += 1;
        const reason = failureReason(error);
        summary.failureReasons[reason] = (summary.failureReasons[reason] ?? 0) + 1;
        await pool.query(
          `INSERT INTO meta_catalog_reconcile_failures (ad_id, reason) VALUES ($1, $2)
           ON CONFLICT (ad_id) DO UPDATE SET reason = EXCLUDED.reason, observed_at = now()`,
          [candidate.adId, reason],
        );
        return;
      }
      const syncedAt = new Date().toISOString();
      const creative = normalizeMetaGraphAd(entry, blankCreative(candidate), syncedAt);
      if (!creative) {
        summary.failed += 1;
        summary.failureReasons.ad_has_no_creative =
          (summary.failureReasons.ad_has_no_creative ?? 0) + 1;
        await pool.query(
          `INSERT INTO meta_catalog_reconcile_failures (ad_id, reason) VALUES ($1, 'ad_has_no_creative')
           ON CONFLICT (ad_id) DO UPDATE SET reason = EXCLUDED.reason, observed_at = now()`,
          [candidate.adId],
        );
        return;
      }
      pendingRows.push({ creative, existed: candidate.hasCreativeRow });
      summary.fetched += 1;
      await pool.query(`DELETE FROM meta_catalog_reconcile_failures WHERE ad_id = $1`, [
        candidate.adId,
      ]);
      if (creative.leadFormId) {
        summary.leadForms += 1;
        await pool.query(
          `INSERT INTO meta_ad_lead_forms (ad_id, creative_id, form_id) VALUES ($1, $2, $3)
           ON CONFLICT (ad_id) DO UPDATE SET creative_id = EXCLUDED.creative_id, form_id = EXCLUDED.form_id, observed_at = now()`,
          [creative.adId, creative.creativeId, creative.leadFormId],
        );
      }
      const account = creative.accountId;
      for (const asset of creative.assets ?? []) {
        if (asset.type !== "image" || !account) continue;
        const set = imageHashesByAccount.get(account) ?? new Set<string>();
        set.add(asset.id);
        imageHashesByAccount.set(account, set);
      }
    }

    for (let index = 0; index < plan.targets.length && !throttled; index += BATCH_SIZE) {
      const batch = plan.targets.slice(index, index + BATCH_SIZE);
      const url = new URL(`https://graph.facebook.com/${apiVersion}/`);
      url.searchParams.set("ids", batch.map((candidate) => candidate.adId).join(","));
      url.searchParams.set("fields", META_CREATIVE_AD_FIELDS);
      summary.requested += batch.length;

      let result;
      try {
        result = await graphGet(url, token);
      } catch (error) {
        summary.failed += batch.length;
        const reason = `request_failed: ${redact(error instanceof Error ? error.message : String(error), token)}`;
        summary.failureReasons[reason] = (summary.failureReasons[reason] ?? 0) + batch.length;
        continue;
      }
      const rootError = result.payload.error as Row | undefined;
      if (rootError) {
        if (isThrottleError(rootError)) {
          throttled = true;
          summary.requested -= batch.length;
          summary.message = `Meta throttled the read (${s(rootError.code)}); progress is saved and the next run resumes.`;
          break;
        }
        // A batch-level error usually means one bad ID poisoned the batch:
        // retry those IDs one by one so good ads are not lost with it.
        for (const candidate of batch) {
          const single = new URL(`https://graph.facebook.com/${apiVersion}/${candidate.adId}`);
          single.searchParams.set("fields", META_CREATIVE_AD_FIELDS);
          const one = await graphGet(single, token).catch(() => null);
          await handleEntry(candidate, one?.payload ?? { error: { message: "request failed" } });
          await sleep(250);
        }
      } else {
        for (const candidate of batch) {
          await handleEntry(
            candidate,
            (result.payload[candidate.adId] as Row) ?? { error: { message: "not returned" } },
          );
        }
      }
      await flushBatch();
      await writeState("running", summary);
      if (result.usage >= 75) {
        await sleep(60_000);
      } else {
        await sleep(PAUSE_MS);
      }
    }

    // Image URLs by hash, per ad account. Meta keeps the hash stable; the URL
    // is what the dashboard can actually show.
    if (!throttled) {
      for (const [account, hashes] of imageHashesByAccount) {
        const all = [...hashes];
        summary.imageHashes += all.length;
        for (let index = 0; index < all.length; index += IMAGE_BATCH_SIZE) {
          const chunk = all.slice(index, index + IMAGE_BATCH_SIZE);
          const accountPath = account.startsWith("act_") ? account : `act_${account}`;
          const url = new URL(`https://graph.facebook.com/${apiVersion}/${accountPath}/adimages`);
          url.searchParams.set("hashes", JSON.stringify(chunk));
          url.searchParams.set("fields", "hash,url,permalink_url,width,height,name");
          const result = await graphGet(url, token).catch(() => null);
          const data = Array.isArray(result?.payload.data) ? (result!.payload.data as Row[]) : [];
          for (const image of data) {
            if (!s(image.hash)) continue;
            summary.imagesResolved += 1;
            await pool.query(
              `INSERT INTO meta_image_assets (account_id, image_hash, url, permalink_url, width, height, name)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (account_id, image_hash) DO UPDATE SET url = EXCLUDED.url,
                 permalink_url = EXCLUDED.permalink_url, width = EXCLUDED.width,
                 height = EXCLUDED.height, name = EXCLUDED.name, observed_at = now()`,
              [
                accountPath,
                s(image.hash),
                s(image.url),
                s(image.permalink_url),
                Number(image.width) || null,
                Number(image.height) || null,
                s(image.name).slice(0, 200),
              ],
            );
          }
          await sleep(PAUSE_MS);
        }
      }
    }

    summary.status = throttled ? "throttled" : summary.failed ? "partial" : "ok";
    summary.finishedAt = new Date().toISOString();
    summary.message ||= `${summary.fetched} ads read from Meta (${summary.inserted} new, ${summary.updated} refreshed), ${summary.failed} unreadable, ${summary.skipped} already current.`;
    await writeState(summary.status, summary, true);
    return summary;
  } catch (error) {
    summary.status = "failed";
    summary.finishedAt = new Date().toISOString();
    summary.message = redact(error instanceof Error ? error.message : String(error), token);
    await writeState("failed", summary, true).catch(() => undefined);
    return summary;
  }
}

function failureReason(error: Row): string {
  const code = s(error.code);
  const sub = s(error.error_subcode);
  const message = s(error.message).toLowerCase();
  if (code === "100" && sub === "33") return "not_readable_by_token_or_deleted";
  if (message.includes("does not exist")) return "deleted_or_not_found";
  if (code === "10" || code === "200" || message.includes("permission"))
    return "missing_permission";
  if (message === "not returned") return "not_returned_by_meta";
  return `meta_error_${code || "unknown"}`;
}
