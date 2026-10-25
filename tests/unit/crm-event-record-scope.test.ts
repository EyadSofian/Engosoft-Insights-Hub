import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ call: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/odoo.server", () => ({
  odooCall: mocks.call,
  odooCallWithPolicy: mocks.call,
  searchRead: mocks.read,
  companyContext: (extra: object) => ({ allowed_company_ids: [2, 3, 4], ...extra }),
  odooConfig: () => ({ startDate: "2026-01-01" }),
  m2oId: (v?: [number, string] | false) => (v ? v[0] : 0),
  m2oName: (v?: [number, string] | false) => (v ? v[1] : ""),
}));
import { loadCrmRawByDomain, loadCrmRawByIds } from "@/lib/crm-odoo.server";
describe("event record universe", () => {
  it("explicitly excludes Inventory, keeps Preparation and old records, and does not restrict current active/Lost state", async () => {
    mocks.call.mockImplementation(async (_model, method) =>
      method === "get_external_id"
        ? { "42": "crm.stage_lead1" }
        : {
            id: {},
            type: {},
            active: {},
            create_date: {},
            inventory_bucket: {},
            stage_id: {},
          },
    );
    mocks.read.mockImplementation(async (model) =>
      model === "crm.stage"
        ? [{ id: 42 }]
        : [
            {
              id: 1,
              type: "opportunity",
              active: true,
              create_date: "2026-08-31 21:00:00",
              stage_id: [42, "Preparation"],
              inventory_bucket: false,
            },
            {
              id: 2,
              type: "opportunity",
              active: true,
              create_date: "2026-09-02 10:00:00",
              stage_id: [42, "Preparation"],
              inventory_bucket: "inventory_1",
            },
            {
              id: 3,
              type: "lead",
              active: false,
              create_date: "2025-01-02 10:00:00",
              stage_id: [42, "Preparation"],
              inventory_bucket: false,
            },
          ],
    );
    const rows = await loadCrmRawByIds([1, 2, 3], { attempts: 1, timeoutMs: 30_000 });
    expect(rows.map((r) => r.__odoo_id)).toEqual(["1", "3"]);
    expect(rows.every((r) => r["Stage Key"] === "preparation")).toBe(true);
    expect(rows[0].__odoo_create_date_utc).toBe("2026-08-31 21:00:00");
    const crmRead = mocks.read.mock.calls.find((c) => c[0] === "crm.lead");
    expect(crmRead?.[1]).toEqual([
      ["inventory_bucket", "=", false],
      ["id", "in", [1, 2, 3]],
    ]);
    expect(crmRead?.[3].context).toMatchObject({ active_test: false, lang: "en_US" });
    const metadataCall = mocks.call.mock.calls.find((c) => c[1] === "fields_get");
    expect(metadataCall?.[3].context.allowed_company_ids).toEqual([2, 3, 4]);
    expect(
      mocks.call.mock.calls.every((c) => ["fields_get", "get_external_id"].includes(c[1])),
    ).toBe(true);
    mocks.read.mockClear();
    await loadCrmRawByDomain([["active", "=", true]], { attempts: 1, timeoutMs: 30_000 });
    expect(mocks.read.mock.calls.find((c) => c[0] === "crm.lead")?.[1]).toEqual([
      ["inventory_bucket", "=", false],
      ["active", "=", true],
    ]);
  });
});
