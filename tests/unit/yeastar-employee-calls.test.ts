import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  YEASTAR_EMPLOYEE_IDENTITIES,
  yeastarEmployeeCandidateKeys,
  yeastarEmployeeIdentity,
} from "@/lib/yeastar-employee-identity";

vi.mock("@/lib/yeastar-cdr.server", async (original) => ({
  ...(await original<typeof import("@/lib/yeastar-cdr.server")>()),
  accessToken: vi.fn().mockResolvedValue("test-token"),
}));
const timestamp = Date.parse("2026-11-10T22:30:00Z") / 1000;
const call = {
  uid: "one",
  timestamp,
  call_type: "Outbound",
  call_from_number: "3005",
  call_to_number: "966501234567",
  talk_duration: 120,
  duration: 140,
  disposition: "ANSWERED",
};
const directory = () =>
  YEASTAR_EMPLOYEE_IDENTITIES.map((p) => ({ number: p.extension, caller_id_name: p.pbxName }));
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("YEASTAR_BASE_URL", "https://example.test");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("verified Nesting employee calls", () => {
  it("matches all four verified identities to canonical rows rather than ambiguous short names", () => {
    expect(yeastarEmployeeCandidateKeys("3092", "Abdelrahman Hamouda")[0]).toBe(
      "abdelrahman abdelhamid nasreldin",
    );
    expect(yeastarEmployeeCandidateKeys("3005", "Ahmed Salah")[0]).toBe(
      "ahmed salah aboyazed hassan",
    );
    expect(yeastarEmployeeCandidateKeys("3030", "Radwa Sameh")[0]).toBe("radwa sameh salem");
    expect(yeastarEmployeeCandidateKeys("3093", "Solaf Ali")[0]).toBe("solaf ali mostafa kamal");
    expect(yeastarEmployeeIdentity("3005", "Different Person")).toBeUndefined();
    expect(yeastarEmployeeCandidateKeys("9999", "Ahmed Salah")).toEqual([]);
    expect(yeastarEmployeeCandidateKeys("3041", "Menna Magdy")).toEqual(["mennaallah magdy"]);
    expect(yeastarEmployeeCandidateKeys("3044", "Abdelrahman Tarek")).toEqual([
      "abdulrahman tareq abdullwahab",
    ]);
    expect(yeastarEmployeeCandidateKeys("3044", "Abdelrahman Sabry")).toEqual([]);
  });
  it("excludes internal calls, another agent's legs, and invalid records", async () => {
    const { normalizeEmployeeCdr } = await import("@/lib/yeastar-employee-calls.server");
    const rows = normalizeEmployeeCdr(
      [
        call,
        { ...call, call_type: "Internal" },
        { ...call, call_from_number: "3030" },
        { ...call, timestamp: "bad" },
        { ...call, uid: "", call_id: "" },
      ],
      "3005",
      "Ahmed Salah",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ extension: "3005", talk_sec: 120, call_duration_sec: 140 });
  });
  it("deduplicates PBX legs and both search results, uses Cairo dates, and shares cached reads", async () => {
    const fetch = vi.fn(async (url: URL) => {
      if (url.pathname.endsWith("extension/list"))
        return Response.json({ errcode: 0, total_number: 4, data: directory() });
      const p = url.searchParams;
      expect(p.get("start_time")).toBe(String(Date.parse("2026-11-11T00:00:00+02:00") / 1000));
      const ext = p.get("call_from") || p.get("call_to");
      const rows =
        ext === "3005"
          ? [
              call,
              { ...call, talk_duration: 60 },
              {
                ...call,
                uid: "incoming",
                call_type: "Inbound",
                call_from_number: "966501234567",
                call_to_number: "3005",
                talk_duration: 30,
                duration: 40,
              },
              { ...call, uid: "outside", timestamp: timestamp - 86400 },
            ]
          : [];
      return Response.json({
        errcode: 0,
        total_number: rows.length,
        ...(rows.length ? { data: rows } : {}),
      });
    });
    vi.stubGlobal("fetch", fetch);
    const { readVerifiedEmployeeCalls } = await import("@/lib/yeastar-employee-calls.server");
    const [a, b] = await Promise.all([
      readVerifiedEmployeeCalls("2026-11-11", "2026-11-11"),
      readVerifiedEmployeeCalls("2026-11-11", "2026-11-11"),
    ]);
    expect(a).toBe(b);
    expect(a.employees.find((r) => r.extension === "3005")).toMatchObject({
      totalCalls: 2,
      answeredCalls: 2,
      periodTalkSeconds: 150,
      periodCallSeconds: 180,
    });
    expect(a.employees.find((r) => r.extension === "3093")?.totalCalls).toBe(0);
    expect(a.leadCalls).toHaveLength(1);
    expect(a.leadCalls[0]).toMatchObject({
      agentExtension: "3005",
      totalCalls: 1,
      callDate: "2026-11-11",
    });
    await readVerifiedEmployeeCalls("2026-11-11", "2026-11-11");
    expect(fetch).toHaveBeenCalledTimes(9);
    expect(JSON.stringify(a)).not.toContain("test-token");
  });
  it("rejects a reassigned extension instead of crediting its calls to the previous owner", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          errcode: 0,
          total_number: 4,
          data: directory().map((p) =>
            p.number === "3005" ? { ...p, caller_id_name: "Another employee" } : p,
          ),
        }),
      ),
    );
    const { readVerifiedEmployeeCalls } = await import("@/lib/yeastar-employee-calls.server");
    await expect(readVerifiedEmployeeCalls("2026-11-11", "2026-11-11")).rejects.toThrow(
      "ownership needs verification",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not report zero for an incomplete pagination result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) =>
        Response.json(
          url.pathname.endsWith("extension/list")
            ? { errcode: 0, total_number: 4, data: directory() }
            : { errcode: 0, total_number: 3, data: [] },
        ),
      ),
    );
    const { readVerifiedEmployeeCalls } = await import("@/lib/yeastar-employee-calls.server");
    await expect(readVerifiedEmployeeCalls("2026-11-11", "2026-11-11")).rejects.toThrow(
      "pagination is incomplete",
    );
  });
});
