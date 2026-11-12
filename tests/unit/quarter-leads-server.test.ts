import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
const m = vi.hoisted(() => ({
  filtered: vi.fn(),
  tik: vi.fn(),
  query: vi.fn(),
  coverage: vi.fn(),
}));
vi.mock("@/lib/metrics.server", () => ({
  getFiltered: m.filtered,
  authoritativeLostLeads: (d: any) => d.lost || [],
  attributedAdCourse: () => ({ course: "CFM" }),
}));
vi.mock("@/lib/tiktok.server", () => ({ fetchTikTokAds: m.tik }));
vi.mock("@/lib/database-pool.server", () => ({
  getSharedDatabasePool: () => ({ query: m.query }),
}));
vi.mock("@/lib/ad-delivery-coverage.server", () => ({ getAdSpendCoverage: m.coverage }));
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T10:00:00Z"));
  m.filtered.mockResolvedValue({
    snapshot: {
      tabSyncs: ["crm", "lost", "accounting"].map((key) => ({
        key,
        syncedAt: "2026-11-12T09:30:00Z",
      })),
      health: { lostAuthority: "odoo-direct" },
    },
    ads: [
      {
        platform: "tiktok",
        date: "2026-08-01",
        campaign: "CFM",
        campaignKey: "id:1",
        adId: "a",
        accountId: "acc",
        account: "Leads",
        objective: "leads",
        spend: 100,
        clicksAll: 10,
        platformLeads: 60,
      },
    ],
    crm: [],
    lost: [],
    accounting: [],
  });
  m.tik.mockResolvedValue({
    configured: true,
    errors: [],
    rows: [{ date: "2026-08-01", adId: "a", accountId: "acc", formLeads: 0, conversions: 60 }],
  });
  m.query.mockResolvedValue({
    rows: [{ sale_order_name: "S1", opportunity_id: "1", refreshed_at: "2026-11-12T09:30:00Z" }],
  });
  m.coverage.mockResolvedValue({ complete: true, gaps: [] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
describe("quarter review sources", () => {
  it("uses TikTok form even when zero and never substitutes the mixed normalized conversion metric", async () => {
    const { quarterLeadReview } = await import("@/lib/quarter-leads-report.server");
    const r = await quarterLeadReview({ from: "2026-01-01", company: "ignored" });
    expect(r.months[0].nativeLeads).toBe(0);
    expect(r.months[0].nativeCpl).toBeNull();
    expect(r.months[0].spend).toBe(100);
    expect(m.filtered).toHaveBeenCalledWith(
      expect.objectContaining({ from: "2026-08-01", to: "2026-10-31" }),
    );
    expect(r.appliedFilters.company).toBeUndefined();
  });
  it("withholds native totals when the native source failed instead of returning zero", async () => {
    m.tik.mockResolvedValue({ configured: true, errors: ["private upstream"], rows: [] });
    const { quarterLeadReview } = await import("@/lib/quarter-leads-report.server");
    const r = await quarterLeadReview({});
    expect(r.months[0].nativeLeads).toBeNull();
    expect(r.months[0].nativeComplete).toBe(false);
    expect(JSON.stringify(r)).not.toContain("private upstream");
  });
  it("does not treat an omitted TikTok form metric as a reported zero", async () => {
    m.tik.mockResolvedValue({
      configured: true,
      errors: [],
      rows: [
        {
          date: "2026-08-01",
          adId: "a",
          accountId: "acc",
          formLeads: 0,
          formMetricAvailable: false,
        },
      ],
    });
    const { quarterLeadReview } = await import("@/lib/quarter-leads-report.server");
    const r = await quarterLeadReview({});
    expect(r.months[0].nativeLeads).toBeNull();
    expect(r.months[0].nativeComplete).toBe(false);
  });
});
