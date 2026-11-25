import { describe, expect, it } from "vitest";
import { managementReviewWindow } from "@/lib/management-review-period";
import { emptyFunnel, mergeFunnelCourses, summarizeFunnel } from "@/lib/management-review";

const today = "2026-11-25";
describe("management review follows global dates", () => {
  it("defaults to the current month, not the previous month", () => {
    expect(managementReviewWindow({}, today)).toEqual({
      from: "2026-11-01",
      to: today,
      months: ["2026-11"],
      selectedMonth: "2026-11",
    });
  });
  it("keeps exact top-bar dates and overrides a legacy independent month", () => {
    expect(
      managementReviewWindow({ from: "2026-10-11", to: "2026-10-20" }, today, "2026-09"),
    ).toEqual({
      from: "2026-10-11",
      to: "2026-10-20",
      months: ["2026-10"],
      selectedMonth: "2026-10",
    });
  });
  it("supports multi-month windows and clamps a future end to today", () => {
    expect(managementReviewWindow({ from: "2026-10-11", to: "2026-11-30" }, today)).toEqual({
      from: "2026-10-11",
      to: today,
      months: ["2026-10", "2026-11"],
      selectedMonth: "",
    });
  });
  it("retains legacy month callers only when explicit dates are absent", () => {
    expect(managementReviewWindow({}, today, "2026-10").to).toBe("2026-10-31");
    expect(managementReviewWindow({ range: "all" }, today).months).toHaveLength(23);
  });
  it.each([
    { from: "2026-02-30", to: today },
    { from: "2026-11-20", to: "2026-11-10" },
    { from: "2024-01-01", to: today },
    { from: "2026-12-01", to: "2026-12-31" },
  ])("rejects unsupported or invalid periods %o", (filters) => {
    expect(() => managementReviewWindow(filters, today)).toThrow("INVALID_REVIEW_PERIOD");
  });
  it("merges course facts and recalculates weighted rates, not monthly averages", () => {
    const courses = mergeFunnelCourses([
      {
        ...emptyFunnel(),
        course: "PMP",
        leads: 10,
        won: 2,
        lost: 3,
        turnaroundDaysSum: 4,
        turnaroundSamples: 1,
      },
      {
        ...emptyFunnel(),
        course: "PMP",
        leads: 90,
        won: 9,
        lost: 20,
        turnaroundDaysSum: 90,
        turnaroundSamples: 9,
      },
    ]);
    const result = summarizeFunnel(courses);
    expect(result.courses).toHaveLength(1);
    expect(result.conversion).toBe(0.11);
    expect(result.lostRate).toBe(0.23);
    expect(result.turnaroundDays).toBe(9.4);
  });
});
