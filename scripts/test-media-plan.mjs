import assert from "node:assert/strict";
import {
  matchMediaPlanActivity,
  matchMediaPlanCourse,
  mediaPlanCourseKey,
  mediaPlanForMonth,
  nextMediaPlanMonth,
  normalizeMonthlyMediaPlan,
  OCTOBER_2026_SOURCE,
  plannedCourseBudget,
} from "../src/lib/media-plan.ts";

const september = mediaPlanForMonth("2026-09");
assert.equal(september.status, "draft");
assert.equal(september.basisMonth, "2026-08");
assert.equal(
  september.courses.reduce((sum, row) => sum + row.targetLeads, 0),
  4_000,
);
assert.equal(september.paidLeadTarget, 4_000);
assert.equal(september.organicWebinarLeadTarget, 1_000);
assert.equal(september.leadTarget, 5_000);
assert.equal(september.salesTargetUsd, 150_000);
assert.equal(
  september.courses.reduce((sum, row) => sum + plannedCourseBudget(row), 0),
  19_500,
);
assert.equal(
  september.additionalActivities.reduce((sum, row) => sum + row.budgetUsd, 0),
  4_000,
);
assert.deepEqual(september.courses.find((row) => row.key === "interior")?.owners, [
  "Shazly",
  "Sayed",
]);

const october = mediaPlanForMonth("2026-10");
assert.equal(october.status, "draft");
assert.equal(october.salesTargetUsd, 156_000);
assert.equal(october.overallMarketingBudgetUsd, 27_500);
assert.equal(october.leadGenerationBudgetUsd, 0, "source does not allocate the budget");
assert.equal(october.paidLeadTarget, 4_104);
assert.equal(
  october.courses.reduce((sum, row) => sum + row.targetLeads, 0),
  4_104,
);
assert.deepEqual(
  october.courses.map((row) => row.targetLeads),
  [648, 792, 360, 792, 504, 1_008],
);
assert.equal(
  october.courses.reduce((sum, row) => sum + plannedCourseBudget(row), 0),
  0,
  "source does not specify per-course CPL",
);
assert.equal(october.additionalActivities.find((row) => row.key === "website")?.target, 3_000);
assert.equal(october.additionalActivities.find((row) => row.key === "youtube")?.target, 300);
assert.equal(october.additionalActivities.find((row) => row.key === "branding")?.target, 500);
assert.equal(october.additionalActivities.find((row) => row.key === "youtube")?.metric, "custom");
assert.equal(october.additionalActivities.find((row) => row.key === "branding")?.metric, "custom");
assert.equal(
  OCTOBER_2026_SOURCE.statedTotalLeads - october.paidLeadTarget - 3_000,
  17_596,
  "unspecified YouTube and branding units must not be counted as leads",
);
assert.equal(
  normalizeMonthlyMediaPlan({
    ...october,
    additionalActivities: october.additionalActivities.map((row) =>
      row.key === "youtube" ? { ...row, reportedActual: 23 } : row,
    ),
  }).additionalActivities.find((row) => row.key === "youtube")?.reportedActual,
  23,
  "manually reported goal progress survives plan normalization",
);

for (const [raw, expected] of [
  ["CFM", "cfm"],
  ["Facility Management", "cfm"],
  ["Interior Design", "interior"],
  ["Decor", "interior"],
  ["PMP", "pmp"],
  ["CMRP", "cmrp"],
  ["BIM", "bim"],
  ["Automotive Mechanical & Electrical", "automotive"],
]) {
  assert.equal(mediaPlanCourseKey(raw), expected, raw);
}

assert.equal(nextMediaPlanMonth("2026-09"), "2026-10");
assert.equal(nextMediaPlanMonth("2026-12"), "2027-01");
assert.equal(
  matchMediaPlanCourse(september.courses, "BIM-1/3/26-SAYED-T", "PMP")?.key,
  "bim",
  "current campaign name wins over a stale historical course",
);
assert.equal(
  matchMediaPlanActivity(september.additionalActivities, "Copy of web-sign-4/6-sn")?.key,
  "website",
);

const custom = normalizeMonthlyMediaPlan({
  ...september,
  month: "2026-10",
  leadTarget: 999,
  paidLeadTarget: 10,
  organicWebinarLeadTarget: 2,
  courses: [
    {
      key: "electrical",
      label: "Electrical",
      targetLeads: 10,
      targetCpl: 4.5,
      owners: ["Shazly"],
      matchTerms: ["electrical courses"],
    },
  ],
});
assert.equal(custom.leadTarget, 12, "total leads is derived from paid + organic");
assert.equal(matchMediaPlanCourse(custom.courses, "electrical courses ksa")?.key, "electrical");
assert.throws(() => normalizeMonthlyMediaPlan({ ...custom, month: "2026-13" }), /month/);

console.log("media plan: all assertions passed");
