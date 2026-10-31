import { describe, expect, it } from "vitest";
import { summarizeYeastarCalls } from "@/lib/yeastar-call-summary";

const call = {
  call_id: "one",
  extension: "3001",
  user_name: "Salesperson",
  started_at: "2026-10-20T09:00:00Z",
  direction: "outbound",
  talk_sec: "120",
  call_duration_sec: "140",
  disposition: "ANSWERED",
};

describe("direct Yeastar call statistics", () => {
  it("counts attempts and answered calls separately, without a transcript", () => {
    const [row] = summarizeYeastarCalls(
      [
        call,
        {
          ...call,
          call_id: "two",
          talk_sec: "0",
          disposition: "NO ANSWER",
          call_duration_sec: "20",
        },
      ],
      [],
      "2026-10-01",
      "2026-10-31",
    );
    expect(row.totalCalls).toBe(2);
    expect(row.answeredCalls).toBe(1);
    expect(row.periodTalkSeconds).toBe(120);
    expect(row.periodCallSeconds).toBe(160);
    expect(row.averageCallSeconds).toBe(80);
    expect(row.analyzedCalls).toBe(0);
    expect(row.averageScore).toBeNull();
  });
  it("does not multiply a call or its hours across repeated PBX legs", () => {
    const [row] = summarizeYeastarCalls(
      [call, call, { ...call, talk_sec: "60" }],
      [],
      "2026-10-01",
      "2026-10-31",
    );
    expect(row.totalCalls).toBe(1);
    expect(row.periodTalkSeconds).toBe(120);
  });
  it("uses Cairo calendar boundaries, not server dates, across DST", () => {
    const rows = summarizeYeastarCalls(
      [
        { ...call, started_at: "2026-10-19T21:30:00Z" },
        { ...call, call_id: "outside", started_at: "2026-10-20T22:30:00Z" },
        { ...call, call_id: "invalid", started_at: "bad" },
      ],
      [],
      "2026-10-20",
      "2026-10-20",
    );
    expect(rows[0].totalCalls).toBe(1);
    expect(
      summarizeYeastarCalls(
        [{ ...call, started_at: "2026-10-30T22:30:00Z" }],
        [],
        "2026-10-31",
        "2026-10-31",
      )[0].totalCalls,
    ).toBe(1);
  });
  it("includes incoming and outgoing calls but not internal calls", () => {
    const [row] = summarizeYeastarCalls(
      [
        call,
        { ...call, call_id: "incoming", direction: "inbound" },
        { ...call, call_id: "internal", direction: "internal" },
      ],
      [],
      "2026-10-01",
      "2026-10-31",
    );
    expect(row.totalCalls).toBe(2);
  });
  it("maps extension identity and preserves known zero activity", () => {
    const rows = summarizeYeastarCalls(
      [{ ...call, user_name: "" }],
      [
        { extension: "3001", user_name: "Mapped person" },
        { extension: "3002", user_name: "No calls" },
      ],
      "2026-10-01",
      "2026-10-31",
    );
    expect(rows[0].name).toBe("Mapped person");
    expect(rows[1].totalCalls).toBe(0);
    expect(
      summarizeYeastarCalls([{ ...call, call_id: "" }], [], "2026-10-01", "2026-10-31"),
    ).toEqual([]);
  });
});
