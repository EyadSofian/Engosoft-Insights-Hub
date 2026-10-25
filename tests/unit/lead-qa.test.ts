import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { summarizeLeadQa, validateLeadQaInput } from "@/lib/lead-qa";

const db = vi.hoisted(() => ({
  queries: [] as { sql: string; params?: unknown[] }[],
  stored: new Map<string, Record<string, unknown>>(),
  migrations: new Set<string>(),
  tables: false,
}));

vi.mock("@/lib/acquisition-attribution.server", () => {
  const query = async (sql: string, params?: unknown[]) => {
    db.queries.push({ sql, params });
    if (/to_regclass\('public\.lead_quality_verifications'\)/.test(sql)) {
      return { rows: [{ verifications: db.tables, events: db.tables }] };
    }
    if (/CREATE TABLE IF NOT EXISTS lead_quality_verifications/.test(sql)) {
      db.tables = true;
      return { rows: [] };
    }
    if (/INSERT INTO dashboard_schema_migrations/.test(sql)) {
      const id = String(params?.[0]);
      if (db.migrations.has(id)) return { rows: [], rowCount: 0 };
      db.migrations.add(id);
      return { rows: [{ id }], rowCount: 1 };
    }
    if (/SELECT .* FROM lead_quality_verifications WHERE crm_lead_id = \$1 FOR UPDATE/s.test(sql)) {
      const row = db.stored.get(String(params?.[0]));
      return { rows: row ? [row] : [] };
    }
    if (/INSERT INTO lead_quality_verifications/.test(sql)) {
      const [
        crmLeadId,
        status,
        contact,
        quality,
        reason,
        notes,
        salesperson,
        by,
        via,
        snapshot,
        version,
      ] = params as string[];
      const row = {
        crm_lead_id: crmLeadId,
        verification_status: status,
        contact_verdict: contact,
        lead_quality_verdict: quality,
        reason,
        notes,
        salesperson,
        verified_by: by,
        verified_via: via,
        verified_at: new Date("2026-09-15T10:00:00Z"),
        updated_at: new Date("2026-09-15T10:00:00Z"),
        evidence_snapshot: JSON.parse(snapshot),
        evidence_version: version,
      };
      db.stored.set(crmLeadId, row);
      return { rows: [row] };
    }
    if (/FROM lead_quality_verifications WHERE crm_lead_id = ANY/.test(sql)) {
      const ids = (params?.[0] as string[]) ?? [];
      return { rows: ids.map((id) => db.stored.get(id)).filter(Boolean) };
    }
    return { rows: [] };
  };
  const client = { query, release: () => undefined };
  return {
    acquisitionDatabaseConfigured: () => true,
    getPool: () => ({ query, connect: async () => client }),
  };
});

beforeEach(() => {
  db.queries.length = 0;
  db.stored.clear();
  db.migrations.clear();
  db.tables = false;
  vi.resetModules();
});

const repo = join(import.meta.dirname, "..", "..");

describe("lead QA validation", () => {
  it("fills the verdict a status implies and rejects a contradictory one", () => {
    const ok = validateLeadQaInput({ crmLeadId: "123", verificationStatus: "verified_contacted" });
    expect(ok.ok && ok.value.contactVerdict).toBe("contacted");
    const conflict = validateLeadQaInput({
      crmLeadId: "123",
      verificationStatus: "verified_contacted",
      contactVerdict: "not_contacted",
    });
    expect(conflict.ok).toBe(false);
  });

  it("requires a reason for a bad lead or a dispute", () => {
    expect(
      validateLeadQaInput({ crmLeadId: "1", verificationStatus: "verified_bad_lead" }).ok,
    ).toBe(false);
    expect(
      validateLeadQaInput({
        crmLeadId: "1",
        verificationStatus: "verified_bad_lead",
        reason: "Wrong number",
      }).ok,
    ).toBe(true);
    expect(validateLeadQaInput({ crmLeadId: "1", verificationStatus: "disputed" }).ok).toBe(false);
  });

  it("rejects unknown statuses and non-Odoo ids", () => {
    expect(
      validateLeadQaInput({ crmLeadId: "abc", verificationStatus: "verified_contacted" }).ok,
    ).toBe(false);
    expect(validateLeadQaInput({ crmLeadId: "1", verificationStatus: "approved" }).ok).toBe(false);
  });

  it("summarises verdicts over assigned leads only, so the rate never exceeds 100%", () => {
    const summary = summarizeLeadQa(
      ["1", "2", "3", "4"],
      new Map([
        [
          "1",
          {
            verificationStatus: "verified_contacted" as const,
            leadQualityVerdict: "valid" as const,
          },
        ],
        [
          "2",
          {
            verificationStatus: "verified_bad_lead" as const,
            leadQualityVerdict: "invalid" as const,
          },
        ],
        ["3", { verificationStatus: "needs_review" as const, leadQualityVerdict: "" as const }],
        [
          "99",
          { verificationStatus: "verified_contacted" as const, leadQualityVerdict: "" as const },
        ],
      ]),
    );
    expect(summary).toMatchObject({
      assignedLeads: 4,
      verified: 2,
      needsReview: 1,
      unverified: 1,
      verifiedValid: 1,
      verifiedInvalid: 1,
      verifiedContacted: 1,
    });
    expect(summary.verificationRate).toBe(50);
  });
});

describe("explicit, idempotent lead QA migration", () => {
  it("refuses on the request path before the migration and never creates tables there", async () => {
    const { readLeadQaVerifications, upsertLeadQaVerification, LeadQaSchemaMissingError } =
      await import("@/lib/lead-qa.server");
    await expect(readLeadQaVerifications(["1"])).rejects.toBeInstanceOf(LeadQaSchemaMissingError);
    const parsed = validateLeadQaInput({ crmLeadId: "1", verificationStatus: "needs_review" });
    if (!parsed.ok) throw new Error("fixture invalid");
    await expect(
      upsertLeadQaVerification(parsed.value, { name: "x", via: "admin-code" }),
    ).rejects.toBeInstanceOf(LeadQaSchemaMissingError);
    expect(db.queries.some((query) => /CREATE TABLE/i.test(query.sql))).toBe(false);
  });

  it("creates the tables under an advisory lock, records itself, and is a no-op the second time", async () => {
    const { runLeadQaMigration, LEAD_QA_MIGRATION_ID } = await import("@/lib/lead-qa.server");
    const first = await runLeadQaMigration();
    expect(first).toEqual({ id: LEAD_QA_MIGRATION_ID, applied: true });
    const second = await runLeadQaMigration();
    expect(second).toEqual({ id: LEAD_QA_MIGRATION_ID, applied: false });

    const sql = db.queries.map((query) => query.sql).join("\n");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS dashboard_schema_migrations");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS lead_quality_verifications");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS lead_quality_verification_events");
    expect(sql).toContain("CHECK (verification_status IN");
    expect(sql).not.toMatch(/DROP|TRUNCATE|ALTER TABLE (?!.*ADD)/i);
    expect(db.queries.filter((query) => query.sql === "COMMIT")).toHaveLength(2);
  });

  it("runs at server start and from an npm script, not from the API route", () => {
    const server = readFileSync(join(repo, "src", "server.ts"), "utf8");
    expect(server).toContain("startLeadQaMigration");
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["migrate:lead-qa"]).toContain("scripts/migrate-lead-qa.mjs");
    const route = readFileSync(join(repo, "src", "routes", "api", "lead-qa.ts"), "utf8");
    expect(route).not.toMatch(/runLeadQaMigration|ensureLeadQaSchema|CREATE TABLE/);
  });
});

describe("manual QA persistence", () => {
  it("saves the verdict and an audit event in one transaction and reads it back", async () => {
    const { runLeadQaMigration, upsertLeadQaVerification, readLeadQaVerifications } =
      await import("@/lib/lead-qa.server");
    await runLeadQaMigration();
    db.queries.length = 0;
    const parsed = validateLeadQaInput({
      crmLeadId: "4501",
      verificationStatus: "verified_uncontacted",
      notes: "No call or chat after creation",
      salesperson: "Owner Person",
      evidenceSnapshot: { contactStatus: "not_contacted", totalCalls: 0 },
      evidenceVersion: "lead-contact-evidence/1",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const saved = await upsertLeadQaVerification(parsed.value, {
      name: "Reviewer",
      via: "admin-code",
    });
    expect(saved.verificationStatus).toBe("verified_uncontacted");
    expect(saved.contactVerdict).toBe("not_contacted");
    expect(saved.evidenceSnapshot).toEqual({ contactStatus: "not_contacted", totalCalls: 0 });
    expect(db.queries.some((query) => query.sql === "BEGIN")).toBe(true);
    expect(
      db.queries.some((query) => /INSERT INTO lead_quality_verification_events/.test(query.sql)),
    ).toBe(true);
    expect(db.queries.some((query) => query.sql === "COMMIT")).toBe(true);
    expect(db.queries.some((query) => /crm\.lead|odoo|CREATE TABLE/i.test(query.sql))).toBe(false);

    const read = await readLeadQaVerifications(["4501"]);
    expect(read.get("4501")?.verifiedBy).toBe("Reviewer");
  });

  it("is never truncated or rebuilt by a sync job", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx|mjs)$/.test(name)) files.push(path);
      }
    };
    walk(join(repo, "src"));
    walk(join(repo, "scripts"));
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const statement of source.match(/(TRUNCATE|DROP TABLE|DELETE FROM)[^;`]*/gi) ?? []) {
        expect(statement, file).not.toMatch(/lead_quality_verification/);
      }
    }
  });
});
