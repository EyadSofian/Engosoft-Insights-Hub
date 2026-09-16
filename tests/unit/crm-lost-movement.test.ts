import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ call: vi.fn(), read: vi.fn(), raw: vi.fn() }));
vi.mock("@/lib/odoo.server", () => ({
  odooCallWithPolicy: mocks.call,
  searchRead: mocks.read,
  companyContext: (extra: object) => ({ allowed_company_ids: [2, 3, 4], ...extra }),
  odooConfig: () => ({
    url: "https://example.invalid",
    db: "test",
    login: "integration-test",
    companyIds: [2, 3, 4],
  }),
  m2oId: (v: [number, string] | false) => (v ? v[0] : 0),
  m2oName: (v?: [number, string] | false) => (v ? v[1] : ""),
  OdooError: class extends Error {
    constructor(
      message: string,
      public kind: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/lib/crm-odoo.server", () => ({ loadCrmRawByIds: mocks.raw }));
vi.mock("@/lib/sheet-cache.server", () => ({
  normalizeName: (s: string) => s.trim().toLowerCase(),
  normalizeSource: (s: string) => s.trim().toLowerCase(),
  canonicalMainCategory: () => "",
}));
vi.mock("@/lib/metrics.server", () => ({ matchesPerformanceDimensionFilters: () => true }));
import { loadLostMovement, matchesLostMovementDimensions } from "@/lib/crm-lost-movement.server";
import type { Snapshot } from "@/lib/sheet-cache.server";
const snapshot = (): Snapshot => ({ campaigns: new Map(), ads: [] }) as unknown as Snapshot;
const tracking = (id: number, message: number, field: number, old = 0, value = 0) => ({
  id,
  mail_message_id: [message, "message"],
  field_id: [field, "field"],
  old_value_integer: old,
  new_value_integer: value,
});
beforeEach(() => {
  vi.clearAllMocks();
});
describe("read-only event service", () => {
  it("denied tracking access returns unavailable/null, never zero and never a CRM read/write fallback", async () => {
    mocks.call.mockResolvedValue(false);
    const result = await loadLostMovement({ from: "2026-09-01", to: "2026-09-16" }, snapshot());
    expect(result.availability).toBe("unavailable");
    expect(result.total).toBeNull();
    expect(result.fresh).toBeNull();
    expect(result.older).toBeNull();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.raw).not.toHaveBeenCalled();
    expect(mocks.call.mock.calls.map((c) => c[1])).toEqual(["check_access_rights"]);
  });
  it("counts confirmed fresh/older records even when reopened, drops Inventory, and isolates unproven archives/stage events", async () => {
    mocks.call.mockImplementation(async (model, method) =>
      method === "check_access_rights" ? true : { "99": "crm_pipeline_redesign.stage_lost" },
    );
    const messages = [
      { id: 11, res_id: 1, date: "2026-09-10 10:00:00", body: "" },
      { id: 12, res_id: 2, date: "2026-09-11 10:00:00", body: "Lost Comment: legacy" },
      { id: 13, res_id: 3, date: "2026-09-11 11:00:00", body: "" },
      { id: 14, res_id: 4, date: "2026-09-12 10:00:00", body: "" },
      { id: 15, res_id: 5, date: "2026-09-12 10:00:00", body: "" },
    ];
    const tracks = [
      tracking(1, 11, 3, 10, 99),
      tracking(2, 11, 4, 0, 7),
      tracking(3, 12, 2, 1, 0),
      tracking(4, 13, 2, 1, 0),
      tracking(5, 14, 3, 10, 99),
      tracking(6, 15, 3, 10, 99),
      tracking(7, 15, 4, 0, 7),
    ];
    mocks.read.mockImplementation(async (model: string, domain: unknown[]) => {
      if (model === "ir.model.fields")
        return [
          { id: 1, name: "type" },
          { id: 2, name: "active" },
          { id: 3, name: "stage_id" },
          { id: 4, name: "lost_reason_id" },
        ];
      if (model === "crm.stage") return [{ id: 99 }];
      if (model === "mail.tracking.value")
        return domain.some(
          (d: unknown) => Array.isArray(d) && d[0] === "field_id" && d[1] === "=" && d[2] === 1,
        )
          ? []
          : tracks;
      if (model === "mail.message") return messages;
      if (model === "crm.lost.reason")
        return [{ id: 7, name: "Commercial", category_id: [8, "Commercial Lost"] }];
      throw new Error("Unexpected model");
    });
    mocks.raw.mockResolvedValue(
      [1, 2, 3, 4, 5].map((id) => ({
        __odoo_id: String(id),
        __odoo_create_date_utc: id === 2 ? "2026-07-01 10:00:00" : "2026-09-02 10:00:00",
        "Record Type": id === 3 ? "lead" : "opportunity",
        "Record Active": "true",
        "Stage Key": "open",
        "Inventory Bucket": id === 5 ? "inventory_1" : "",
        "اسم جهة الاتصال": `Record ${id}`,
        Source: "Facebook",
        Salesperson: "Current owner",
        "Sales Team": "Current team",
        Company: "Egypt",
        Course: "",
      })),
    );
    const result = await loadLostMovement({ from: "2026-09-01", to: "2026-09-16" }, snapshot());
    expect(result.availability).toBe("available");
    expect(result.total).toBe(2);
    expect(result.fresh).toBe(1);
    expect(result.older).toBe(1);
    expect(result.ambiguousEvents).toBe(1);
    expect(result.unknownArchiveEvents).toBe(1);
    expect(result.records.map((r) => r.id).sort()).toEqual(["1", "2"]);
    expect(result.records.find((r) => r.id === "1")?.lossReason).toBe("Commercial");
    expect(result.records.find((r) => r.id === "2")?.lossReason).toBe(""); // No borrowing a present-day reason.
    expect(
      mocks.call.mock.calls.every((c) => ["check_access_rights", "get_external_id"].includes(c[1])),
    ).toBe(true);
    const periodRead = mocks.read.mock.calls.find((c) => c[0] === "mail.tracking.value");
    expect(periodRead?.[1]).toContainEqual(["mail_message_id.date", ">=", "2026-08-31 21:00:00"]);
    expect(periodRead?.[1]).toContainEqual(["mail_message_id.date", "<", "2026-09-16 21:00:00"]);
  });
  it("applies current company/source/team dimensions consistently to both cohorts, with NULL company explicit", () => {
    const row = {
      Source: "Facebook",
      Company: "Egypt",
      "Sales Team": "Team A",
      Salesperson: "Owner",
    };
    expect(
      matchesLostMovementDimensions(
        row,
        { company: "Egypt", source: "facebook", salesTeam: "Team A" },
        snapshot(),
      ),
    ).toBe(true);
    expect(matchesLostMovementDimensions(row, { company: "KSA" }, snapshot())).toBe(false);
    expect(matchesLostMovementDimensions(row, { salesTeam: "Team B" }, snapshot())).toBe(false);
    expect(matchesLostMovementDimensions({ ...row, Company: "" }, {}, snapshot())).toBe(true);
    expect(
      matchesLostMovementDimensions({ ...row, Company: "" }, { company: "Egypt" }, snapshot()),
    ).toBe(false);
  });
});
