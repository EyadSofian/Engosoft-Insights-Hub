import { acquisitionDatabaseConfigured, getPool } from "./acquisition-attribution.server";
import {
  LEAD_QA_STATUSES,
  LEAD_QA_CONTACT_VERDICTS,
  LEAD_QA_QUALITY_VERDICTS,
  type LeadQaInput,
  type LeadQaVerification,
  type LeadQaStatus,
  type LeadQaContactVerdict,
  type LeadQaQualityVerdict,
} from "./lead-qa";

/**
 * Persistence for manual lead QA.
 *
 * Two tables, both additive and owned by this module alone:
 *   lead_quality_verifications         the current verdict per CRM lead
 *   lead_quality_verification_events   every change, append-only, for audit
 *
 * They are created by an explicit, idempotent migration (`runLeadQaMigration`)
 * that runs at server start and from `npm run migrate:lead-qa`, and is recorded
 * in `dashboard_schema_migrations`. Request handlers never create tables: they
 * verify the schema and refuse with a clear error when the migration has not
 * run. No sync job, closed-loop refresh or dataset writer touches these tables,
 * and nothing here writes to Odoo.
 */

type Row = Record<string, unknown>;
type Queryable = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Row[]; rowCount?: number | null }>;
};
type PoolLike = { connect: () => Promise<Queryable & { release: () => void }> };

const list = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

export const LEAD_QA_MIGRATION_ID = "2026-09-16_lead_quality_verifications_v1";
const LEAD_QA_MIGRATION_DESCRIPTION =
  "Manual lead QA: lead_quality_verifications + lead_quality_verification_events";

export const LEAD_QA_DDL = `CREATE TABLE IF NOT EXISTS lead_quality_verifications (
     crm_lead_id text PRIMARY KEY,
     verification_status text NOT NULL DEFAULT 'unverified'
       CHECK (verification_status IN (${list(LEAD_QA_STATUSES)})),
     contact_verdict text NOT NULL DEFAULT ''
       CHECK (contact_verdict IN (${list(LEAD_QA_CONTACT_VERDICTS)})),
     lead_quality_verdict text NOT NULL DEFAULT ''
       CHECK (lead_quality_verdict IN (${list(LEAD_QA_QUALITY_VERDICTS)})),
     reason text NOT NULL DEFAULT '',
     notes text NOT NULL DEFAULT '',
     salesperson text NOT NULL DEFAULT '',
     verified_by text NOT NULL DEFAULT '',
     verified_via text NOT NULL DEFAULT '',
     verified_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     evidence_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
     evidence_version text NOT NULL DEFAULT ''
   );
   CREATE INDEX IF NOT EXISTS lead_quality_verifications_status_idx
     ON lead_quality_verifications (verification_status);
   CREATE INDEX IF NOT EXISTS lead_quality_verifications_salesperson_idx
     ON lead_quality_verifications (salesperson);

   CREATE TABLE IF NOT EXISTS lead_quality_verification_events (
     id bigserial PRIMARY KEY,
     crm_lead_id text NOT NULL,
     previous jsonb,
     next jsonb NOT NULL,
     actor text NOT NULL DEFAULT '',
     actor_via text NOT NULL DEFAULT '',
     created_at timestamptz NOT NULL DEFAULT now()
   );
   CREATE INDEX IF NOT EXISTS lead_quality_verification_events_lead_idx
     ON lead_quality_verification_events (crm_lead_id, created_at DESC);`;

export function leadQaConfigured(): boolean {
  return acquisitionDatabaseConfigured();
}

let schemaVerified = false;

export class LeadQaSchemaMissingError extends Error {
  constructor() {
    super(
      "Lead QA tables are missing: the lead QA migration has not been applied. It runs at server start; run `npm run migrate:lead-qa` to apply it explicitly.",
    );
    this.name = "LeadQaSchemaMissingError";
  }
}

/**
 * Creates the QA tables and records the migration. Idempotent and safe to run
 * concurrently: a transaction-scoped advisory lock serialises runs, every
 * statement is `IF NOT EXISTS`, and the migration row is inserted once.
 */
export async function runLeadQaMigration(
  pool: PoolLike = getPool() as unknown as PoolLike,
): Promise<{ id: string; applied: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [LEAD_QA_MIGRATION_ID]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS dashboard_schema_migrations (
         id text PRIMARY KEY,
         description text NOT NULL DEFAULT '',
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    await client.query(LEAD_QA_DDL);
    const inserted = await client.query(
      `INSERT INTO dashboard_schema_migrations (id, description) VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [LEAD_QA_MIGRATION_ID, LEAD_QA_MIGRATION_DESCRIPTION],
    );
    await client.query("COMMIT");
    schemaVerified = true;
    return { id: LEAD_QA_MIGRATION_ID, applied: (inserted.rowCount ?? inserted.rows.length) > 0 };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Boot hook: applies the migration once per process and logs the outcome. */
export function startLeadQaMigration(): void {
  if (!acquisitionDatabaseConfigured()) return;
  runLeadQaMigration()
    .then(({ id, applied }) =>
      console.log(`[lead-qa] migration ${id} ${applied ? "applied" : "already applied"}`),
    )
    .catch((error) =>
      console.error("[lead-qa] migration failed:", error instanceof Error ? error.message : error),
    );
}

/** Request-path check. Never creates anything; refuses when the migration is missing. */
export async function assertLeadQaSchema(): Promise<void> {
  if (schemaVerified) return;
  const result = await getPool().query<Row>(
    `SELECT to_regclass('public.lead_quality_verifications') IS NOT NULL AS verifications,
            to_regclass('public.lead_quality_verification_events') IS NOT NULL AS events`,
  );
  if (result.rows[0]?.verifications === true && result.rows[0]?.events === true) {
    schemaVerified = true;
    return;
  }
  throw new LeadQaSchemaMissingError();
}

const iso = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString() : value ? String(value) : null;

export function rowToVerification(row: Row): LeadQaVerification {
  const snapshot = row.evidence_snapshot;
  return {
    crmLeadId: String(row.crm_lead_id ?? ""),
    verificationStatus: String(row.verification_status ?? "unverified") as LeadQaStatus,
    contactVerdict: String(row.contact_verdict ?? "") as LeadQaContactVerdict,
    leadQualityVerdict: String(row.lead_quality_verdict ?? "") as LeadQaQualityVerdict,
    reason: String(row.reason ?? ""),
    notes: String(row.notes ?? ""),
    salesperson: String(row.salesperson ?? ""),
    verifiedBy: String(row.verified_by ?? ""),
    verifiedAt: iso(row.verified_at),
    updatedAt: iso(row.updated_at),
    evidenceSnapshot:
      snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
        ? (snapshot as Record<string, unknown>)
        : {},
    evidenceVersion: String(row.evidence_version ?? ""),
  };
}

const COLUMNS = `crm_lead_id, verification_status, contact_verdict, lead_quality_verdict, reason, notes,
  salesperson, verified_by, verified_at, updated_at, evidence_snapshot, evidence_version`;

export async function readLeadQaVerifications(
  crmLeadIds: readonly string[],
): Promise<Map<string, LeadQaVerification>> {
  const ids = [...new Set(crmLeadIds.filter((id) => /^\d{1,12}$/.test(id)))];
  if (!ids.length) return new Map();
  await assertLeadQaSchema();
  const result = await getPool().query<Row>(
    `SELECT ${COLUMNS} FROM lead_quality_verifications WHERE crm_lead_id = ANY($1::text[])`,
    [ids],
  );
  return new Map(result.rows.map((row) => [String(row.crm_lead_id), rowToVerification(row)]));
}

export async function readLeadQaHistory(crmLeadId: string, limit = 50) {
  if (!/^\d{1,12}$/.test(crmLeadId)) return [];
  await assertLeadQaSchema();
  const result = await getPool().query<Row>(
    `SELECT previous, next, actor, actor_via, created_at FROM lead_quality_verification_events
      WHERE crm_lead_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
    [crmLeadId, Math.max(1, Math.min(200, limit))],
  );
  return result.rows.map((row) => ({
    previous: row.previous ?? null,
    next: row.next,
    actor: String(row.actor ?? ""),
    actorVia: String(row.actor_via ?? ""),
    createdAt: iso(row.created_at),
  }));
}

/**
 * Saves one verdict and its audit event in a single transaction. The current
 * row is locked first, so two reviewers saving at once produce two ordered
 * events rather than a lost update.
 */
export async function upsertLeadQaVerification(
  input: LeadQaInput,
  actor: { name: string; via: string },
): Promise<LeadQaVerification> {
  await assertLeadQaSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const previous = await client.query<Row>(
      `SELECT ${COLUMNS} FROM lead_quality_verifications WHERE crm_lead_id = $1 FOR UPDATE`,
      [input.crmLeadId],
    );
    const saved = await client.query<Row>(
      `INSERT INTO lead_quality_verifications
         (crm_lead_id, verification_status, contact_verdict, lead_quality_verdict, reason, notes,
          salesperson, verified_by, verified_via, verified_at, updated_at, evidence_snapshot, evidence_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now(), $10::jsonb, $11)
       ON CONFLICT (crm_lead_id) DO UPDATE SET
         verification_status = EXCLUDED.verification_status,
         contact_verdict = EXCLUDED.contact_verdict,
         lead_quality_verdict = EXCLUDED.lead_quality_verdict,
         reason = EXCLUDED.reason,
         notes = EXCLUDED.notes,
         salesperson = CASE WHEN EXCLUDED.salesperson <> '' THEN EXCLUDED.salesperson
                            ELSE lead_quality_verifications.salesperson END,
         verified_by = EXCLUDED.verified_by,
         verified_via = EXCLUDED.verified_via,
         verified_at = now(),
         updated_at = now(),
         evidence_snapshot = EXCLUDED.evidence_snapshot,
         evidence_version = EXCLUDED.evidence_version
       RETURNING ${COLUMNS}`,
      [
        input.crmLeadId,
        input.verificationStatus,
        input.contactVerdict,
        input.leadQualityVerdict,
        input.reason,
        input.notes,
        input.salesperson,
        actor.name,
        actor.via,
        JSON.stringify(input.evidenceSnapshot ?? {}),
        input.evidenceVersion,
      ],
    );
    const next = rowToVerification(saved.rows[0]!);
    await client.query(
      `INSERT INTO lead_quality_verification_events (crm_lead_id, previous, next, actor, actor_via)
       VALUES ($1, $2::jsonb, $3::jsonb, $4, $5)`,
      [
        input.crmLeadId,
        previous.rows[0] ? JSON.stringify(rowToVerification(previous.rows[0])) : null,
        JSON.stringify(next),
        actor.name,
        actor.via,
      ],
    );
    await client.query("COMMIT");
    return next;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
