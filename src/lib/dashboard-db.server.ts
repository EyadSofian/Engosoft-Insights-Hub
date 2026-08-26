// Server-only durable last-good storage for dashboard source datasets.
//
// Railway injects DATABASE_URL into the app service. Upstream workers post
// batches through the authenticated ingest route; they never receive direct
// database credentials. JSONB deliberately preserves the source column names
// so existing parsers can migrate away from Google Sheets without a risky
// reporting rewrite.
import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";

export type DashboardDataset =
  | "meta_ads"
  | "snap_ads"
  | "accounting"
  | "accounting_legacy"
  | "ads_legacy"
  | "crm"
  | "lost"
  | "invoiced"
  | "website_sales"
  | "pbx_extensions"
  | "sla_calls"
  | "sales_targets"
  | "media_plans"
  /** Odoo's monthly operational sales report, one row per salesperson-month. */
  | "sales_summary";

export type DashboardRow = Record<string, string>;

export interface DatasetSnapshot {
  configured: boolean;
  dataset: DashboardDataset;
  rows: DashboardRow[];
  syncedAt: string;
  rowCount: number;
  status: "success" | "failed" | "never";
  error: string;
  metadata: Record<string, unknown>;
}

export type DatasetState = Omit<DatasetSnapshot, "configured" | "rows" | "metadata">;

export interface DatasetWriteResult {
  dataset: DashboardDataset;
  receivedRows: number;
  rowCount: number;
  syncedAt: string;
  /**
   * Input rows whose first-choice source id was also used by another row.
   * They are retained under disambiguated keys; this is diagnostic only.
   */
  duplicates: number;
  /** Rows sent to PostgreSQL. Zero means an identical replace was already stored. */
  writtenRows: number;
  /** True when a replace contained the same business rows already in PostgreSQL. */
  unchanged: boolean;
}

const DATASETS = new Set<DashboardDataset>([
  "meta_ads",
  "snap_ads",
  "accounting",
  "accounting_legacy",
  "ads_legacy",
  "crm",
  "lost",
  "invoiced",
  "website_sales",
  "pbx_extensions",
  "sla_calls",
  "sales_targets",
  "media_plans",
  "sales_summary",
]);

let pool: Pool | null = null;
let schemaPromise: Promise<void> | null = null;

export function databaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function isDashboardDataset(value: unknown): value is DashboardDataset {
  return typeof value === "string" && DATASETS.has(value as DashboardDataset);
}

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  if (!pool) {
    const isRailwayInternal = connectionString.includes(".railway.internal");
    pool = new Pool({
      connectionString,
      max: 5,
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
        CREATE TABLE IF NOT EXISTS dashboard_rows (
          dataset text NOT NULL,
          stable_key text NOT NULL,
          row_data jsonb NOT NULL,
          record_date date,
          source_updated_at timestamptz,
          synced_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (dataset, stable_key)
        );
        CREATE INDEX IF NOT EXISTS dashboard_rows_dataset_date_idx
          ON dashboard_rows (dataset, record_date);

        CREATE TABLE IF NOT EXISTS dashboard_sync_state (
          dataset text PRIMARY KEY,
          status text NOT NULL,
          row_count integer NOT NULL DEFAULT 0,
          synced_at timestamptz NOT NULL DEFAULT now(),
          error text NOT NULL DEFAULT '',
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb
        );
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

function stringRow(row: Record<string, unknown>): DashboardRow {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value === null || value === undefined
        ? ""
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value),
    ]),
  );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

const SYNC_ONLY_FIELDS = new Set(["__synced_at", "syncedAt", "Synced At"]);

/** A row's business content, excluding timestamps added by the sync transport. */
function canonicalBusinessRow(row: DashboardRow): string {
  return canonicalJson(
    Object.fromEntries(Object.entries(row).filter(([key]) => !SYNC_ONLY_FIELDS.has(key))),
  );
}

function first(row: DashboardRow, keys: string[]): string {
  for (const key of keys) {
    const value = row[key]?.trim();
    if (value) return value;
  }
  return "";
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Pick the best source identity available for this dataset.
 *
 * A global key list cannot be correct here: `Order ID` identifies an order in
 * the invoiced dataset but a row in some other exports. Prefer line ids for
 * line-grain facts and use a composite only when the source omitted one.
 */
function baseStableKey(dataset: DashboardDataset, row: DashboardRow): string {
  const universal = first(row, ["__meta_key", "__stable_key"]);
  if (universal) return `${dataset}:${universal}`;

  const candidates: Partial<Record<DashboardDataset, string[]>> = {
    accounting: ["__odoo_line_id", "Invoice Line ID", "Move Line ID", "__odoo_id"],
    accounting_legacy: ["__odoo_line_id", "Invoice Line ID", "Move Line ID", "__odoo_id"],
    invoiced: ["__odoo_line_id", "Invoice Line ID", "Order Line ID", "__odoo_id"],
    website_sales: ["__odoo_line_id", "Order Line ID", "__odoo_id"],
    crm: ["__odoo_id", "id", "ID"],
    lost: ["__odoo_id", "id", "ID"],
    pbx_extensions: ["extension"],
    sla_calls: ["call_id", "id", "ID"],
    sales_targets: ["employeeId"],
    media_plans: ["month"],
    sales_summary: ["__odoo_id", "id", "ID"],
  };
  const explicit = first(row, candidates[dataset] ?? []);
  if (explicit) return `${dataset}:${explicit}`;

  if (["meta_ads", "snap_ads", "ads_legacy"].includes(dataset)) {
    const parts = [
      first(row, ["Date", "date", "التاريخ"]),
      first(row, ["__account_id", "Account ID", "accountId"]),
      first(row, ["__campaign_id", "Campaign ID", "campaignId"]),
      first(row, ["__adset_id", "Ad Set ID", "adsetId"]),
      first(row, ["__ad_id", "Ad ID", "adId"]),
    ];
    if (parts.some(Boolean)) return `${dataset}:fact:${parts.join("\u001f")}`;
  }

  // Order references and invoice moves are deliberately not used alone. They
  // identify a parent document, not one of its product lines.
  return `${dataset}:sha256:${hash(canonicalBusinessRow(row))}`;
}

export interface PreparedDashboardRow {
  key: string;
  row: DashboardRow;
  canonical: string;
}

/**
 * Give every input row a unique key without dropping line items.
 *
 * The previous fix collapsed colliding keys with `Map.set(..., row)`. That made
 * PostgreSQL accept the statement by silently replacing every earlier product
 * line from the same order with the last one. A successful sync could therefore
 * be less complete than a failed one.
 *
 * Collisions now keep every row. Different business rows get a content-hash
 * suffix; byte-identical rows get an occurrence suffix as well. The latter is
 * necessary because two equal product lines can be legitimate and `replace`
 * semantics promise to preserve the payload exactly.
 */
export function prepareDashboardRows(
  dataset: DashboardDataset,
  rows: DashboardRow[],
): { rows: PreparedDashboardRow[]; duplicates: number } {
  const baseCounts = new Map<string, number>();
  const canonicalCounts = new Map<string, number>();
  let duplicates = 0;

  const prepared = rows.map((row) => {
    const base = baseStableKey(dataset, row);
    const canonical = canonicalBusinessRow(row);
    const contentKey = `${base}:row:${hash(canonical)}`;
    const contentSeen = canonicalCounts.get(contentKey) ?? 0;
    canonicalCounts.set(contentKey, contentSeen + 1);
    const baseSeen = baseCounts.get(base) ?? 0;
    baseCounts.set(base, baseSeen + 1);
    if (baseSeen === 0) return { key: base, row, canonical };

    duplicates += 1;
    return {
      key: contentSeen === 0 ? contentKey : `${contentKey}:occurrence:${contentSeen + 1}`,
      row,
      canonical,
    };
  });

  // A later colliding row may hash to the first row's unsuffixed key. Move the
  // first row onto the same collision-safe scheme so keys do not depend on which
  // line happened to arrive first.
  for (const [base, count] of baseCounts) {
    if (count < 2) continue;
    for (const item of prepared) {
      if (item.key !== base) continue;
      item.key = `${base}:row:${hash(item.canonical)}`;
    }
  }
  return { rows: prepared, duplicates };
}

/** Compatibility export retained for the ingest diagnostics added previously. */
export function dedupeByStableKey(
  dataset: DashboardDataset,
  rows: DashboardRow[],
): { rows: DashboardRow[]; duplicates: number } {
  const prepared = prepareDashboardRows(dataset, rows);
  return { rows: prepared.rows.map(({ row }) => row), duplicates: prepared.duplicates };
}

export function dashboardRowsContentHash(rows: PreparedDashboardRow[]): string {
  const digest = createHash("sha256");
  for (const item of [...rows].sort((a, b) => a.key.localeCompare(b.key))) {
    digest.update(item.key);
    digest.update("\u0000");
    digest.update(item.canonical);
    digest.update("\u0000");
  }
  return digest.digest("hex");
}

function recordDate(row: DashboardRow): string | null {
  const raw = first(row, [
    "Date",
    "Date ",
    "date",
    "Payment Date",
    "Order Date",
    "Creation Date",
    "Create Date",
    "__date",
    "started_at",
    "Started At",
  ]);
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const slash = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (!slash) return null;
  const month = Number(slash[1]);
  const day = Number(slash[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${slash[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function sourceUpdatedAt(row: DashboardRow): string | null {
  const raw = first(row, ["__odoo_write_date", "__source_updated_at", "updated_at"]);
  if (!raw) return null;
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T") + "Z";
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/**
 * Columns bound per row by `upsertChunk`. Changing the INSERT changes this.
 */
const BIND_PARAMS_PER_ROW = 6;

/**
 * PostgreSQL's hard ceiling on bind parameters in one statement.
 * Exceeding it fails the whole sync with `bind message has N parameter formats`.
 */
export const POSTGRES_MAX_BIND_PARAMS = 65_535;

/**
 * Rows per INSERT.
 *
 * Was 500, briefly 5,000, now 1,000. The jump to 5,000 was a mistake worth
 * recording: it was meant to cut round trips, but every row added to a batch
 * raises the chance that two rows sharing a `stable_key` land in the same
 * statement — and PostgreSQL rejects the whole command when that happens (see
 * `dedupeByStableKey`). Batching wider made a latent duplicate bug easier to
 * hit, not harder.
 *
 * With colliding source ids disambiguated before batching that hazard is gone, so the
 * size is chosen on cost alone: 1,000 rows is 6,000 of PostgreSQL's 65,535
 * bind parameters and turns a 6,650-row dataset into seven round trips instead
 * of fourteen, without building a ten-megabyte statement or holding it whole in
 * memory the way 5,000 did.
 */
export const INSERT_CHUNK_ROWS = Math.min(
  1_000,
  Math.floor(POSTGRES_MAX_BIND_PARAMS / BIND_PARAMS_PER_ROW),
);

async function upsertChunk(
  client: PoolClient,
  dataset: DashboardDataset,
  rows: PreparedDashboardRow[],
  syncedAt: string,
): Promise<void> {
  if (!rows.length) return;
  const values: unknown[] = [];
  const tuples = rows.map((item, index) => {
    const offset = index * 6;
    const { row } = item;
    values.push(
      dataset,
      item.key,
      JSON.stringify(row),
      recordDate(row),
      sourceUpdatedAt(row),
      syncedAt,
    );
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}::jsonb, $${offset + 4}::date, $${offset + 5}::timestamptz, $${offset + 6}::timestamptz)`;
  });
  await client.query(
    `INSERT INTO dashboard_rows
      (dataset, stable_key, row_data, record_date, source_updated_at, synced_at)
     VALUES ${tuples.join(",")}
     ON CONFLICT (dataset, stable_key) DO UPDATE SET
       row_data = EXCLUDED.row_data,
       record_date = EXCLUDED.record_date,
       source_updated_at = EXCLUDED.source_updated_at,
       synced_at = EXCLUDED.synced_at`,
    values,
  );
}

function emptySnapshot(dataset: DashboardDataset, configured: boolean): DatasetSnapshot {
  return {
    configured,
    dataset,
    rows: [],
    syncedAt: "",
    rowCount: 0,
    status: "never",
    error: "",
    metadata: {},
  };
}

/** Read several whole datasets with two queries rather than two per dataset. */
export async function readDashboardDatasets(
  datasets: readonly DashboardDataset[],
): Promise<DatasetSnapshot[]> {
  const unique = [...new Set(datasets)];
  if (!databaseConfigured()) return unique.map((dataset) => emptySnapshot(dataset, false));
  if (!unique.length) return [];

  await ensureSchema();
  const db = getPool();
  const [rowsResult, stateResult] = await Promise.all([
    db.query<{ dataset: DashboardDataset; row_data: Record<string, unknown> }>(
      `SELECT dataset, row_data
         FROM dashboard_rows
        WHERE dataset = ANY($1::text[])
        ORDER BY dataset, record_date NULLS LAST, stable_key`,
      [unique],
    ),
    db.query<{
      dataset: DashboardDataset;
      status: "success" | "failed";
      row_count: number;
      synced_at: Date;
      error: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT dataset, status, row_count, synced_at, error, metadata
         FROM dashboard_sync_state
        WHERE dataset = ANY($1::text[])`,
      [unique],
    ),
  ]);

  const rowsByDataset = new Map<DashboardDataset, DashboardRow[]>();
  for (const { dataset, row_data } of rowsResult.rows) {
    const bucket = rowsByDataset.get(dataset) ?? [];
    bucket.push(stringRow(row_data));
    rowsByDataset.set(dataset, bucket);
  }
  const states = new Map(stateResult.rows.map((state) => [state.dataset, state]));

  return unique.map((dataset) => {
    const rows = rowsByDataset.get(dataset) ?? [];
    const state = states.get(dataset);
    return {
      configured: true,
      dataset,
      rows,
      syncedAt: state?.synced_at ? new Date(state.synced_at).toISOString() : "",
      rowCount: state?.row_count ?? rows.length,
      status: state?.status ?? "never",
      error: state?.error ?? "",
      metadata: state?.metadata ?? {},
    };
  });
}

/** Lightweight sync metadata for health/operations; never reads `row_data`. */
export async function readDashboardDatasetStates(
  datasets: readonly DashboardDataset[],
): Promise<DatasetState[]> {
  const unique = [...new Set(datasets)];
  if (!databaseConfigured() || !unique.length) return [];
  await ensureSchema();
  const result = await getPool().query<{
    dataset: DashboardDataset;
    status: "success" | "failed";
    row_count: number;
    synced_at: Date;
    error: string;
  }>(
    `SELECT dataset, status, row_count, synced_at, error
       FROM dashboard_sync_state
      WHERE dataset = ANY($1::text[])`,
    [unique],
  );
  const states = new Map(result.rows.map((state) => [state.dataset, state]));
  return unique.map((dataset) => {
    const state = states.get(dataset);
    return {
      dataset,
      rowCount: state?.row_count ?? 0,
      syncedAt: state?.synced_at ? new Date(state.synced_at).toISOString() : "",
      status: state?.status ?? "never",
      error: state?.error ?? "",
    };
  });
}

export async function readDashboardDataset(dataset: DashboardDataset): Promise<DatasetSnapshot> {
  if (!databaseConfigured()) {
    return emptySnapshot(dataset, false);
  }
  return (await readDashboardDatasets([dataset]))[0];
}

export async function writeDashboardDataset(
  dataset: DashboardDataset,
  inputRows: Record<string, unknown>[],
  options: {
    mode?: "upsert" | "replace";
    syncedAt?: string;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<DatasetWriteResult> {
  await ensureSchema();
  const { rows, duplicates } = prepareDashboardRows(dataset, inputRows.map(stringRow));
  const contentHash = dashboardRowsContentHash(rows);
  const syncedAtRaw = options.syncedAt?.trim();
  const syncedAt =
    syncedAtRaw && Number.isFinite(Date.parse(syncedAtRaw))
      ? new Date(syncedAtRaw).toISOString()
      : new Date().toISOString();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // A dataset replace is one logical write. Serialise competing writers for
    // this dataset so two n8n runs cannot interleave DELETE/INSERT operations.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [dataset]);

    const metadata = { ...(options.metadata ?? {}), contentHash };
    if (options.mode === "replace") {
      const existing = await client.query<{ row_count: number; content_hash: string }>(
        `SELECT row_count, metadata->>'contentHash' AS content_hash
           FROM dashboard_sync_state
          WHERE dataset = $1`,
        [dataset],
      );
      const state = existing.rows[0];
      if (state?.content_hash === contentHash && state.row_count === rows.length) {
        await client.query(
          `UPDATE dashboard_sync_state
              SET status = 'success', synced_at = $2::timestamptz, error = '', metadata = $3::jsonb
            WHERE dataset = $1`,
          [dataset, syncedAt, JSON.stringify(metadata)],
        );
        await client.query("COMMIT");
        return {
          dataset,
          receivedRows: inputRows.length,
          rowCount: rows.length,
          syncedAt,
          duplicates,
          writtenRows: 0,
          unchanged: true,
        };
      }
      await client.query(`DELETE FROM dashboard_rows WHERE dataset = $1`, [dataset]);
    }
    for (let index = 0; index < rows.length; index += INSERT_CHUNK_ROWS) {
      await upsertChunk(client, dataset, rows.slice(index, index + INSERT_CHUNK_ROWS), syncedAt);
    }
    const rowCount =
      options.mode === "replace"
        ? rows.length
        : Number(
            (
              await client.query<{ count: string }>(
                `SELECT count(*)::text AS count FROM dashboard_rows WHERE dataset = $1`,
                [dataset],
              )
            ).rows[0]?.count ?? 0,
          );
    await client.query(
      `INSERT INTO dashboard_sync_state
         (dataset, status, row_count, synced_at, error, metadata)
       VALUES ($1, 'success', $2, $3::timestamptz, '', $4::jsonb)
       ON CONFLICT (dataset) DO UPDATE SET
         status = EXCLUDED.status,
         row_count = EXCLUDED.row_count,
         synced_at = EXCLUDED.synced_at,
         error = EXCLUDED.error,
         metadata = EXCLUDED.metadata`,
      [dataset, rowCount, syncedAt, JSON.stringify(metadata)],
    );
    await client.query("COMMIT");
    return {
      dataset,
      receivedRows: inputRows.length,
      rowCount,
      syncedAt,
      duplicates,
      writtenRows: rows.length,
      unchanged: false,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function markDashboardDatasetFailed(
  dataset: DashboardDataset,
  message: string,
): Promise<void> {
  if (!databaseConfigured()) return;
  await ensureSchema();
  await getPool().query(
    `INSERT INTO dashboard_sync_state (dataset, status, row_count, synced_at, error)
     VALUES ($1, 'failed', 0, now(), $2)
     ON CONFLICT (dataset) DO UPDATE SET
       status = EXCLUDED.status,
       error = EXCLUDED.error`,
    [dataset, message.slice(0, 500)],
  );
}
