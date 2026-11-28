import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  connect: vi.fn(),
  direct: vi.fn(),
}));
vi.mock("@/lib/yeastar-employee-calls.server", () => ({ readVerifiedEmployeeCalls: mocks.direct }));
vi.mock("@/lib/database-pool.server", () => ({
  getSharedDatabasePool: () => ({ connect: mocks.connect }),
}));
import { readYeastarCallSummary } from "@/lib/yeastar-call-summary.server";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
});
afterEach(() => vi.unstubAllEnvs());
describe("direct call store reliability", () => {
  it("replaces incomplete stored employee totals rather than adding duplicate calls", async () => {
    vi.stubEnv("YEASTAR_BASE_URL", "https://example.test");
    vi.stubEnv("YEASTAR_CLIENT_ID", "test");
    vi.stubEnv("YEASTAR_CLIENT_SECRET", "test");
    const direct = {
      key: "3005",
      name: "Ahmed Salah",
      extension: "3005",
      totalCalls: 10,
      answeredCalls: 5,
      periodTalkSeconds: 600,
      periodCallSeconds: 800,
      averageCallSeconds: 80,
      analyzedCalls: 0,
      averageScore: null,
      needsReview: 0,
    };
    mocks.direct.mockResolvedValue({
      employees: [direct],
      leadCalls: [],
      fetchedAt: new Date().toISOString(),
    });
    mocks.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes("dashboard_sync_state")
        ? [{ dataset: "sla_calls", status: "success", synced_at: new Date() }]
        : sql.includes("AS call_id")
          ? [
              {
                call_id: "one",
                extension: "3005",
                user_name: "Ahmed Salah",
                started_at: "2026-11-11T09:00:00Z",
                direction: "outbound",
                talk_sec: "120",
              },
            ]
          : [],
    }));
    const result = await readYeastarCallSummary("2026-11-01", "2026-11-28");
    expect(result.employees).toEqual([direct]);
    expect(mocks.direct).toHaveBeenCalledWith("2026-11-01", "2026-11-28");
  });
  it("does not depend on the analysis host or perform a network request", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    mocks.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes("dashboard_sync_state")
        ? [{ dataset: "sla_calls", status: "success", synced_at: new Date() }]
        : sql.includes("AS call_id")
          ? [
              {
                call_id: "1",
                extension: "3001",
                started_at: "2026-10-20T09:00:00Z",
                direction: "outbound",
                talk_sec: "3600",
                call_duration_sec: "3610",
              },
            ]
          : sql.includes("pbx_extensions")
            ? [{ row_data: { extension: "3001", user_name: "Person" } }]
            : [],
    }));
    const result = await readYeastarCallSummary("2026-10-01", "2026-10-31");
    expect(result.employees[0].periodTalkSeconds / 3600).toBe(1);
    expect(result.recordsAvailable).toBe(false);
    expect(result.source).toContain("direct");
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalled();
    fetch.mockRestore();
  });
  it.each(["never", "failed", "stale"])(
    "does not fabricate zero calls from a %s feed",
    async (state) => {
      mocks.query.mockImplementation(async (sql: string) => ({
        rows: sql.includes("dashboard_sync_state")
          ? [
              {
                dataset: "sla_calls",
                status: state === "stale" ? "success" : state,
                synced_at: state === "stale" ? "2020-01-01" : new Date(),
              },
            ]
          : [],
      }));
      await expect(readYeastarCallSummary("2026-10-01", "2026-10-31")).rejects.toThrow(
        "unavailable or stale",
      );
      expect(mocks.query).toHaveBeenCalledWith("ROLLBACK");
      expect(mocks.release).toHaveBeenCalled();
    },
  );
});
