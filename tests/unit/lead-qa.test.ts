import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { summarizeLeadQa, validateLeadQaInput } from "@/lib/lead-qa";

const queries: { sql: string; params?: unknown[] }[] = [];
const stored = new Map<string, Record<string, unknown>>();

vi.mock("@/lib/acquisition-attribution.server", () => {
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (/SELECT .* FROM lead_quality_verifications WHERE crm_lead_id = \$1 FOR UPDATE/s.test(sql)) {
        const row = stored.get(String(params?.[0]));
        return { rows: row ? [row] : [] };
      }
      if (/INSERT INTO lead_quality_verifications/.test(sql)) {
        const [crmLeadId, status, contact, quality, reason, notes, salesperson, by, via, snapshot, version] =
          params as string[];
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
        stored.set(crmLeadId, row);
        return { rows: [row] };
      }
      if (/FROM lead_quality_verifications WHERE crm_lead_id = ANY/.test(sql)) {
        const ids = (params?.[0] as string[]) ?? [];
        return { rows: ids.map((id) => stored.get(id)).filter(Boolean) };
      }
      return { rows: [] };
    },
    release: () => undefined,
  };
  return {
    acquisitionDatabaseConfigured: () => true,
    getPool: () => ({ query: client.query, connect: async () => client }),
  };
});

beforeEach(() => {
  queries.length = 0;
  stored.clear();
});

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
    expect(validateLeadQaInput({ crmLeadId: "1", verificationStatus: "verified_bad_lead" }).ok).toBe(false);
    expect(
      validateLeadQaInput({ crmLeadId: "1", verificationStatus: "verified_bad_lead", reason: "Wrong number" }).ok,
    ).toBe(true);
    expect(validateLeadQaInput({ crmLeadId: "1", verificationStatus: "disputed" }).ok).toBe(false);
  });

  it("rejects unknown statuses and non-Odoo ids", () => {
    expect(validateLeadQaInput({ crmLeadId: "abc", verificationStatus: "verified_contacted" }).ok).toBe(false);
    expect(validateLeadQaInput({ crmLeadId: "1", verificationStatus: "approved" }).ok).toBe(false);
  });

  it("summarises verdicts over assigned leads only, so the rate never exceeds 100%", () => {
    const summary = summarizeLeadQa(
      ["1", "2", "3", "4"],
      new Map([
        ["1", { verificationStatus: "verified_contacted" as const, leadQualityVerdict: "valid" as const }],
        ["2", { verificationStatus: "verified_bad_lead" as const, leadQualityVerdict: "invalid" as const }],
        ["3", { verificationStatus: "needs_review" as const, leadQualityVerdict: "" as const }],
        ["99", { verificationStatus: "verified_contacted" as const, leadQualityVerdict: "" as const }],
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

describe("manual QA persistence", () => {
  it("saves the verdict and an audit event in one transaction and reads it back", async () => {
    const { upsertLeadQaVerification, readLeadQaVerifications } = await import("@/lib/lead-qa.server");
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
    const saved = await upsertLeadQaVerification(parsed.value, { name: "Reviewer", via: "admin-code" });
    expect(saved.verificationStatus).toBe("verified_uncontacted");
    expect(saved.contactVerdict).toBe("not_contacted");
    expect(saved.evidenceSnapshot).toEqual({ contactStatus: "not_contacted", totalCalls: 0 });

    const statements = queries.map((query) => query.sql.trim().split(/\s+/).slice(0, 3).join(" "));
    expect(statements[0]).toMatch(/^CREATE TABLE IF/);
    expect(queries.some((query) => query.sql === "BEGIN")).toBe(true);
    expect(queries.some((query) => /INSERT INTO lead_quality_verification_events/.test(query.sql))).toBe(true);
    expect(queries.some((query) => query.sql === "COMMIT")).toBe(true);
    expect(queries.some((query) => /crm\.lead|odoo/i.test(query.sql))).toBe(false);

    const read = await readLeadQaVerifications(["4501"]);
    expect(read.get("4501")?.verifiedBy).toBe("Reviewer");
  });

  it("creates additive tables with status checks", async () => {
    const { ensureLeadQaSchema } = await import("@/lib/lead-qa.server");
    await ensureLeadQaSchema();
    const schema = queries.map((query) => query.sql).join("\n");
    if (schema) {
      expect(schema).toContain("CREATE TABLE IF NOT EXISTS lead_quality_verifications");
      expect(schema).toContain("CHECK (verification_status IN");
      expect(schema).not.toMatch(/DROP|TRUNCATE/i);
    }
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
    walk(join(import.meta.dirname, "..", "..", "src"));
    walk(join(import.meta.dirname, "..", "..", "scripts"));
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const statement of source.match(/(TRUNCATE|DROP TABLE|DELETE FROM)[^;`]*/gi) ?? []) {
        expect(statement, file).not.toMatch(/lead_quality_verification/);
      }
    }
  });
});
