import { describe, expect, it } from "vitest";
import { previousPeriod } from "@/lib/metrics.server";

describe("management comparison periods", () => {
  it("compares month-to-date with the same days of the previous month", () => {
    expect(previousPeriod("2026-09-01", "2026-09-09")).toEqual({
      from: "2026-08-01",
      to: "2026-08-09",
    });
  });

  it("compares a complete calendar month with the complete previous month", () => {
    expect(previousPeriod("2026-09-01", "2026-09-30")).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });

  it("caps the comparison day when the previous month is shorter", () => {
    expect(previousPeriod("2026-03-01", "2026-03-30")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
  });

  it("keeps adjacent equal-length comparison for a custom window", () => {
    expect(previousPeriod("2026-09-10", "2026-09-16")).toEqual({
      from: "2026-09-03",
      to: "2026-09-09",
    });
  });

  it("rejects reversed windows", () => {
    expect(previousPeriod("2026-09-09", "2026-09-01")).toBeNull();
  });
});
