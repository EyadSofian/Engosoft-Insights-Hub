// Server-only durable store for the price book and its invoice audit.
//
// This gets its own relational tables rather than another `dashboard_rows`
// dataset. `dashboard_rows` is a key/JSONB last-good cache for whole datasets
// that a sync job replaces wholesale; a price book is the opposite shape —
// versioned, edited a row at a time, joined against invoice lines, and required
// to still say in March what a course cost in January. Squeezing that into a
// replace-the-whole-dataset store is how a published price quietly changes
// under a finished audit.
//
// Two invariants the schema exists to protect:
//
//   * A published book is immutable. Editing one produces a new version; the
//     old rows stay exactly as they were so a February invoice keeps being
//     judged against February's price.
//   * Publishing is atomic. A book becomes live, and any book it replaces is
//     archived, inside one transaction.
import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import type {
  ComplianceStatus,
  InvoicePriceAudit,
  MatchType,
  PaymentMethod,
  PriceBook,
  PriceBookItem,
  PriceBookStatus,
  PriceMethodScope,
  PriceRule,
  PriceSourceType,
  PricingContext,
  PricingScope,
  ProductMapping,
} from "./pricing-types.ts";

let pool: Pool | null = null;
let schemaPromise: Promise<void> | null = null;

export function pricingDatabaseConfigured(): boolean {
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

const SCHEMA = `
CREATE TABLE IF NOT EXISTS price_books (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','published','archived')),
  effective_from date,
  effective_to date,
  source_type text NOT NULL DEFAULT 'manual',
  source_name text NOT NULL DEFAULT '',
  source_url text NOT NULL DEFAULT '',
  source_checksum text NOT NULL DEFAULT '',
  tax_inclusive boolean NOT NULL DEFAULT true,
  base_currency text NOT NULL DEFAULT 'SAR',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT '',
  published_at timestamptz,
  published_by text NOT NULL DEFAULT '',
  copied_from_id uuid
);
CREATE INDEX IF NOT EXISTS price_books_status_idx ON price_books (status);
CREATE INDEX IF NOT EXISTS price_books_effective_idx ON price_books (effective_from, effective_to);
CREATE UNIQUE INDEX IF NOT EXISTS price_books_version_idx ON price_books (version);

CREATE TABLE IF NOT EXISTS price_book_items (
  id uuid PRIMARY KEY,
  price_book_id uuid NOT NULL REFERENCES price_books(id) ON DELETE CASCADE,
  source_sheet text NOT NULL DEFAULT '',
  source_row integer NOT NULL DEFAULT 0,
  specialization text NOT NULL DEFAULT '',
  subcategory text NOT NULL DEFAULT '',
  raw_product_code text NOT NULL DEFAULT '',
  normalized_product_code text NOT NULL DEFAULT '',
  odoo_product_id integer,
  course_name text NOT NULL DEFAULT '',
  normalized_course_name text NOT NULL DEFAULT '',
  delivery_type text NOT NULL DEFAULT 'unknown',
  raw_delivery_type text NOT NULL DEFAULT '',
  level text NOT NULL DEFAULT '',
  pricing_scope text NOT NULL DEFAULT 'individual',
  bundle_name text NOT NULL DEFAULT '',
  payment_method text NOT NULL DEFAULT 'any',
  currency text NOT NULL DEFAULT 'SAR',
  exact_price numeric(14,2),
  minimum_price numeric(14,2),
  maximum_price numeric(14,2),
  valid_from date,
  valid_to date,
  country text NOT NULL DEFAULT '',
  company text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  requires_review boolean NOT NULL DEFAULT false,
  on_hold boolean NOT NULL DEFAULT false,
  note text NOT NULL DEFAULT '',
  raw_source_data jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS price_items_book_idx ON price_book_items (price_book_id);
CREATE INDEX IF NOT EXISTS price_items_code_idx
  ON price_book_items (normalized_product_code, price_book_id);
CREATE INDEX IF NOT EXISTS price_items_odoo_idx ON price_book_items (odoo_product_id);
CREATE INDEX IF NOT EXISTS price_items_course_idx ON price_book_items (normalized_course_name);
CREATE INDEX IF NOT EXISTS price_items_spec_idx ON price_book_items (specialization, subcategory);
CREATE INDEX IF NOT EXISTS price_items_method_idx ON price_book_items (payment_method, currency);
CREATE INDEX IF NOT EXISTS price_items_valid_idx ON price_book_items (valid_from, valid_to);
CREATE INDEX IF NOT EXISTS price_items_scope_idx ON price_book_items (pricing_scope, active);

CREATE TABLE IF NOT EXISTS price_product_mappings (
  price_item_id uuid NOT NULL REFERENCES price_book_items(id) ON DELETE CASCADE,
  odoo_product_id integer NOT NULL,
  odoo_product_code text NOT NULL DEFAULT '',
  match_type text NOT NULL CHECK (match_type IN ('exact_code','manual','alias')),
  confidence numeric(5,4) NOT NULL DEFAULT 1,
  approved_by text NOT NULL DEFAULT '',
  approved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (price_item_id, odoo_product_id)
);
CREATE INDEX IF NOT EXISTS price_mappings_product_idx ON price_product_mappings (odoo_product_id);
CREATE INDEX IF NOT EXISTS price_mappings_code_idx ON price_product_mappings (odoo_product_code);

CREATE TABLE IF NOT EXISTS price_change_log (
  id bigserial PRIMARY KEY,
  price_book_id uuid,
  price_item_id uuid,
  action text NOT NULL DEFAULT 'update',
  old_value jsonb,
  new_value jsonb,
  changed_by text NOT NULL DEFAULT '',
  changed_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS price_change_log_item_idx ON price_change_log (price_item_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS price_change_log_book_idx ON price_change_log (price_book_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS invoice_price_audits (
  invoice_line_id text PRIMARY KEY,
  invoice_number text NOT NULL DEFAULT '',
  price_book_id uuid,
  price_book_version integer NOT NULL DEFAULT 0,
  price_item_id uuid,
  payment_method text NOT NULL DEFAULT 'unknown',
  payment_method_raw text NOT NULL DEFAULT '',
  currency text NOT NULL DEFAULT '',
  quantity numeric(14,4) NOT NULL DEFAULT 0,
  actual_unit_price numeric(14,2) NOT NULL DEFAULT 0,
  allowed_minimum numeric(14,2),
  allowed_maximum numeric(14,2),
  compliance_status text NOT NULL,
  severity text NOT NULL DEFAULT 'none',
  variance_amount numeric(14,2) NOT NULL DEFAULT 0,
  variance_percent numeric(10,6),
  leakage_amount numeric(14,2) NOT NULL DEFAULT 0,
  match_type text NOT NULL DEFAULT 'none',
  reason text NOT NULL DEFAULT '',
  audited_at timestamptz NOT NULL DEFAULT now(),
  sale_date date,
  invoice_date date,
  payment_date date,
  salesperson text NOT NULL DEFAULT '',
  sales_team text NOT NULL DEFAULT '',
  company text NOT NULL DEFAULT '',
  product_code text NOT NULL DEFAULT '',
  product_name text NOT NULL DEFAULT '',
  price_source text NOT NULL DEFAULT 'price_book',
  pricing_context text NOT NULL DEFAULT 'unknown',
  pricing_context_name text NOT NULL DEFAULT '',
  sale_order_name text NOT NULL DEFAULT '',
  odoo_pricelist_id integer,
  odoo_pricelist_name text NOT NULL DEFAULT '',
  odoo_pricelist_item_id integer,
  odoo_pricelist_item_name text NOT NULL DEFAULT '',
  -- Fingerprint of the invoice line as audited, so unchanged lines are skipped.
  line_fingerprint text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS invoice_audits_status_idx ON invoice_price_audits (compliance_status);
CREATE INDEX IF NOT EXISTS invoice_audits_salesperson_idx ON invoice_price_audits (salesperson);
CREATE INDEX IF NOT EXISTS invoice_audits_payment_date_idx ON invoice_price_audits (payment_date);
CREATE INDEX IF NOT EXISTS invoice_audits_sale_date_idx ON invoice_price_audits (sale_date);
CREATE INDEX IF NOT EXISTS invoice_audits_invoice_idx ON invoice_price_audits (invoice_number);
CREATE INDEX IF NOT EXISTS invoice_audits_book_idx ON invoice_price_audits (price_book_id);
CREATE INDEX IF NOT EXISTS invoice_audits_severity_idx ON invoice_price_audits (severity, payment_date);
CREATE INDEX IF NOT EXISTS invoice_audits_product_idx ON invoice_price_audits (product_code);

CREATE TABLE IF NOT EXISTS invoice_payment_methods (
  invoice_number text PRIMARY KEY,
  method text NOT NULL DEFAULT 'unknown',
  methods jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw jsonb NOT NULL DEFAULT '[]'::jsonb,
  breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  source text NOT NULL DEFAULT 'none',
  read_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_payment_methods_method_idx ON invoice_payment_methods (method);

CREATE TABLE IF NOT EXISTS invoice_line_facts (
  invoice_line_id text PRIMARY KEY,
  invoice_number text NOT NULL DEFAULT '',
  odoo_product_id integer,
  product_code text NOT NULL DEFAULT '',
  quantity numeric(14,4) NOT NULL DEFAULT 0,
  price_unit numeric(14,4) NOT NULL DEFAULT 0,
  discount numeric(9,4) NOT NULL DEFAULT 0,
  price_subtotal numeric(14,2) NOT NULL DEFAULT 0,
  price_total numeric(14,2) NOT NULL DEFAULT 0,
  sale_order_line_id integer,
  sale_order_id integer,
  sale_order_name text NOT NULL DEFAULT '',
  pricelist_id integer,
  pricelist_name text NOT NULL DEFAULT '',
  pricelist_item_id integer,
  pricelist_item_name text NOT NULL DEFAULT '',
  expected_unit_price numeric(14,4),
  pricing_context text NOT NULL DEFAULT 'unknown',
  pricing_context_name text NOT NULL DEFAULT '',
  odoo_pricing_checked boolean NOT NULL DEFAULT false,
  pricing_lineage_version integer NOT NULL DEFAULT 0,
  read_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_line_facts_invoice_idx ON invoice_line_facts (invoice_number);

-- Existing deployments receive the Odoo package lineage without a destructive
-- migration. IF NOT EXISTS keeps startup idempotent across Railway restarts.
ALTER TABLE invoice_price_audits ADD COLUMN IF NOT EXISTS price_source text NOT NULL DEFAULT 'price_book';
ALTER TABLE invoice_price_audits ADD COLUMN IF NOT EXISTS pricing_context text NOT NULL DEFAULT 'unknown';
ALTER TABLE invoice_price_audits ADD COLUMN IF NOT EXISTS pricing_context_name text NOT NULL DEFAULT '';
ALTER TABLE invoice_price_audits ADD COLUMN IF NOT EXISTS sale_order_name text NOT NULL DEFAULT '';
ALTER TABLE invoice_price_audits ADD COLUMN IF NOT EXISTS odoo_pricelist_id integer;
ALTER TABLE invoice_price_audits ADD COLUMN IF NOT EXISTS odoo_pricelist_name text NOT NULL DEFAULT '';
ALTER TABLE invoice_price_audits ADD COLUMN IF NOT EXISTS odoo_pricelist_item_id integer;
ALTER TABLE invoice_price_audits ADD COLUMN IF NOT EXISTS odoo_pricelist_item_name text NOT NULL DEFAULT '';
ALTER TABLE invoice_line_facts ADD COLUMN IF NOT EXISTS sale_order_line_id integer;
ALTER TABLE invoice_line_facts ADD COLUMN IF NOT EXISTS sale_order_id integer;
ALTER TABLE invoice_line_facts ADD COLUMN IF NOT EXISTS sale_order_name text NOT NULL DEFAULT '';
ALTER TABLE invoice_line_facts ADD COLUMN IF NOT EXISTS pricelist_id integer;
ALTER TABLE invoice_line_facts ADD COLUMN IF NOT EXISTS pricelist_name text NOT NULL DEFAULT '';
ALTER TABLE invoice_line_facts ADD COLUMN IF NOT EXISTS pricelist_item_id integer;
ALTER TABLE invoice_line_facts ADD COLUMN IF NOT EXISTS pricelist_item_name text NOT NULL DEFAULT '';
ALTER TABLE invoice_line_facts ADD COLUMN IF NOT EXISTS expected_unit_price numeric(14,4);
ALTER TABLE invoice_line_facts ADD COLUMN IF NOT EXISTS pricing_context text NOT NULL DEFAULT 'unknown';
ALTER TABLE invoice_line_facts ADD COLUMN IF NOT EXISTS pricing_context_name text NOT NULL DEFAULT '';
ALTER TABLE invoice_line_facts ADD COLUMN IF NOT EXISTS odoo_pricing_checked boolean NOT NULL DEFAULT false;
ALTER TABLE invoice_line_facts ADD COLUMN IF NOT EXISTS pricing_lineage_version integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS invoice_audits_context_idx ON invoice_price_audits (pricing_context, compliance_status);

CREATE TABLE IF NOT EXISTS price_payment_aliases (
  alias text PRIMARY KEY,
  method text NOT NULL,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS price_alert_log (
  alert_key text PRIMARY KEY,
  invoice_line_id text NOT NULL,
  price_book_version integer NOT NULL DEFAULT 0,
  compliance_status text NOT NULL DEFAULT '',
  sent_at timestamptz NOT NULL DEFAULT now(),
  channel text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS price_alert_log_sent_idx ON price_alert_log (sent_at DESC);

CREATE TABLE IF NOT EXISTS price_audit_state (
  id integer PRIMARY KEY DEFAULT 1,
  last_run_at timestamptz,
  last_book_id uuid,
  last_book_version integer NOT NULL DEFAULT 0,
  audited_lines integer NOT NULL DEFAULT 0,
  window_from date,
  window_to date,
  last_error text NOT NULL DEFAULT '',
  CONSTRAINT price_audit_state_single CHECK (id = 1)
);
`;

export async function ensurePricingSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = getPool()
      .query(SCHEMA)
      .then(() => undefined)
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }
  await schemaPromise;
}

/* --- row mapping ----------------------------------------------------------- */

const str = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value);
const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const isoDate = (value: unknown): string => {
  if (!value) return "";
  if (value instanceof Date) {
    // PostgreSQL DATE has no timezone. The pg driver materialises it at local
    // midnight; converting that value to UTC can move Cairo dates one day
    // backwards. Preserve the calendar fields exactly as stored.
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return str(value).slice(0, 10);
};
const isoTime = (value: unknown): string => {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  return str(value);
};

type BookRow = Record<string, unknown>;

function toBook(row: BookRow, itemCount = 0): PriceBook {
  return {
    id: str(row.id),
    name: str(row.name),
    version: Number(row.version ?? 0),
    status: str(row.status) as PriceBookStatus,
    effectiveFrom: isoDate(row.effective_from),
    effectiveTo: isoDate(row.effective_to),
    sourceType: (str(row.source_type) || "manual") as PriceSourceType,
    sourceName: str(row.source_name),
    sourceUrl: str(row.source_url),
    sourceChecksum: str(row.source_checksum),
    taxInclusive: row.tax_inclusive !== false,
    baseCurrency: str(row.base_currency) || "SAR",
    notes: str(row.notes),
    createdAt: isoTime(row.created_at),
    createdBy: str(row.created_by),
    publishedAt: isoTime(row.published_at),
    publishedBy: str(row.published_by),
    itemCount: Number(row.item_count ?? itemCount) || 0,
    copiedFromId: str(row.copied_from_id),
  };
}

function toItem(row: Record<string, unknown>): PriceBookItem {
  return {
    id: str(row.id),
    priceBookId: str(row.price_book_id),
    sourceSheet: str(row.source_sheet),
    sourceRow: Number(row.source_row ?? 0),
    specialization: str(row.specialization),
    subcategory: str(row.subcategory),
    rawProductCode: str(row.raw_product_code),
    normalizedProductCode: str(row.normalized_product_code),
    // Published price books are immutable, so automatic exact-code matches
    // live in price_product_mappings rather than rewriting the published row.
    // Read the approved mapping as the effective product id so the UI does not
    // incorrectly call a working code match "unlinked".
    odooProductId: num(row.resolved_odoo_product_id) ?? num(row.odoo_product_id),
    courseName: str(row.course_name),
    normalizedCourseName: str(row.normalized_course_name),
    deliveryType: str(row.delivery_type) as PriceBookItem["deliveryType"],
    rawDeliveryType: str(row.raw_delivery_type),
    level: str(row.level),
    pricingScope: str(row.pricing_scope) as PricingScope,
    bundleName: str(row.bundle_name),
    paymentMethod: str(row.payment_method) as PriceMethodScope,
    currency: str(row.currency),
    exactPrice: num(row.exact_price),
    minimumPrice: num(row.minimum_price),
    maximumPrice: num(row.maximum_price),
    validFrom: isoDate(row.valid_from),
    validTo: isoDate(row.valid_to),
    country: str(row.country),
    company: str(row.company),
    active: row.active !== false,
    requiresReview: row.requires_review === true,
    onHold: row.on_hold === true,
    note: str(row.note),
    rawSourceData: (row.raw_source_data ?? {}) as Record<string, string>,
  };
}

export const itemToRule = (item: PriceBookItem): PriceRule => ({
  id: item.id,
  priceBookId: item.priceBookId,
  normalizedProductCode: item.normalizedProductCode,
  odooProductId: item.odooProductId,
  courseName: item.courseName,
  deliveryType: item.deliveryType,
  pricingScope: item.pricingScope,
  paymentMethod: item.paymentMethod,
  currency: item.currency,
  exactPrice: item.exactPrice,
  minimumPrice: item.minimumPrice,
  maximumPrice: item.maximumPrice,
  validFrom: item.validFrom,
  validTo: item.validTo,
  country: item.country,
  active: item.active,
  requiresReview: item.requiresReview,
  onHold: item.onHold,
});

/* --- books ----------------------------------------------------------------- */

const BOOK_COLUMNS = `b.id, b.name, b.version, b.status, b.effective_from, b.effective_to,
  b.source_type, b.source_name, b.source_url, b.source_checksum, b.tax_inclusive,
  b.base_currency, b.notes, b.created_at, b.created_by, b.published_at, b.published_by,
  b.copied_from_id,
  (SELECT count(*) FROM price_book_items i WHERE i.price_book_id = b.id) AS item_count`;

export async function listPriceBooks(): Promise<PriceBook[]> {
  await ensurePricingSchema();
  const result = await getPool().query<BookRow>(
    `SELECT ${BOOK_COLUMNS} FROM price_books b ORDER BY b.version DESC`,
  );
  return result.rows.map((row) => toBook(row));
}

export async function getPriceBook(id: string): Promise<PriceBook | null> {
  await ensurePricingSchema();
  const result = await getPool().query<BookRow>(
    `SELECT ${BOOK_COLUMNS} FROM price_books b WHERE b.id = $1`,
    [id],
  );
  return result.rows[0] ? toBook(result.rows[0]) : null;
}

/**
 * The book that priced a sale on `date`.
 *
 * Effective windows win over recency: a September invoice must find September's
 * book even after October has been published, or every price rise would show up
 * as a wave of September breaches.
 */
export async function publishedBookForDate(date: string): Promise<PriceBook | null> {
  await ensurePricingSchema();
  const result = await getPool().query<BookRow>(
    `SELECT ${BOOK_COLUMNS}
       FROM price_books b
      WHERE b.status = 'published'
        AND (b.effective_from IS NULL OR b.effective_from <= $1::date)
        AND (b.effective_to IS NULL OR b.effective_to >= $1::date)
      ORDER BY b.effective_from DESC NULLS LAST, b.version DESC
      LIMIT 1`,
    [date],
  );
  return result.rows[0] ? toBook(result.rows[0]) : null;
}

export async function currentPublishedBook(): Promise<PriceBook | null> {
  await ensurePricingSchema();
  const today = new Date().toISOString().slice(0, 10);
  return (
    (await publishedBookForDate(today)) ??
    (
      await getPool().query<BookRow>(
        `SELECT ${BOOK_COLUMNS} FROM price_books b
          WHERE b.status = 'published'
          ORDER BY b.published_at DESC NULLS LAST, b.version DESC LIMIT 1`,
      )
    ).rows.map((row) => toBook(row))[0] ??
    null
  );
}

export interface CreateBookInput {
  name: string;
  effectiveFrom: string;
  effectiveTo: string;
  sourceType: PriceSourceType;
  sourceName?: string;
  sourceUrl?: string;
  sourceChecksum?: string;
  taxInclusive?: boolean;
  baseCurrency?: string;
  notes?: string;
  copiedFromId?: string;
}

export function checksum(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function nextVersion(client: PoolClient): Promise<number> {
  const result = await client.query<{ next: string }>(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM price_books`,
  );
  return Number(result.rows[0]?.next ?? 1);
}

export async function createPriceBook(
  input: CreateBookInput,
  items: Omit<PriceBookItem, "id" | "priceBookId">[],
  actor: string,
): Promise<PriceBook> {
  await ensurePricingSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('price_books'))`);
    const version = await nextVersion(client);
    const id = randomUUID();

    await client.query(
      `INSERT INTO price_books
         (id, name, version, status, effective_from, effective_to, source_type, source_name,
          source_url, source_checksum, tax_inclusive, base_currency, notes, created_by, copied_from_id)
       VALUES ($1,$2,$3,'draft',$4::date,$5::date,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        id,
        input.name,
        version,
        input.effectiveFrom || null,
        input.effectiveTo || null,
        input.sourceType,
        input.sourceName ?? "",
        input.sourceUrl ?? "",
        input.sourceChecksum ?? "",
        input.taxInclusive ?? true,
        input.baseCurrency ?? "SAR",
        input.notes ?? "",
        actor,
        input.copiedFromId || null,
      ],
    );
    await insertItems(client, id, items);
    await client.query(
      `INSERT INTO price_change_log (price_book_id, action, new_value, changed_by, reason)
       VALUES ($1, 'create_book', $2::jsonb, $3, $4)`,
      [
        id,
        JSON.stringify({ name: input.name, version, items: items.length }),
        actor,
        input.notes ?? "",
      ],
    );
    await client.query("COMMIT");
    return (await getPriceBook(id)) as PriceBook;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Rows per INSERT: 30 bound parameters each, well under PostgreSQL's 65,535. */
const ITEM_CHUNK = 500;

async function insertItems(
  client: PoolClient,
  bookId: string,
  items: Omit<PriceBookItem, "id" | "priceBookId">[],
): Promise<void> {
  const columns = 30;
  for (let start = 0; start < items.length; start += ITEM_CHUNK) {
    const chunk = items.slice(start, start + ITEM_CHUNK);
    const values: unknown[] = [];
    const tuples = chunk.map((item, index) => {
      const offset = index * columns;
      values.push(
        randomUUID(),
        bookId,
        item.sourceSheet,
        item.sourceRow,
        item.specialization,
        item.subcategory,
        item.rawProductCode,
        item.normalizedProductCode,
        item.odooProductId,
        item.courseName,
        item.normalizedCourseName,
        item.deliveryType,
        item.rawDeliveryType,
        item.level,
        item.pricingScope,
        item.bundleName,
        item.paymentMethod,
        item.currency,
        item.exactPrice,
        item.minimumPrice,
        item.maximumPrice,
        item.validFrom || null,
        item.validTo || null,
        item.country,
        item.company,
        item.active,
        item.requiresReview,
        item.onHold,
        item.note,
        JSON.stringify(item.rawSourceData ?? {}),
      );
      const placeholders = Array.from(
        { length: columns },
        (_, column) => `$${offset + column + 1}`,
      );
      placeholders[21] = `${placeholders[21]}::date`;
      placeholders[22] = `${placeholders[22]}::date`;
      placeholders[29] = `${placeholders[29]}::jsonb`;
      return `(${placeholders.join(",")})`;
    });
    await client.query(
      `INSERT INTO price_book_items
        (id, price_book_id, source_sheet, source_row, specialization, subcategory,
         raw_product_code, normalized_product_code, odoo_product_id, course_name,
         normalized_course_name, delivery_type, raw_delivery_type, level, pricing_scope,
         bundle_name, payment_method, currency, exact_price, minimum_price, maximum_price,
         valid_from, valid_to, country, company, active, requires_review, on_hold, note,
         raw_source_data)
       VALUES ${tuples.join(",")}`,
      values,
    );
  }
}

/**
 * Copy a book into a new draft.
 *
 * The mechanism the specification asks for behind "create next month from last
 * month": the source stays untouched and published, and the copy is a fresh
 * draft nobody's invoices point at yet.
 */
export async function copyPriceBook(
  sourceId: string,
  input: Omit<CreateBookInput, "sourceType" | "copiedFromId">,
  actor: string,
): Promise<PriceBook> {
  const source = await getPriceBook(sourceId);
  if (!source) throw new Error("The price book to copy was not found.");
  const items = await listPriceItems(sourceId);
  return createPriceBook(
    {
      ...input,
      sourceType: "manual",
      sourceName: `Copied from ${source.name} (v${source.version})`,
      sourceUrl: source.sourceUrl,
      sourceChecksum: source.sourceChecksum,
      taxInclusive: input.taxInclusive ?? source.taxInclusive,
      baseCurrency: input.baseCurrency ?? source.baseCurrency,
      copiedFromId: source.id,
    },
    items.map(({ id: _id, priceBookId: _bookId, ...rest }) => rest),
    actor,
  );
}

/**
 * Make a draft live, atomically.
 *
 * Any published book whose window overlaps is archived in the same transaction,
 * so there is never an instant where two books both claim a date, and never one
 * where none does.
 */
export async function publishPriceBook(id: string, actor: string): Promise<PriceBook> {
  await ensurePricingSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('price_books'))`);

    const book = await client.query<BookRow>(
      `SELECT id, status, effective_from, effective_to, version FROM price_books WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const target = book.rows[0];
    if (!target) throw new Error("Price book not found.");
    if (str(target.status) === "published")
      throw new Error("This price book is already published.");
    if (str(target.status) === "archived") {
      throw new Error(
        "An archived price book cannot be published. Copy it into a new draft first.",
      );
    }
    const count = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM price_book_items WHERE price_book_id = $1`,
      [id],
    );
    if (Number(count.rows[0]?.count ?? 0) === 0) {
      throw new Error("A price book with no rows cannot be published.");
    }

    const archived = await client.query<{ id: string }>(
      `UPDATE price_books
          SET status = 'archived'
        WHERE status = 'published'
          AND id <> $1
          AND (effective_from IS NULL OR $3::date IS NULL OR effective_from <= $3::date)
          AND (effective_to IS NULL OR $2::date IS NULL OR effective_to >= $2::date)
        RETURNING id`,
      [id, target.effective_from ?? null, target.effective_to ?? null],
    );

    await client.query(
      `UPDATE price_books SET status = 'published', published_at = now(), published_by = $2
        WHERE id = $1`,
      [id, actor],
    );
    await client.query(
      `INSERT INTO price_change_log (price_book_id, action, new_value, changed_by, reason)
       VALUES ($1, 'publish', $2::jsonb, $3, $4)`,
      [
        id,
        JSON.stringify({ archived: archived.rows.map((row) => row.id), version: target.version }),
        actor,
        "Published",
      ],
    );
    await client.query("COMMIT");
    return (await getPriceBook(id)) as PriceBook;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Return to an earlier book without deleting anything.
 *
 * Rollback re-publishes the older version and archives the newer one. Both rows
 * survive, so the change log still explains what happened and an invoice audited
 * under the newer book can still be traced to it.
 */
export async function rollbackToPriceBook(id: string, actor: string): Promise<PriceBook> {
  await ensurePricingSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('price_books'))`);
    const target = await client.query<BookRow>(
      `SELECT id, version, status FROM price_books WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!target.rows[0]) throw new Error("Price book not found.");

    const superseded = await client.query<{ id: string }>(
      `UPDATE price_books SET status = 'archived' WHERE status = 'published' AND id <> $1 RETURNING id`,
      [id],
    );
    await client.query(
      `UPDATE price_books SET status = 'published', published_at = now(), published_by = $2 WHERE id = $1`,
      [id, actor],
    );
    await client.query(
      `INSERT INTO price_change_log (price_book_id, action, new_value, changed_by, reason)
       VALUES ($1, 'rollback', $2::jsonb, $3, $4)`,
      [
        id,
        JSON.stringify({ archived: superseded.rows.map((row) => row.id) }),
        actor,
        "Rolled back to this version",
      ],
    );
    await client.query("COMMIT");
    return (await getPriceBook(id)) as PriceBook;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function archivePriceBook(id: string, actor: string): Promise<void> {
  await ensurePricingSchema();
  await getPool().query(`UPDATE price_books SET status = 'archived' WHERE id = $1`, [id]);
  await getPool().query(
    `INSERT INTO price_change_log (price_book_id, action, changed_by, reason)
     VALUES ($1, 'archive', $2, 'Archived')`,
    [id, actor],
  );
}

/* --- items ----------------------------------------------------------------- */

export interface ItemQuery {
  bookId: string;
  search?: string;
  specialization?: string;
  subcategory?: string;
  deliveryType?: string;
  paymentMethod?: string;
  currency?: string;
  country?: string;
  scope?: string;
  activeOnly?: boolean;
  needsReviewOnly?: boolean;
  unmappedOnly?: boolean;
  limit?: number;
  offset?: number;
}

const RESOLVED_ODOO_PRODUCT_ID = `(SELECT m.odoo_product_id
  FROM price_product_mappings m
  WHERE m.price_item_id = i.id AND m.approved_by <> ''
  ORDER BY CASE m.match_type WHEN 'manual' THEN 0 WHEN 'exact_code' THEN 1 ELSE 2 END,
           m.approved_at DESC
  LIMIT 1)`;

export async function listPriceItems(bookId: string): Promise<PriceBookItem[]> {
  await ensurePricingSchema();
  const result = await getPool().query(
    `SELECT i.*, ${RESOLVED_ODOO_PRODUCT_ID} AS resolved_odoo_product_id
     FROM price_book_items i
     WHERE i.price_book_id = $1
     ORDER BY i.source_sheet, i.source_row, i.payment_method`,
    [bookId],
  );
  return result.rows.map(toItem);
}

export async function queryPriceItems(
  query: ItemQuery,
): Promise<{ items: PriceBookItem[]; total: number }> {
  await ensurePricingSchema();
  const where: string[] = ["i.price_book_id = $1"];
  const values: unknown[] = [query.bookId];
  const add = (clause: string, value: unknown) => {
    values.push(value);
    where.push(clause.replace("$$", `$${values.length}`));
  };

  if (query.search?.trim()) {
    const term = `%${query.search.trim().toLowerCase()}%`;
    values.push(term);
    const placeholder = `$${values.length}`;
    where.push(
      `(lower(i.course_name) LIKE ${placeholder}
        OR lower(i.normalized_course_name) LIKE ${placeholder}
        OR lower(i.raw_product_code) LIKE ${placeholder}
        OR lower(i.normalized_product_code) LIKE ${placeholder}
        OR lower(i.bundle_name) LIKE ${placeholder}
        OR lower(i.subcategory) LIKE ${placeholder})`,
    );
  }
  if (query.specialization) add("i.specialization = $$", query.specialization);
  if (query.subcategory) add("i.subcategory = $$", query.subcategory);
  if (query.deliveryType) add("i.delivery_type = $$", query.deliveryType);
  if (query.paymentMethod)
    add("(i.payment_method = $$ OR i.payment_method = 'any')", query.paymentMethod);
  if (query.currency) add("i.currency = $$", query.currency);
  if (query.country) add("(i.country = $$ OR i.country = '')", query.country);
  if (query.scope) add("i.pricing_scope = $$", query.scope);
  if (query.activeOnly) where.push("i.active = true");
  if (query.needsReviewOnly) where.push("i.requires_review = true");
  if (query.unmappedOnly)
    where.push(`i.odoo_product_id IS NULL AND ${RESOLVED_ODOO_PRODUCT_ID} IS NULL`);

  const clause = where.join(" AND ");
  const limit = Math.min(Math.max(query.limit ?? 200, 1), 1000);
  const offset = Math.max(query.offset ?? 0, 0);

  const [rows, total] = await Promise.all([
    getPool().query(
      `SELECT i.*, ${RESOLVED_ODOO_PRODUCT_ID} AS resolved_odoo_product_id
       FROM price_book_items i WHERE ${clause}
        ORDER BY i.specialization, i.subcategory, i.course_name, i.pricing_scope, i.payment_method
        LIMIT ${limit} OFFSET ${offset}`,
      values,
    ),
    getPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM price_book_items i WHERE ${clause}`,
      values,
    ),
  ]);
  return {
    items: rows.rows.map(toItem),
    total: Number(total.rows[0]?.count ?? 0),
  };
}

const EDITABLE_COLUMNS: Record<string, string> = {
  exactPrice: "exact_price",
  minimumPrice: "minimum_price",
  maximumPrice: "maximum_price",
  validFrom: "valid_from",
  validTo: "valid_to",
  active: "active",
  requiresReview: "requires_review",
  onHold: "on_hold",
  note: "note",
  country: "country",
  company: "company",
  level: "level",
  bundleName: "bundle_name",
  paymentMethod: "payment_method",
  currency: "currency",
  pricingScope: "pricing_scope",
  odooProductId: "odoo_product_id",
  courseName: "course_name",
  specialization: "specialization",
  subcategory: "subcategory",
  deliveryType: "delivery_type",
};

export class PublishedBookImmutable extends Error {
  constructor() {
    super(
      "A published price book cannot be edited in place. Copy it into a new draft so past invoices keep their prices.",
    );
    this.name = "PublishedBookImmutable";
  }
}

/**
 * Change one field on one draft row.
 *
 * Refuses on a published book by design. The whole point of versioning is that
 * the number an old invoice was judged against does not move; allowing an
 * in-place edit "just this once" is what breaks that.
 */
export async function updatePriceItems(
  updates: { id: string; patch: Record<string, unknown> }[],
  actor: string,
  reason: string,
): Promise<{ updated: number }> {
  await ensurePricingSchema();
  if (!updates.length) return { updated: 0 };
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    let updated = 0;
    for (const { id, patch } of updates) {
      const before = await client.query(
        `SELECT i.*, b.status AS book_status
           FROM price_book_items i JOIN price_books b ON b.id = i.price_book_id
          WHERE i.id = $1 FOR UPDATE OF i`,
        [id],
      );
      const row = before.rows[0];
      if (!row) continue;
      if (str(row.book_status) !== "draft") throw new PublishedBookImmutable();

      const sets: string[] = [];
      const values: unknown[] = [];
      const changed: Record<string, unknown> = {};
      const previous: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(patch)) {
        const column = EDITABLE_COLUMNS[key];
        if (!column) continue;
        values.push(
          value === "" && (column.endsWith("_from") || column.endsWith("_to")) ? null : value,
        );
        const cast =
          column === "valid_from" || column === "valid_to"
            ? "::date"
            : column.endsWith("_price")
              ? "::numeric"
              : "";
        sets.push(`${column} = $${values.length}${cast}`);
        changed[key] = value;
        previous[key] = row[column];
      }
      if (!sets.length) continue;
      values.push(id);
      await client.query(
        `UPDATE price_book_items SET ${sets.join(", ")} WHERE id = $${values.length}`,
        values,
      );
      await client.query(
        `INSERT INTO price_change_log
           (price_book_id, price_item_id, action, old_value, new_value, changed_by, reason)
         VALUES ($1, $2, 'update', $3::jsonb, $4::jsonb, $5, $6)`,
        [
          str(row.price_book_id),
          id,
          JSON.stringify(previous),
          JSON.stringify(changed),
          actor,
          reason,
        ],
      );
      updated++;
    }
    await client.query("COMMIT");
    return { updated };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function addPriceItem(
  bookId: string,
  item: Omit<PriceBookItem, "id" | "priceBookId">,
  actor: string,
  reason: string,
): Promise<void> {
  await ensurePricingSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const book = await client.query<{ status: string }>(
      `SELECT status FROM price_books WHERE id = $1 FOR UPDATE`,
      [bookId],
    );
    if (!book.rows[0]) throw new Error("Price book not found.");
    if (book.rows[0].status !== "draft") throw new PublishedBookImmutable();
    await insertItems(client, bookId, [item]);
    await client.query(
      `INSERT INTO price_change_log (price_book_id, action, new_value, changed_by, reason)
       VALUES ($1, 'add_item', $2::jsonb, $3, $4)`,
      [bookId, JSON.stringify(item), actor, reason],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export interface ChangeLogEntry {
  id: number;
  priceBookId: string;
  priceItemId: string;
  action: string;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  changedBy: string;
  changedAt: string;
  reason: string;
  courseName: string;
  productCode: string;
}

export async function listChangeLog(
  filter: { bookId?: string; itemId?: string; limit?: number } = {},
): Promise<ChangeLogEntry[]> {
  await ensurePricingSchema();
  const where: string[] = [];
  const values: unknown[] = [];
  if (filter.bookId) {
    values.push(filter.bookId);
    where.push(`l.price_book_id = $${values.length}`);
  }
  if (filter.itemId) {
    values.push(filter.itemId);
    where.push(`l.price_item_id = $${values.length}`);
  }
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const result = await getPool().query(
    `SELECT l.*, i.course_name, i.raw_product_code
       FROM price_change_log l
       LEFT JOIN price_book_items i ON i.id = l.price_item_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY l.changed_at DESC, l.id DESC
      LIMIT ${limit}`,
    values,
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    priceBookId: str(row.price_book_id),
    priceItemId: str(row.price_item_id),
    action: str(row.action),
    oldValue: (row.old_value ?? null) as Record<string, unknown> | null,
    newValue: (row.new_value ?? null) as Record<string, unknown> | null,
    changedBy: str(row.changed_by),
    changedAt: isoTime(row.changed_at),
    reason: str(row.reason),
    courseName: str(row.course_name),
    productCode: str(row.raw_product_code),
  }));
}

/* --- mappings -------------------------------------------------------------- */

export async function listProductMappings(): Promise<ProductMapping[]> {
  await ensurePricingSchema();
  const result = await getPool().query(`SELECT * FROM price_product_mappings`);
  return result.rows.map((row) => ({
    priceItemId: str(row.price_item_id),
    odooProductId: Number(row.odoo_product_id),
    odooProductCode: str(row.odoo_product_code),
    matchType: str(row.match_type) as ProductMapping["matchType"],
    confidence: Number(row.confidence ?? 1),
    approvedBy: str(row.approved_by),
    approvedAt: isoTime(row.approved_at),
  }));
}

export async function upsertProductMappings(
  mappings: Omit<ProductMapping, "approvedAt">[],
  actor: string,
): Promise<number> {
  await ensurePricingSchema();
  if (!mappings.length) return 0;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const mapping of mappings) {
      await client.query(
        `INSERT INTO price_product_mappings
           (price_item_id, odoo_product_id, odoo_product_code, match_type, confidence, approved_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (price_item_id, odoo_product_id) DO UPDATE SET
           odoo_product_code = EXCLUDED.odoo_product_code,
           match_type = EXCLUDED.match_type,
           confidence = EXCLUDED.confidence,
           approved_by = EXCLUDED.approved_by,
           approved_at = now()`,
        [
          mapping.priceItemId,
          mapping.odooProductId,
          mapping.odooProductCode,
          mapping.matchType,
          mapping.confidence,
          actor,
        ],
      );
      await client.query(
        `INSERT INTO price_change_log (price_item_id, action, new_value, changed_by, reason)
         VALUES ($1, 'map_product', $2::jsonb, $3, 'Product mapping approved')`,
        [mapping.priceItemId, JSON.stringify(mapping), actor],
      );
    }
    await client.query("COMMIT");
    return mappings.length;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/* --- payment aliases ------------------------------------------------------- */

export async function listPaymentAliases(): Promise<Record<string, PaymentMethod>> {
  await ensurePricingSchema();
  const result = await getPool().query(`SELECT alias, method FROM price_payment_aliases`);
  return Object.fromEntries(
    result.rows.map((row) => [str(row.alias).toLowerCase(), str(row.method) as PaymentMethod]),
  );
}

export async function upsertPaymentAliases(
  aliases: { alias: string; method: PaymentMethod }[],
  actor: string,
): Promise<number> {
  await ensurePricingSchema();
  if (!aliases.length) return 0;
  for (const entry of aliases) {
    await getPool().query(
      `INSERT INTO price_payment_aliases (alias, method, created_by)
       VALUES ($1,$2,$3)
       ON CONFLICT (alias) DO UPDATE SET method = EXCLUDED.method, created_by = EXCLUDED.created_by`,
      [entry.alias.trim().toLowerCase(), entry.method, actor],
    );
  }
  await getPool().query(
    `INSERT INTO price_change_log (action, new_value, changed_by, reason)
     VALUES ('payment_alias', $1::jsonb, $2, 'Payment method aliases updated')`,
    [JSON.stringify(aliases), actor],
  );
  return aliases.length;
}

/* --- payment reads --------------------------------------------------------- */

export interface StoredPaymentRead {
  invoiceNumber: string;
  method: PaymentMethod;
  methods: PaymentMethod[];
  raw: string[];
  breakdown: { method: PaymentMethod; raw: string; amount: number }[];
  source: string;
  readAt: string;
}

export async function readStoredPayments(
  invoiceNumbers: string[],
): Promise<Map<string, StoredPaymentRead>> {
  await ensurePricingSchema();
  const unique = [...new Set(invoiceNumbers.filter(Boolean))];
  if (!unique.length) return new Map();
  const result = await getPool().query(
    `SELECT * FROM invoice_payment_methods WHERE invoice_number = ANY($1::text[])`,
    [unique],
  );
  return new Map(
    result.rows.map((row) => [
      str(row.invoice_number),
      {
        invoiceNumber: str(row.invoice_number),
        method: str(row.method) as PaymentMethod,
        methods: (row.methods ?? []) as PaymentMethod[],
        raw: (row.raw ?? []) as string[],
        breakdown: (row.breakdown ?? []) as StoredPaymentRead["breakdown"],
        source: str(row.source),
        readAt: isoTime(row.read_at),
      },
    ]),
  );
}

export async function writePaymentReads(reads: StoredPaymentRead[]): Promise<number> {
  await ensurePricingSchema();
  if (!reads.length) return 0;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (let start = 0; start < reads.length; start += 200) {
      const chunk = reads.slice(start, start + 200);
      const values: unknown[] = [];
      const tuples = chunk.map((read, index) => {
        const offset = index * 6;
        values.push(
          read.invoiceNumber,
          read.method,
          JSON.stringify(read.methods),
          JSON.stringify(read.raw),
          JSON.stringify(read.breakdown),
          read.source,
        );
        return `($${offset + 1},$${offset + 2},$${offset + 3}::jsonb,$${offset + 4}::jsonb,$${offset + 5}::jsonb,$${offset + 6})`;
      });
      await client.query(
        `INSERT INTO invoice_payment_methods (invoice_number, method, methods, raw, breakdown, source)
         VALUES ${tuples.join(",")}
         ON CONFLICT (invoice_number) DO UPDATE SET
           method = EXCLUDED.method,
           methods = EXCLUDED.methods,
           raw = EXCLUDED.raw,
           breakdown = EXCLUDED.breakdown,
           source = EXCLUDED.source,
           read_at = now()`,
        values,
      );
    }
    await client.query("COMMIT");
    return reads.length;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/* --- invoice line facts ---------------------------------------------------- */

export interface StoredLineFact {
  invoiceLineId: string;
  invoiceNumber: string;
  odooProductId: number | null;
  productCode: string;
  quantity: number;
  priceUnit: number;
  discount: number;
  priceSubtotal: number;
  priceTotal: number;
  saleOrderLineId: number | null;
  saleOrderId: number | null;
  saleOrderName: string;
  pricelistId: number | null;
  pricelistName: string;
  pricelistItemId: number | null;
  pricelistItemName: string;
  expectedUnitPrice: number | null;
  pricingContext: PricingContext;
  pricingContextName: string;
  odooPricingChecked: boolean;
  pricingLineageVersion: number;
}

/**
 * Quantity and product for lines the accounting export does not carry them for.
 *
 * Cached because they never change for a posted line: reading them once per line
 * is the difference between a handful of Odoo calls and a per-page bill.
 */
export async function readStoredLineFacts(
  invoiceLineIds: string[],
): Promise<Map<string, StoredLineFact>> {
  await ensurePricingSchema();
  const unique = [...new Set(invoiceLineIds.filter(Boolean))];
  if (!unique.length) return new Map();
  const out = new Map<string, StoredLineFact>();
  for (let start = 0; start < unique.length; start += 5000) {
    const result = await getPool().query(
      `SELECT * FROM invoice_line_facts WHERE invoice_line_id = ANY($1::text[])`,
      [unique.slice(start, start + 5000)],
    );
    for (const row of result.rows) {
      out.set(str(row.invoice_line_id), {
        invoiceLineId: str(row.invoice_line_id),
        invoiceNumber: str(row.invoice_number),
        odooProductId: num(row.odoo_product_id),
        productCode: str(row.product_code),
        quantity: Number(row.quantity ?? 0),
        priceUnit: Number(row.price_unit ?? 0),
        discount: Number(row.discount ?? 0),
        priceSubtotal: Number(row.price_subtotal ?? 0),
        priceTotal: Number(row.price_total ?? 0),
        saleOrderLineId: num(row.sale_order_line_id),
        saleOrderId: num(row.sale_order_id),
        saleOrderName: str(row.sale_order_name),
        pricelistId: num(row.pricelist_id),
        pricelistName: str(row.pricelist_name),
        pricelistItemId: num(row.pricelist_item_id),
        pricelistItemName: str(row.pricelist_item_name),
        expectedUnitPrice: num(row.expected_unit_price),
        pricingContext: (str(row.pricing_context) || "unknown") as PricingContext,
        pricingContextName: str(row.pricing_context_name),
        odooPricingChecked: row.odoo_pricing_checked === true,
        pricingLineageVersion: Number(row.pricing_lineage_version ?? 0) || 0,
      });
    }
  }
  return out;
}

export async function writeLineFacts(facts: StoredLineFact[]): Promise<number> {
  await ensurePricingSchema();
  if (!facts.length) return 0;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (let start = 0; start < facts.length; start += 400) {
      const chunk = facts.slice(start, start + 400);
      const values: unknown[] = [];
      const tuples = chunk.map((fact, index) => {
        const offset = index * 21;
        values.push(
          fact.invoiceLineId,
          fact.invoiceNumber,
          fact.odooProductId,
          fact.productCode,
          fact.quantity,
          fact.priceUnit,
          fact.discount,
          fact.priceSubtotal,
          fact.priceTotal,
          fact.saleOrderLineId,
          fact.saleOrderId,
          fact.saleOrderName,
          fact.pricelistId,
          fact.pricelistName,
          fact.pricelistItemId,
          fact.pricelistItemName,
          fact.expectedUnitPrice,
          fact.pricingContext,
          fact.pricingContextName,
          fact.odooPricingChecked,
          fact.pricingLineageVersion,
        );
        return `(${Array.from({ length: 21 }, (_, column) => `$${offset + column + 1}`).join(",")})`;
      });
      await client.query(
        `INSERT INTO invoice_line_facts
           (invoice_line_id, invoice_number, odoo_product_id, product_code, quantity,
            price_unit, discount, price_subtotal, price_total, sale_order_line_id,
            sale_order_id, sale_order_name, pricelist_id, pricelist_name, pricelist_item_id,
            pricelist_item_name, expected_unit_price, pricing_context, pricing_context_name,
            odoo_pricing_checked, pricing_lineage_version)
         VALUES ${tuples.join(",")}
         ON CONFLICT (invoice_line_id) DO UPDATE SET
           invoice_number = EXCLUDED.invoice_number,
           odoo_product_id = EXCLUDED.odoo_product_id,
           product_code = EXCLUDED.product_code,
           quantity = EXCLUDED.quantity,
           price_unit = EXCLUDED.price_unit,
           discount = EXCLUDED.discount,
           price_subtotal = EXCLUDED.price_subtotal,
           price_total = EXCLUDED.price_total,
           sale_order_line_id = EXCLUDED.sale_order_line_id,
           sale_order_id = EXCLUDED.sale_order_id,
           sale_order_name = EXCLUDED.sale_order_name,
           pricelist_id = EXCLUDED.pricelist_id,
           pricelist_name = EXCLUDED.pricelist_name,
           pricelist_item_id = EXCLUDED.pricelist_item_id,
           pricelist_item_name = EXCLUDED.pricelist_item_name,
           expected_unit_price = EXCLUDED.expected_unit_price,
           pricing_context = EXCLUDED.pricing_context,
           pricing_context_name = EXCLUDED.pricing_context_name,
           odoo_pricing_checked = EXCLUDED.odoo_pricing_checked,
           pricing_lineage_version = EXCLUDED.pricing_lineage_version,
           read_at = now()`,
        values,
      );
    }
    await client.query("COMMIT");
    return facts.length;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/* --- audits ---------------------------------------------------------------- */

export async function readAuditFingerprints(): Promise<Map<string, string>> {
  await ensurePricingSchema();
  const result = await getPool().query<{ invoice_line_id: string; line_fingerprint: string }>(
    `SELECT invoice_line_id, line_fingerprint FROM invoice_price_audits`,
  );
  return new Map(result.rows.map((row) => [row.invoice_line_id, row.line_fingerprint]));
}

export async function writeAudits(
  audits: (InvoicePriceAudit & { lineFingerprint: string })[],
): Promise<number> {
  await ensurePricingSchema();
  if (!audits.length) return 0;
  const columns = 37;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (let start = 0; start < audits.length; start += 400) {
      const chunk = audits.slice(start, start + 400);
      const values: unknown[] = [];
      const tuples = chunk.map((audit, index) => {
        const offset = index * columns;
        values.push(
          audit.invoiceLineId,
          audit.invoiceNumber,
          audit.priceBookId || null,
          audit.priceBookVersion,
          audit.priceItemId || null,
          audit.paymentMethod,
          audit.paymentMethodRaw.slice(0, 500),
          audit.currency,
          audit.quantity,
          audit.actualUnitPrice,
          audit.allowedMinimum,
          audit.allowedMaximum,
          audit.complianceStatus,
          audit.severity,
          audit.varianceAmount,
          audit.variancePercent,
          audit.leakageAmount,
          audit.matchType,
          audit.reason.slice(0, 1000),
          audit.saleDate || null,
          audit.invoiceDate || null,
          audit.paymentDate || null,
          audit.salesperson,
          audit.salesTeam,
          audit.company,
          audit.productCode,
          audit.productName,
          audit.priceSource,
          audit.pricingContext,
          audit.pricingContextName,
          audit.odooSaleOrderName,
          audit.odooPricelistId,
          audit.odooPricelistName,
          audit.odooPricelistItemId,
          audit.odooPricelistItemName,
          audit.lineFingerprint,
          audit.auditedAt,
        );
        const p = Array.from({ length: columns }, (_, column) => `$${offset + column + 1}`);
        return `(${p[0]},${p[1]},${p[2]}::uuid,${p[3]},${p[4]}::uuid,${p[5]},${p[6]},${p[7]},${p[8]},${p[9]},${p[10]},${p[11]},${p[12]},${p[13]},${p[14]},${p[15]},${p[16]},${p[17]},${p[18]},${p[19]}::date,${p[20]}::date,${p[21]}::date,${p[22]},${p[23]},${p[24]},${p[25]},${p[26]},${p[27]},${p[28]},${p[29]},${p[30]},${p[31]},${p[32]},${p[33]},${p[34]},${p[35]},${p[36]}::timestamptz)`;
      });
      await client.query(
        `INSERT INTO invoice_price_audits
          (invoice_line_id, invoice_number, price_book_id, price_book_version, price_item_id,
           payment_method, payment_method_raw, currency, quantity, actual_unit_price,
           allowed_minimum, allowed_maximum, compliance_status, severity, variance_amount,
           variance_percent, leakage_amount, match_type, reason, sale_date, invoice_date,
           payment_date, salesperson, sales_team, company, product_code, product_name,
           price_source, pricing_context, pricing_context_name, sale_order_name,
           odoo_pricelist_id, odoo_pricelist_name, odoo_pricelist_item_id,
           odoo_pricelist_item_name, line_fingerprint, audited_at)
         VALUES ${tuples.join(",")}
         ON CONFLICT (invoice_line_id) DO UPDATE SET
           invoice_number = EXCLUDED.invoice_number,
           price_book_id = EXCLUDED.price_book_id,
           price_book_version = EXCLUDED.price_book_version,
           price_item_id = EXCLUDED.price_item_id,
           payment_method = EXCLUDED.payment_method,
           payment_method_raw = EXCLUDED.payment_method_raw,
           currency = EXCLUDED.currency,
           quantity = EXCLUDED.quantity,
           actual_unit_price = EXCLUDED.actual_unit_price,
           allowed_minimum = EXCLUDED.allowed_minimum,
           allowed_maximum = EXCLUDED.allowed_maximum,
           compliance_status = EXCLUDED.compliance_status,
           severity = EXCLUDED.severity,
           variance_amount = EXCLUDED.variance_amount,
           variance_percent = EXCLUDED.variance_percent,
           leakage_amount = EXCLUDED.leakage_amount,
           match_type = EXCLUDED.match_type,
           reason = EXCLUDED.reason,
           sale_date = EXCLUDED.sale_date,
           invoice_date = EXCLUDED.invoice_date,
           payment_date = EXCLUDED.payment_date,
           salesperson = EXCLUDED.salesperson,
           sales_team = EXCLUDED.sales_team,
           company = EXCLUDED.company,
           product_code = EXCLUDED.product_code,
           product_name = EXCLUDED.product_name,
           price_source = EXCLUDED.price_source,
           pricing_context = EXCLUDED.pricing_context,
           pricing_context_name = EXCLUDED.pricing_context_name,
           sale_order_name = EXCLUDED.sale_order_name,
           odoo_pricelist_id = EXCLUDED.odoo_pricelist_id,
           odoo_pricelist_name = EXCLUDED.odoo_pricelist_name,
           odoo_pricelist_item_id = EXCLUDED.odoo_pricelist_item_id,
           odoo_pricelist_item_name = EXCLUDED.odoo_pricelist_item_name,
           line_fingerprint = EXCLUDED.line_fingerprint,
           audited_at = EXCLUDED.audited_at`,
        values,
      );
    }
    await client.query("COMMIT");
    return audits.length;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export interface AuditQuery {
  from?: string;
  to?: string;
  dateBasis?: "payment" | "sale" | "invoice";
  company?: string;
  currency?: string;
  paymentMethod?: string;
  specialization?: string;
  productCode?: string;
  salesperson?: string;
  salesTeam?: string;
  status?: string;
  severity?: string;
  search?: string;
  /** One of AUDIT_SORTS; anything else falls back to the severity order. */
  sort?: string;
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

/**
 * The orders a reader may ask for, as fixed SQL fragments.
 *
 * The key arrives from a query string, so it selects a fragment from this map
 * and is never interpolated: an unknown key falls back to the default order
 * rather than reaching the statement.
 */
const AUDIT_SORTS: Record<string, { asc: string; desc: string }> = {
  // Severity is stored as a word, so "worst first" is spelled out rather than
  // left to the alphabet: descending priority means critical before warning.
  priority: {
    asc: "severity DESC, leakage_amount ASC",
    desc: "severity ASC, leakage_amount DESC",
  },
  leakage: { asc: "leakage_amount ASC", desc: "leakage_amount DESC" },
  gap: { asc: "variance_amount ASC", desc: "variance_amount DESC" },
  price: { asc: "actual_unit_price ASC", desc: "actual_unit_price DESC" },
  date: {
    asc: "payment_date ASC NULLS LAST, invoice_date ASC NULLS LAST",
    desc: "payment_date DESC NULLS LAST, invoice_date DESC NULLS LAST",
  },
  salesperson: { asc: "salesperson ASC", desc: "salesperson DESC" },
  course: { asc: "product_name ASC", desc: "product_name DESC" },
  invoice: { asc: "invoice_number ASC", desc: "invoice_number DESC" },
};

export const auditSortKeys = Object.keys(AUDIT_SORTS);

const auditOrderBy = (query: AuditQuery): string => {
  const spec = AUDIT_SORTS[query.sort ?? ""];
  if (!spec) return "severity ASC, leakage_amount DESC, payment_date DESC NULLS LAST";
  // invoice_line_id breaks ties so paging can never repeat or skip a row.
  return `${query.sortDir === "asc" ? spec.asc : spec.desc}, invoice_line_id ASC`;
};

function auditWhere(query: AuditQuery): { clause: string; values: unknown[] } {
  const where: string[] = [];
  const values: unknown[] = [];
  const column =
    query.dateBasis === "sale"
      ? "sale_date"
      : query.dateBasis === "invoice"
        ? "invoice_date"
        : "payment_date";
  const add = (sql: string, value: unknown) => {
    values.push(value);
    where.push(sql.replace("$$", `$${values.length}`));
  };
  if (query.from) add(`${column} >= $$::date`, query.from);
  if (query.to) add(`${column} <= $$::date`, query.to);
  if (query.company) add("company = $$", query.company);
  if (query.currency) add("currency = $$", query.currency);
  if (query.paymentMethod) add("payment_method = $$", query.paymentMethod);
  if (query.productCode) add("product_code = $$", query.productCode);
  if (query.salesperson) add("salesperson = $$", query.salesperson);
  if (query.salesTeam) add("sales_team = $$", query.salesTeam);
  if (query.status) add("compliance_status = $$", query.status);
  if (query.severity) add("severity = $$", query.severity);
  if (query.search?.trim()) {
    values.push(`%${query.search.trim().toLowerCase()}%`);
    const placeholder = `$${values.length}`;
    where.push(
      `(lower(invoice_number) LIKE ${placeholder} OR lower(product_name) LIKE ${placeholder}
        OR lower(product_code) LIKE ${placeholder} OR lower(salesperson) LIKE ${placeholder})`,
    );
  }
  return { clause: where.length ? `WHERE ${where.join(" AND ")}` : "", values };
}

export async function queryAudits(
  query: AuditQuery,
): Promise<{ rows: InvoicePriceAudit[]; total: number }> {
  await ensurePricingSchema();
  const { clause, values } = auditWhere(query);
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 500);
  const offset = Math.max(query.offset ?? 0, 0);
  const [rows, total] = await Promise.all([
    getPool().query(
      `SELECT * FROM invoice_price_audits ${clause}
        ORDER BY ${auditOrderBy(query)}
        LIMIT ${limit} OFFSET ${offset}`,
      values,
    ),
    getPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM invoice_price_audits ${clause}`,
      values,
    ),
  ]);
  return {
    rows: rows.rows.map((row) => ({
      invoiceLineId: str(row.invoice_line_id),
      invoiceNumber: str(row.invoice_number),
      priceBookId: str(row.price_book_id),
      priceBookVersion: Number(row.price_book_version ?? 0),
      priceItemId: str(row.price_item_id),
      paymentMethod: str(row.payment_method) as PaymentMethod,
      paymentMethodRaw: str(row.payment_method_raw),
      currency: str(row.currency),
      quantity: Number(row.quantity ?? 0),
      actualUnitPrice: Number(row.actual_unit_price ?? 0),
      allowedMinimum: num(row.allowed_minimum),
      allowedMaximum: num(row.allowed_maximum),
      complianceStatus: str(row.compliance_status) as ComplianceStatus,
      severity: str(row.severity) as InvoicePriceAudit["severity"],
      varianceAmount: Number(row.variance_amount ?? 0),
      variancePercent: num(row.variance_percent),
      leakageAmount: Number(row.leakage_amount ?? 0),
      matchType: str(row.match_type) as MatchType,
      reason: str(row.reason),
      auditedAt: isoTime(row.audited_at),
      saleDate: isoDate(row.sale_date),
      invoiceDate: isoDate(row.invoice_date),
      paymentDate: isoDate(row.payment_date),
      salesperson: str(row.salesperson),
      salesTeam: str(row.sales_team),
      company: str(row.company),
      productCode: str(row.product_code),
      productName: str(row.product_name),
      priceSource: (str(row.price_source) || "price_book") as InvoicePriceAudit["priceSource"],
      pricingContext: (str(row.pricing_context) || "unknown") as PricingContext,
      pricingContextName: str(row.pricing_context_name),
      odooSaleOrderName: str(row.sale_order_name),
      odooPricelistId: num(row.odoo_pricelist_id),
      odooPricelistName: str(row.odoo_pricelist_name),
      odooPricelistItemId: num(row.odoo_pricelist_item_id),
      odooPricelistItemName: str(row.odoo_pricelist_item_name),
    })),
    total: Number(total.rows[0]?.count ?? 0),
  };
}

export interface CatalogDemandRow {
  key: string;
  orders: number;
  units: number;
}

export interface CatalogDemandResult {
  courses: CatalogDemandRow[];
  packages: CatalogDemandRow[];
}

/**
 * Demand for the price catalogue, measured from stored invoice audits.
 *
 * A package invoice produces one line per course component in Odoo. Counting
 * those rows would make a seven-course package look like seven package sales,
 * so package demand is distinct by sale order (invoice fallback). Package
 * components are excluded from course demand for the same reason.
 */
export async function catalogDemand(query: AuditQuery): Promise<CatalogDemandResult> {
  await ensurePricingSchema();
  const { clause, values } = auditWhere(query);
  const scoped = (condition: string) =>
    clause ? `${clause} AND ${condition}` : `WHERE ${condition}`;
  const orderIdentity =
    "COALESCE(NULLIF(sale_order_name, ''), NULLIF(invoice_number, ''), invoice_line_id)";

  const [courses, packages] = await Promise.all([
    getPool().query(
      `SELECT upper(trim(product_code)) AS key,
              count(DISTINCT ${orderIdentity})::int AS orders,
              COALESCE(sum(GREATEST(quantity, 0)), 0)::float AS units
         FROM invoice_price_audits
         ${scoped("pricing_context NOT IN ('package','offer_bundle') AND trim(product_code) <> ''")}
        GROUP BY upper(trim(product_code))`,
      values,
    ),
    getPool().query(
      `SELECT lower(regexp_replace(trim(pricing_context_name), '\\s+', ' ', 'g')) AS key,
              count(DISTINCT ${orderIdentity})::int AS orders,
              count(DISTINCT ${orderIdentity})::float AS units
         FROM invoice_price_audits
         ${scoped("pricing_context IN ('package','offer_bundle') AND trim(pricing_context_name) <> ''")}
        GROUP BY lower(regexp_replace(trim(pricing_context_name), '\\s+', ' ', 'g'))`,
      values,
    ),
  ]);

  const rows = (input: { rows: Record<string, unknown>[] }): CatalogDemandRow[] =>
    input.rows.map((row) => ({
      key: str(row.key),
      orders: Number(row.orders ?? 0),
      units: Number(row.units ?? 0),
    }));
  return { courses: rows(courses), packages: rows(packages) };
}

/**
 * Aggregate in PostgreSQL rather than shipping rows to the server to count.
 *
 * The detail table is paginated for the same reason: an all-time audit is tens
 * of thousands of lines, and a KPI row that has to download them is a Railway
 * bill and a phone that never finishes loading.
 */
export async function aggregateAudits(query: AuditQuery): Promise<{
  totals: Record<string, number>;
  byStatus: { status: string; lines: number; leakage: number }[];
  bySalesperson: { salesperson: string; lines: number; breaches: number; leakage: number }[];
  byCurrency: { currency: string; breaches: number; leakage: number }[];
}> {
  await ensurePricingSchema();
  const { clause, values } = auditWhere(query);
  const [totals, byStatus, bySalesperson, byCurrency] = await Promise.all([
    getPool().query(
      `SELECT
         count(*)::int AS audited,
         count(*) FILTER (WHERE compliance_status NOT IN ('excluded','package_price_unresolved'))::int AS eligible,
         count(*) FILTER (WHERE compliance_status NOT IN ('excluded','package_price_unresolved','unmatched_product'))::int AS matched,
         count(*) FILTER (WHERE compliance_status IN ('compliant','compliant_package','compliant_offer','above_list','below_minimum'))::int AS judged,
         count(*) FILTER (WHERE compliance_status IN ('compliant','compliant_package','compliant_offer','above_list'))::int AS compliant,
         count(*) FILTER (WHERE compliance_status = 'compliant_package')::int AS compliant_package,
         count(*) FILTER (WHERE pricing_context = 'package')::int AS package_lines,
         count(*) FILTER (WHERE compliance_status = 'package_price_unresolved')::int AS unresolved_package,
         count(*) FILTER (WHERE compliance_status = 'below_minimum')::int AS below_minimum,
         count(*) FILTER (WHERE compliance_status = 'unmatched_product')::int AS unmatched,
         count(*) FILTER (WHERE compliance_status = 'unknown_payment_method')::int AS unknown_payment,
         count(*) FILTER (WHERE compliance_status = 'mixed_payment_review')::int AS mixed_payment,
         count(*) FILTER (WHERE compliance_status = 'above_list')::int AS above_list,
         count(*) FILTER (WHERE compliance_status = 'excluded')::int AS excluded,
         count(*) FILTER (WHERE severity = 'needs_review')::int AS needs_review,
         count(*) FILTER (WHERE severity = 'critical')::int AS critical,
         COALESCE(sum(leakage_amount), 0)::float AS leakage
       FROM invoice_price_audits ${clause}`,
      values,
    ),
    getPool().query(
      `SELECT compliance_status AS status, count(*)::int AS lines,
              COALESCE(sum(leakage_amount),0)::float AS leakage
         FROM invoice_price_audits ${clause}
        GROUP BY compliance_status ORDER BY lines DESC`,
      values,
    ),
    getPool().query(
      `SELECT salesperson, count(*)::int AS lines,
              count(*) FILTER (WHERE compliance_status = 'below_minimum')::int AS breaches,
              COALESCE(sum(leakage_amount),0)::float AS leakage
         FROM invoice_price_audits ${clause}
        GROUP BY salesperson
        HAVING count(*) FILTER (WHERE compliance_status = 'below_minimum') > 0
        ORDER BY leakage DESC LIMIT 50`,
      values,
    ),
    getPool().query(
      `SELECT currency, count(*) FILTER (WHERE compliance_status = 'below_minimum')::int AS breaches,
              COALESCE(sum(leakage_amount),0)::float AS leakage
         FROM invoice_price_audits ${clause}
        GROUP BY currency ORDER BY leakage DESC`,
      values,
    ),
  ]);

  const row = totals.rows[0] ?? {};
  return {
    totals: Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, Number(value ?? 0)]),
    ),
    byStatus: byStatus.rows.map((entry) => ({
      status: str(entry.status),
      lines: Number(entry.lines ?? 0),
      leakage: Number(entry.leakage ?? 0),
    })),
    bySalesperson: bySalesperson.rows.map((entry) => ({
      salesperson: str(entry.salesperson) || "(unassigned)",
      lines: Number(entry.lines ?? 0),
      breaches: Number(entry.breaches ?? 0),
      leakage: Number(entry.leakage ?? 0),
    })),
    byCurrency: byCurrency.rows.map((entry) => ({
      currency: str(entry.currency),
      breaches: Number(entry.breaches ?? 0),
      leakage: Number(entry.leakage ?? 0),
    })),
  };
}

/* --- alert de-duplication -------------------------------------------------- */

/**
 * Remember which findings have already been announced.
 *
 * The key is the line, the book version and the verdict, exactly as specified.
 * Re-running the audit therefore re-announces nothing; a genuinely new verdict
 * on the same line — a new price book, or a corrected mapping — is a new key and
 * does get announced.
 */
export async function claimAlerts(
  keys: { alertKey: string; invoiceLineId: string; version: number; status: string }[],
  channel: string,
): Promise<Set<string>> {
  await ensurePricingSchema();
  if (!keys.length) return new Set();
  const claimed = new Set<string>();
  for (let start = 0; start < keys.length; start += 200) {
    const chunk = keys.slice(start, start + 200);
    const values: unknown[] = [];
    const tuples = chunk.map((entry, index) => {
      const offset = index * 5;
      values.push(entry.alertKey, entry.invoiceLineId, entry.version, entry.status, channel);
      return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5})`;
    });
    const result = await getPool().query<{ alert_key: string }>(
      `INSERT INTO price_alert_log (alert_key, invoice_line_id, price_book_version, compliance_status, channel)
       VALUES ${tuples.join(",")}
       ON CONFLICT (alert_key) DO NOTHING
       RETURNING alert_key`,
      values,
    );
    for (const row of result.rows) claimed.add(row.alert_key);
  }
  return claimed;
}

export async function readAuditState(): Promise<{
  lastRunAt: string;
  lastBookVersion: number;
  auditedLines: number;
  windowFrom: string;
  windowTo: string;
  lastError: string;
}> {
  await ensurePricingSchema();
  const result = await getPool().query(`SELECT * FROM price_audit_state WHERE id = 1`);
  const row = result.rows[0];
  return {
    lastRunAt: isoTime(row?.last_run_at),
    lastBookVersion: Number(row?.last_book_version ?? 0),
    auditedLines: Number(row?.audited_lines ?? 0),
    windowFrom: isoDate(row?.window_from),
    windowTo: isoDate(row?.window_to),
    lastError: str(row?.last_error),
  };
}

export async function writeAuditState(state: {
  bookId: string;
  bookVersion: number;
  auditedLines: number;
  windowFrom: string;
  windowTo: string;
  error?: string;
}): Promise<void> {
  await ensurePricingSchema();
  await getPool().query(
    `INSERT INTO price_audit_state
       (id, last_run_at, last_book_id, last_book_version, audited_lines, window_from, window_to, last_error)
     VALUES (1, now(), $1::uuid, $2, $3, $4::date, $5::date, $6)
     ON CONFLICT (id) DO UPDATE SET
       last_run_at = now(),
       last_book_id = EXCLUDED.last_book_id,
       last_book_version = EXCLUDED.last_book_version,
       audited_lines = EXCLUDED.audited_lines,
       window_from = EXCLUDED.window_from,
       window_to = EXCLUDED.window_to,
       last_error = EXCLUDED.last_error`,
    [
      state.bookId || null,
      state.bookVersion,
      state.auditedLines,
      state.windowFrom || null,
      state.windowTo || null,
      state.error ?? "",
    ],
  );
}

/* --- catalogue facets ------------------------------------------------------ */

export async function priceFacets(bookId: string): Promise<{
  specializations: string[];
  subcategories: { specialization: string; subcategory: string }[];
  deliveryTypes: string[];
  currencies: string[];
  countries: string[];
  paymentMethods: string[];
  levels: string[];
  scopes: string[];
}> {
  await ensurePricingSchema();
  const result = await getPool().query(
    `SELECT specialization, subcategory, delivery_type, currency, country, payment_method, level, pricing_scope
       FROM price_book_items WHERE price_book_id = $1`,
    [bookId],
  );
  const unique = (key: string): string[] =>
    [...new Set(result.rows.map((row) => str(row[key])).filter(Boolean))].sort();
  const pairs = new Map<string, { specialization: string; subcategory: string }>();
  for (const row of result.rows) {
    const specialization = str(row.specialization);
    const subcategory = str(row.subcategory);
    if (!specialization || !subcategory) continue;
    pairs.set(`${specialization} ${subcategory}`, { specialization, subcategory });
  }
  return {
    specializations: unique("specialization"),
    subcategories: [...pairs.values()].sort(
      (a, b) =>
        a.specialization.localeCompare(b.specialization) ||
        a.subcategory.localeCompare(b.subcategory),
    ),
    deliveryTypes: unique("delivery_type"),
    currencies: unique("currency"),
    countries: unique("country"),
    paymentMethods: unique("payment_method"),
    levels: unique("level"),
    scopes: unique("pricing_scope"),
  };
}
