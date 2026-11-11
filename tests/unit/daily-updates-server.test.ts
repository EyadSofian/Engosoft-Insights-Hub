import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
const m = vi.hoisted(() => ({
  filtered: vi.fn(),
  raw: vi.fn(),
  movement: vi.fn(),
  byIds: vi.fn(),
  coverage: vi.fn(),
  query: vi.fn(),
}));
vi.mock("@/lib/metrics.server", () => ({
  getFiltered: m.filtered,
  attributedAdCourse: (r: any) => ({ course: r.course, source: "campaign_name" }),
}));
vi.mock("@/lib/lead-course-distribution.server", () => ({ loadCrmDateRows: m.raw }));
vi.mock("@/lib/crm-lost-movement.server", () => ({
  loadLostMovement: m.movement,
  matchesLostMovementDimensions: () => true,
}));
vi.mock("@/lib/crm-odoo.server", () => ({ loadCrmRawByIds: m.byIds }));
vi.mock("@/lib/ad-delivery-coverage.server", () => ({ getAdSpendCoverage: m.coverage }));
vi.mock("@/lib/database-pool.server", () => ({
  getSharedDatabasePool: () => ({ query: m.query }),
}));
vi.mock("@/lib/odoo.server", () => ({ odooConfig: () => ({ url: "https://example.test" }) }));
const row = (id: string, segment = "Fresh") => ({
  __odoo_id: id,
  __odoo_create_date_utc: "2026-11-11 07:00:00",
  "Record Type": "opportunity",
  "Business Status": "open",
  Course: "CFM",
  Source: "Facebook",
  "Lead Segment": segment,
  "اسم جهة الاتصال": id,
});
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-11T10:00:00Z"));
  m.filtered.mockResolvedValue({
    snapshot: {
      tabSyncs: [{ key: "accounting", syncedAt: "2026-11-11T09:00:00Z" }],
      syncedAt: "2026-11-11T09:00:00Z",
    },
    ads: [
      {
        course: "CFM",
        campaign: "CFM campaign",
        campaignKey: "id:1",
        platform: "meta",
        date: "2026-11-11",
        spend: 10,
      },
    ],
    accounting: [
      {
        course: "CFM",
        orderRef: "S1",
        company: "KSA",
        paymentDate: "2026-11-11",
        invoiceDate: "2026-11-11",
        usdPaid: 100,
        movement: "INV1",
        isCreditNote: false,
      },
    ],
  });
  m.raw.mockResolvedValue([row("1"), row("2", "WhatsApp Broadcast")]);
  m.movement.mockResolvedValue({
    availability: "available",
    fetchedAt: "2026-11-11T10:00:00Z",
    records: [
      {
        id: "old",
        course: "CFM",
        lostDate: "2026-11-11",
        typeAtEvent: "lead",
        contact: "old",
        odooUrl: "https://example.test/old",
        source: "Facebook",
      },
    ],
  });
  m.byIds.mockResolvedValue([row("old", "WhatsApp Broadcast")]);
  m.coverage.mockResolvedValue({ complete: true, provisionalToday: true, gaps: [] });
  m.query.mockResolvedValue({
    rows: [{ sale_order_name: "S1", opportunity_id: "1", refreshed_at: "2026-11-11T09:00:00Z" }],
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
describe("daily server orchestration", () => {
  it("owns its Cairo day, preserves dimension filters and verifies source and segment exclusions", async () => {
    const { dailyUpdatesReport } = await import("@/lib/daily-updates.server");
    const r = await dailyUpdatesReport(
      { from: "2026-01-01", to: "2026-02-01", course: "CFM" },
      "2026-11-11",
    );
    expect(m.filtered).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "2026-11-01",
        to: "2026-11-11",
        course: "CFM",
        dateBasis: undefined,
      }),
    );
    expect(r.totals.leadsDay).toBe(1);
    expect(r.totals.lostDay).toBe(0);
    expect(r.totals.paidDayCohort).toBe(1);
    expect(r.totals.revenueDay).toBe(100);
    expect(r.details.leads[0].url).toContain("id=1");
  });
  it("does not allocate account-wide spend to a salesperson or silently accept conflicting order links", async () => {
    m.query.mockResolvedValue({
      rows: [
        { sale_order_name: "S1", opportunity_id: "1", refreshed_at: "2026-11-11T09:00:00Z" },
        { sale_order_name: "S1", opportunity_id: "2", refreshed_at: "2026-11-11T09:00:00Z" },
      ],
    });
    const { dailyUpdatesReport } = await import("@/lib/daily-updates.server");
    const r = await dailyUpdatesReport({ salesperson: "Seller" }, "2026-11-11");
    expect(r.totals.spendDay).toBeNull();
    expect(r.totals.roasDay).toBeNull();
    expect(r.unlinkedInvoices).toBe(1);
    expect(r.ambiguousOrderLinks).toBe(1);
    expect(r.totals.paidDayCohort).toBe(0);
  });
  it("unavailable CRM, event evidence, order links and stale accounting are null, not zero", async () => {
    m.raw.mockRejectedValue(Error("private source failure"));
    m.movement.mockResolvedValue({ availability: "unavailable" });
    m.query.mockRejectedValue(Error("db"));
    const data = await m.filtered();
    data.snapshot.tabSyncs = [];
    m.filtered.mockResolvedValue(data);
    const { dailyUpdatesReport } = await import("@/lib/daily-updates.server");
    const r = await dailyUpdatesReport({}, "2026-11-11");
    expect(r.totals.leadsDay).toBeNull();
    expect(r.totals.lostDay).toBeNull();
    expect(r.totals.revenueDay).toBeNull();
    expect(r.totals.conversionDay).toBeNull();
    expect(JSON.stringify(r.errors)).not.toContain("private");
  });
});
