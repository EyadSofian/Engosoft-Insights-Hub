import { describe, expect, it } from "vitest";
import {
  acquisitionDateFilters,
  acquisitionReportingPeriod,
} from "@/lib/acquisition-reporting-period";

describe("acquisition reporting periods", () => {
  const today = "2026-11-05";
  it("keeps the API opt-out from month-to-date", () => {
    const filters = acquisitionDateFilters(new URLSearchParams("range=all"));
    expect(filters.range).toBe("all");
    expect(acquisitionReportingPeriod(filters, today, "2025-07-20")).toEqual({
      from: "2025-07-20",
      to: today,
    });
  });
  it("defaults to MTD only without an explicit range", () => {
    expect(acquisitionReportingPeriod({}, today)).toEqual({ from: "2026-11-01", to: today });
  });
  it("honours a previous month, year-crossing window and single-sided dates", () => {
    for (const filters of [
      { from: "2026-10-01", to: "2026-10-31" },
      { from: "2025-12-01", to: "2026-01-31" },
    ])
      expect(acquisitionReportingPeriod(filters, today)).toEqual(filters);
    expect(acquisitionReportingPeriod({ to: "2025-07-25" }, today)).toEqual({
      from: "2025-07-01",
      to: "2025-07-25",
    });
  });
  it("ignores stale dates when All time is explicit and invents no historical date", () => {
    expect(
      acquisitionReportingPeriod({ range: "all", from: "2026-11-01" }, today, "2024-01-02").from,
    ).toBe("2024-01-02");
    expect(acquisitionReportingPeriod({ range: "all" }, today)).toEqual({ from: today, to: today });
  });
});
