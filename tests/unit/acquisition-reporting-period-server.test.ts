import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), cte: vi.fn() }));
vi.mock("@/lib/acquisition-attribution.server", () => ({
  BUSINESS_TIME_ZONE: "Africa/Cairo",
  eventsCte: mocks.cte,
  getPool: () => ({ query: mocks.query }),
}));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());
describe("available acquisition history", () => {
  it("does not query history for normal date selections", async () => {
    const { resolveAcquisitionReportingPeriod } =
      await import("@/lib/acquisition-reporting-period.server");
    expect(await resolveAcquisitionReportingPeriod({})).toEqual({
      from: "2026-11-01",
      to: "2026-11-05",
    });
    expect(mocks.cte).not.toHaveBeenCalled();
  });
  it("uses the earliest date across available facts and datasets and caches it", async () => {
    mocks.cte.mockResolvedValue({
      cte: "WITH acquisition_events AS (SELECT now() AS occurred_at)",
      dashboardRows: true,
    });
    mocks.query.mockImplementation(async (sql: string) => ({
      rows: [{ day: sql.includes("dashboard_rows") ? "2024-02-01" : "2025-07-20" }],
    }));
    const { resolveAcquisitionReportingPeriod } =
      await import("@/lib/acquisition-reporting-period.server");
    expect(await resolveAcquisitionReportingPeriod({ range: "all" })).toEqual({
      from: "2024-02-01",
      to: "2026-11-05",
    });
    await resolveAcquisitionReportingPeriod({ range: "all" });
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });
  it("does not silently fall back to this month if history lookup fails", async () => {
    mocks.cte.mockRejectedValue(new Error("history unavailable"));
    const { resolveAcquisitionReportingPeriod } =
      await import("@/lib/acquisition-reporting-period.server");
    await expect(resolveAcquisitionReportingPeriod({ range: "all" })).rejects.toThrow(
      "history unavailable",
    );
  });
});
