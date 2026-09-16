import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ raw: vi.fn(), dimensions: vi.fn() }));
vi.mock("@/lib/crm-odoo.server", () => ({ loadCrmRawByDomain: mocks.raw }));
vi.mock("@/lib/crm-lost-movement.server", () => ({
  matchesLostMovementDimensions: mocks.dimensions,
}));
vi.mock("@/lib/odoo.server", () => ({
  odooConfig: () => ({
    url: "https://example.invalid",
    db: "test",
    login: "sales-manager",
    companyIds: [2, 3, 4],
  }),
}));
import {
  archivedLostLeadsDomain,
  freshLostPipelineDomain,
  olderLostPipelineDomain,
  loadArchivedLostLeads,
  loadFreshLostPipeline,
  loadOlderLostPipeline,
} from "@/lib/crm-fresh-lost.server";
import type { Snapshot } from "@/lib/sheet-cache.server";
const filters = { from: "2026-09-01", to: "2026-09-16" };
const snapshot = () => ({ ads: [], campaigns: new Map() }) as unknown as Snapshot;
const raw = (id: number, extra: Record<string, string> = {}) => ({
  __odoo_id: String(id),
  __odoo_create_date_utc: "2026-09-02 10:00:00",
  "Record Type": "opportunity",
  "Record Active": "true",
  "Stage Key": "lost",
  __odoo_lost_verification_date_utc: "2026-09-03 10:00:00",
  "Inventory Bucket": "",
  "سبب الضياع": "Duplicate",
  Source: "Facebook",
  Company: "Egypt",
  ...extra,
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.dimensions.mockReturnValue(true);
});
describe("current Lost creation cohorts, independent of tracking access", () => {
  it("matches Pipeline Creation Date + Stage Is Lost with Cairo half-open bounds", () => {
    expect(freshLostPipelineDomain(filters)).toEqual([
      ["type", "=", "opportunity"],
      ["active", "=", true],
      ["stage_is_lost", "=", true],
      ["create_date", ">=", "2026-08-31 21:00:00"],
      ["create_date", "<", "2026-09-16 21:00:00"],
    ]);
    expect(archivedLostLeadsDomain(filters)).toEqual([
      ["type", "=", "lead"],
      ["active", "=", false],
      ["lost_reason_id", "!=", false],
      ["create_date", ">=", "2026-08-31 21:00:00"],
      ["create_date", "<", "2026-09-16 21:00:00"],
    ]);
    expect(olderLostPipelineDomain(filters)).toEqual([
      ["type", "=", "opportunity"],
      ["active", "=", true],
      ["stage_is_lost", "=", true],
      ["create_date", "<", "2026-08-31 21:00:00"],
      ["lost_verification_date", ">=", "2026-08-31 21:00:00"],
      ["lost_verification_date", "<", "2026-09-16 21:00:00"],
    ]);
  });
  it("never mixes archived Leads/Opportunities or Inventory with Pipeline; deduplicates IDs", async () => {
    mocks.raw.mockResolvedValue([
      raw(1),
      raw(1),
      raw(2, { "Record Type": "lead", "Record Active": "false" }),
      raw(3, { "Record Active": "false" }),
      raw(4, { "Stage Key": "preparation" }),
      ...[1, 2, 3, 4].map((i) => raw(10 + i, { "Inventory Bucket": `inventory_${i}` })),
    ]);
    const result = await loadFreshLostPipeline(filters, snapshot());
    expect(result.availability).toBe("available");
    expect(result.total).toBe(1);
    expect(result.domain[0]).toEqual(["inventory_bucket", "=", false]);
    expect(result.records.map((r) => r.id)).toEqual(["1"]);
    expect(mocks.raw.mock.calls[0][0]).toEqual(freshLostPipelineDomain(filters));
    expect(JSON.stringify(mocks.raw.mock.calls)).not.toMatch(
      /tracking|write_date|lost_verification_date/,
    );
  });
  it("keeps archived reasoned Leads in their own original stage and preserves actual reasons", async () => {
    mocks.raw.mockResolvedValue([
      raw(1, { "Record Type": "lead", "Record Active": "false", "Stage Key": "new" }),
      raw(2, {
        "Record Type": "lead",
        "Record Active": "false",
        "Stage Key": "new",
        "سبب الضياع": "Wrong Number",
      }),
      raw(3),
      raw(4, { "Record Type": "lead", "Record Active": "false", "سبب الضياع": "" }),
    ]);
    const result = await loadArchivedLostLeads(filters, snapshot());
    expect(result.total).toBe(2);
    expect(result.records.map((r) => r.lossReason)).toEqual(["Duplicate", "Wrong Number"]);
    expect(result.domain).not.toContainEqual(["stage_is_lost", "=", true]);
    expect(mocks.raw.mock.calls[0][0]).toEqual(archivedLostLeadsDomain(filters));
  });
  it("retains only creation dates inside the selected window and forwards global dimensions", async () => {
    mocks.raw.mockResolvedValue([
      raw(1, { __odoo_create_date_utc: "2026-08-31 21:00:00" }),
      raw(2, { __odoo_create_date_utc: "2026-08-31 20:59:59" }),
      raw(3, { __odoo_create_date_utc: "2026-09-16 21:00:00" }),
      raw(4, { Company: "KSA" }),
    ]);
    mocks.dimensions.mockImplementation((r) => r.Company === "Egypt");
    const selected = { ...filters, company: "Egypt" };
    const snap = snapshot();
    const result = await loadFreshLostPipeline(selected, snap);
    expect(result.total).toBe(1);
    expect(result.records[0].createdAt).toBe("2026-09-01");
    expect(mocks.dimensions).toHaveBeenCalledWith(expect.any(Object), selected, snap);
  });
  it("loads the older Lost cohort with normal Odoo fields, without tracking", async () => {
    mocks.raw.mockResolvedValue([
      raw(1, {
        __odoo_create_date_utc: "2026-08-30 10:00:00",
        __odoo_lost_verification_date_utc: "2026-09-05 10:00:00",
      }),
      raw(2, {
        __odoo_create_date_utc: "2026-08-30 10:00:00",
        __odoo_lost_verification_date_utc: "2026-08-31 20:59:59",
      }),
      raw(3, {
        __odoo_create_date_utc: "2026-09-01 10:00:00",
        __odoo_lost_verification_date_utc: "2026-09-05 10:00:00",
      }),
      raw(4, {
        __odoo_create_date_utc: "2026-08-30 10:00:00",
        __odoo_lost_verification_date_utc: "",
      }),
    ]);
    const result = await loadOlderLostPipeline(filters, snapshot());
    expect(result.availability).toBe("available");
    expect(result.total).toBe(1);
    expect(result.records.map((r) => r.id)).toEqual(["1"]);
    expect(mocks.raw.mock.calls[0][0]).toEqual(olderLostPipelineDomain(filters));
    expect(JSON.stringify(mocks.raw.mock.calls)).not.toMatch(/tracking|mail\.message/);
  });
  it("failed CRM read is unavailable, not zero or a last-good/event-date fallback", async () => {
    mocks.raw.mockRejectedValue(new Error("CRM unavailable"));
    const result = await loadFreshLostPipeline(filters, snapshot());
    expect(result.availability).toBe("unavailable");
    expect(result.total).toBeNull();
    expect(result.records).toEqual([]);
    expect(mocks.raw).toHaveBeenCalledTimes(1);
  });
});
