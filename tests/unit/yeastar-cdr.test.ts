import { describe, expect, it } from "vitest";
import { collapseYeastarCdr, parseYeastarCdrPage } from "../../src/lib/yeastar-cdr.server";

describe("Yeastar CDR attempts", () => {
  it("accepts Yeastar's successful empty-day response without a data field", () => {
    expect(parseYeastarCdrPage({ errcode: 0, total_number: 0 })).toEqual({
      total: 0,
      records: [],
    });
    expect(() => parseYeastarCdrPage({ errcode: 0, total_number: 1 })).toThrow(
      "Yeastar CDR data is missing",
    );
  });

  it("counts multiple PBX legs as one outbound customer attempt", () => {
    const calls = collapseYeastarCdr("2026-10-22", [
      {
        uid: "call-1",
        call_type: "Outbound",
        call_to_number: "+966501234567",
        call_from_number: "3001",
        timestamp: 1792657737,
        disposition: "NO ANSWER",
      },
      {
        uid: "call-1",
        call_type: "Outbound",
        call_to_number: "+966501234567",
        call_from_number: "3001",
        timestamp: 1792657737,
        disposition: "ANSWERED",
      },
      {
        uid: "call-2",
        call_type: "Inbound",
        call_to_number: "3001",
        timestamp: 1792657737,
      },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.answered).toBe(true);
    expect(calls[0]?.phone).toBe("966501234567");
  });
});
