import { describe, expect, it } from "vitest";
import { presetWindow } from "@/lib/filter-store";

describe("date filter presets", () => {
  it("returns the complete previous calendar month", () => {
    expect(presetWindow("prev_month", "2026-09-16")).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });

  it("crosses the year boundary for January anchors", () => {
    expect(presetWindow("prev_month", "2026-01-12")).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });
});
