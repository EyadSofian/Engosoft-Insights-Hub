import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ filtered: vi.fn(), courses: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (config: unknown) => config }));
vi.mock("@/lib/metrics.server", () => ({
  getFiltered: mocks.filtered,
  computeCourses: mocks.courses,
  getDefaultRange: async () => ({ from: "2026-11-01", to: "2026-11-25" }),
}));
vi.mock("@/lib/media-plans.server", () => ({
  loadMediaPlanSource: async () => ({
    plans: {
      "2026-10": {
        status: "approved",
        salesTargetUsd: 1500,
        paidLeadTarget: 100,
        overallMarketingBudgetUsd: 100,
        courses: [],
      },
      "2026-11": {
        status: "draft",
        salesTargetUsd: 2000,
        paidLeadTarget: 200,
        overallMarketingBudgetUsd: 200,
        courses: [],
      },
    },
    editedMonths: [],
  }),
}));
vi.mock("@/lib/yearly-crm-history.server", () => ({
  historicalCrm: async () => ({ rows: [], status: "ready", funnelReady: false, syncedAt: "" }),
}));
vi.mock("@/lib/sheet-cache.server", () => ({ loadAllData: async () => ({ accounting: [] }) }));

type HandlerRoute = {
  server: { handlers: { GET: (input: { request: Request }) => Promise<Response> } };
};
const invoke = async (query = "") => {
  const { Route } = await import("@/routes/api/management-review");
  return (Route as unknown as HandlerRoute).server.handlers.GET({
    request: new Request("https://test/api/management-review" + query),
  });
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-25T10:00:00Z"));
  mocks.courses.mockReturnValue([]);
  mocks.filtered.mockImplementation(async ({ from, to }) => {
    const accounting = [
      { paymentDate: "2026-10-20", invoiceDate: "2026-09-01", usdPaid: 300 },
      { paymentDate: "2026-11-10", invoiceDate: "2026-10-01", usdPaid: 100 },
      { paymentDate: "2026-11-20", invoiceDate: "2026-10-01", usdPaid: 200 },
    ].filter((row) => row.paymentDate >= from && row.paymentDate <= to);
    return {
      accounting,
      ads: [],
      crm: [],
      lost: [],
      invoiced: [],
      snapshot: {
        crmDateMin: "2026-01-01",
        crmDateMax: "2026-11-25",
        adsDateMin: "2026-01-01",
        adsDateMax: "2026-11-25",
        revenueDateMin: "2026-01-01",
        revenueDateMax: "2026-11-25",
        health: { lostAuthority: "live" },
      },
    };
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("management review API period contract", () => {
  it("defaults to the same November dates as other endpoints, not October", async () => {
    const body = await (await invoke()).json();
    expect(body.selectedPeriod).toEqual({ from: "2026-11-01", to: "2026-11-25" });
    expect(body.selected.actual.revenue).toBe(300);
    expect(body.selected.target.revenue).toBe(2000);
  });
  it("honors exact dates over month and ignores invoice-date toggle for collections", async () => {
    const body = await (
      await invoke("?from=2026-11-05&to=2026-11-15&month=2026-10&dateBasis=invoice")
    ).json();
    expect(body.selected.actual.revenue).toBe(100);
    expect(body.selected.target.revenue).toBe(2000);
    expect(body.appliedFilters.dateBasis).toBeUndefined();
    expect(mocks.filtered).toHaveBeenCalledWith(
      expect.objectContaining({ from: "2026-11-05", to: "2026-11-15" }),
    );
  });
  it("aggregates included monthly plans but only exact-period actual revenue", async () => {
    const body = await (await invoke("?from=2026-10-15&to=2026-11-15")).json();
    expect(body.selected.actual.revenue).toBe(400);
    expect(body.selected.target.revenue).toBe(3500);
    expect(body.selected.achievement.revenue).toBeCloseTo(400 / 3500);
    expect(body.rows).toHaveLength(2);
  });
  it("keeps supported filters on legacy month calls and does not guess their targets", async () => {
    const body = await (await invoke("?month=2026-10&course=PMP")).json();
    expect(body.selectedPeriod).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(mocks.filtered).toHaveBeenCalledWith(expect.objectContaining({ course: "PMP" }));
    expect(body.selected.target.revenue).toBeNull();
  });
  it("returns a readable 400 for invalid dates", async () => {
    expect((await invoke("?from=2026-02-30&to=2026-11-25")).status).toBe(400);
  });
});
