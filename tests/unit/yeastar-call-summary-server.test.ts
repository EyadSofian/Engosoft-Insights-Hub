import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/database-pool.server", () => ({
  getSharedDatabasePool: () => ({ query: mocks.query }),
}));
vi.mock("@/lib/yeastar-cdr.server", async (original) => ({
  ...(await original<typeof import("@/lib/yeastar-cdr.server")>()),
  accessToken: mocks.auth,
}));

const day = "2026-11-11";
const ext = { number: "3090", caller_id_name: "Mostafa Reda" };
const inactive = { number: "3091", caller_id_name: "Another Employee" };
const base = {
  timestamp: Date.parse(day + "T09:00:00Z") / 1000,
  call_type: "Outbound",
  call_from_number: ext.number,
  call_from_name: ext.caller_id_name,
  call_to_number: "201000000000",
  call_id: "out",
  uid: "record-1",
  duration: 45,
  talk_duration: 0,
  disposition: "NO ANSWER",
};
const inbound = {
  ...base,
  call_type: "Inbound",
  call_from_number: base.call_to_number,
  call_from_name: "Customer",
  call_to_name: ext.caller_id_name,
  call_to_number: ext.number,
  call_id: "in",
  uid: "record-2",
  duration: 85,
  talk_duration: 60,
  disposition: "ANSWERED",
};
const body = (data: unknown[], total = data.length) =>
  Response.json({ errcode: 0, total_number: total, data });
const load = () => import("@/lib/yeastar-call-summary.server");

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv("YEASTAR_BASE_URL", "https://example.test");
  mocks.auth.mockResolvedValue("token");
  mocks.query.mockResolvedValue({ rows: [] });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("complete Yeastar call totals", () => {
  it("uses both directions, counts one call across multiple CDR legs, and persists no raw phone numbers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) =>
        url.pathname.endsWith("extension/list")
          ? body([ext, inactive])
          : body([
              base,
              inbound,
              { ...inbound, uid: "record-3", talk_duration: 50 },
              {
                ...inbound,
                call_id: "queue",
                call_to_number: "6413",
                call_to_name: "Mostafa Reda follow up",
              },
              {
                ...base,
                call_id: "internal",
                call_type: "Internal",
                call_to_number: inactive.number,
              },
              { ...inbound, call_id: "outside", timestamp: Date.parse(day + "T22:15:00Z") / 1000 },
            ]),
      ),
    );
    const { readYeastarCallSummary } = await load();
    const result = await readYeastarCallSummary(day, day);
    expect(result.employees).toMatchObject([
      {
        extension: ext.number,
        totalCalls: 2,
        outboundCalls: 1,
        inboundCalls: 1,
        answeredCalls: 1,
        periodTalkSeconds: 60,
        periodCallSeconds: 130,
        averageCallSeconds: 65,
      },
      { extension: inactive.number, totalCalls: 0, outboundCalls: 0, inboundCalls: 0 },
    ]);
    expect(result.recordsAvailable).toBe(false);
    const insert = mocks.query.mock.calls.find(([sql]) =>
      sql.includes("INSERT INTO yeastar_daily_call_totals"),
    );
    expect(insert).toBeDefined();
    expect(insert?.[1]?.[0]).not.toContain(base.call_to_number);
    expect(insert?.[1]?.[0]).not.toContain("record-1");
  });

  it("reuses a closed-day snapshot but refreshes a partial snapshot after midnight", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T01:00:00Z"));
    const fetch = vi.fn(async (url: URL) =>
      url.pathname.endsWith("extension/list") ? body([ext]) : body([base, inbound]),
    );
    vi.stubGlobal("fetch", fetch);
    const { readYeastarCallSummary } = await load();
    const result = await readYeastarCallSummary(day, day);
    mocks.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes("SELECT day::text")
        ? [{ day, through: result.fetchedAt, employees: result.employees }]
        : [],
    }));
    fetch.mockClear();
    expect((await readYeastarCallSummary(day, day)).employees[0].totalCalls).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
    mocks.query.mockResolvedValue({ rows: [{ day, through: day + "T18:00:00Z", employees: [] }] });
    expect((await readYeastarCallSummary(day, day)).employees[0].totalCalls).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not serve a partial or repeated page as an exact total", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) =>
        url.pathname.endsWith("extension/list") ? body([ext]) : body([base], 2),
      ),
    );
    const { readYeastarCallSummary } = await load();
    await expect(readYeastarCallSummary(day, day)).rejects.toThrow("repeated page");
    expect(
      mocks.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO yeastar_daily_call_totals")),
    ).toBe(false);
  });

  it("leaves call totals unavailable when PBX fails, rather than falling back to partial outbound data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) =>
        url.pathname.endsWith("extension/list") ? body([ext]) : new Response(null, { status: 503 }),
      ),
    );
    const { readYeastarCallSummary } = await load();
    await expect(readYeastarCallSummary(day, day)).rejects.toThrow("Yeastar call totals HTTP 503");
    expect(
      mocks.query.mock.calls.some(([sql]) =>
        /INSERT INTO yeastar_daily_call_totals|dashboard_rows/.test(sql),
      ),
    ).toBe(false);
  });

  it("serves complete closed periods during a PBX outage without inventing zeros", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    mocks.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes("SELECT day::text")
        ? [
            {
              day,
              through: day + "T21:59:59Z",
              employees: [
                {
                  extension: ext.number,
                  totalCalls: 2,
                  inboundCalls: 1,
                  outboundCalls: 1,
                  name: ext.caller_id_name,
                },
              ],
            },
          ]
        : [],
    }));
    const { readYeastarCallSummary } = await load();
    expect((await readYeastarCallSummary(day, day)).employees).toMatchObject([
      { extension: ext.number, totalCalls: 2 },
    ]);
  });
});
