import { describe, expect, it } from "vitest";
import {
  MEDIA_PLANS,
  mediaPlanForMonth,
  mediaPlanMonths,
  mediaPlanBudgetSummary,
  normalizeMonthlyMediaPlan,
  plannedCourseBudget,
  matchMediaPlanCourse,
} from "@/lib/media-plan";

describe("November 2026 management media plan", () => {
  const plan = mediaPlanForMonth("2026-11");
  it("adds November without changing October or inventing website leads", () => {
    expect(mediaPlanMonths()[0]).toBe("2026-11");
    expect(MEDIA_PLANS["2026-10"].paidLeadTarget).toBe(4176);
    expect(plan.status).toBe("draft");
    expect(plan.salesTargetUsd).toBe(140000);
    expect(plan.courses).toHaveLength(8);
    expect(plan.courses.reduce((sum, row) => sum + row.targetLeads, 0)).toBe(3400);
    expect(plan.paidLeadTarget).toBe(3400);
    expect(plan.additionalActivities.find((row) => row.key === "website")?.target).toBeUndefined();
  });
  it("preserves the explicit Automotive budget instead of multiplying a rounded CPL", () => {
    const automotive = plan.courses.find((row) => row.key === "automotive")!;
    expect(automotive.targetCpl).toBe(1.6);
    expect(plannedCourseBudget(automotive)).toBe(1000);
    expect(plan.courses.reduce((sum, row) => sum + plannedCourseBudget(row), 0)).toBe(19200);
    expect(plan.leadGenerationBudgetUsd / plan.paidLeadTarget).toBeCloseTo(5.64706);
    const normalized = normalizeMonthlyMediaPlan(plan);
    expect(normalized.courses.find((row) => row.key === "automotive")?.budgetUsd).toBe(1000);
    expect(normalized.additionalActivities.find((row) => row.key === "website")?.owners).toEqual([
      "Sayed",
    ]);
  });
  it("does not silently assign the missing $1,000 to Sayed", () => {
    const summary = mediaPlanBudgetSummary(plan);
    expect(summary.total).toBe(23500);
    expect(summary.allocated).toBe(22500);
    expect(summary.unallocated).toBe(1000);
    expect(summary.owners.find((row) => row.owner === "Sayed")?.budgetUsd).toBe(16950);
    expect(summary.owners.find((row) => row.owner === "Shazly")?.budgetUsd).toBe(5550);
  });
  it("keeps new tracks separate from PMP and YouTube sales separate from leads", () => {
    expect(matchMediaPlanCourse(plan.courses, "CAPM")?.key).toBe("rmp-capm");
    expect(matchMediaPlanCourse(plan.courses, "RMP")?.key).toBe("rmp-capm");
    expect(matchMediaPlanCourse(plan.courses, "PMP")?.key).toBe("pmp");
    expect(matchMediaPlanCourse(plan.courses, "Membership")?.key).toBe("membership");
    expect(plan.additionalActivities.find((row) => row.key === "youtube")).toMatchObject({
      budgetUsd: 1000,
      target: 7000,
      unit: "USD sales",
      metric: "custom",
      actualSource: "manual_reported",
      owners: ["Shazly"],
    });
  });
  it("validates explicit budgets and never splits jointly owned allocations arbitrarily", () => {
    expect(() =>
      normalizeMonthlyMediaPlan({ ...plan, courses: [{ ...plan.courses[0], budgetUsd: -1 }] }),
    ).toThrow(/budget/);
    const shared = mediaPlanBudgetSummary({
      ...plan,
      courses: [{ ...plan.courses[0], owners: ["Sayed", "Shazly"] }],
      additionalActivities: [],
    });
    expect(shared.owners).toEqual([]);
    expect(shared.sharedOrUnassigned).toBe(5400);
  });
});
