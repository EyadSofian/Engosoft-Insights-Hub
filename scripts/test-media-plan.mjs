import assert from "node:assert/strict";
import {
  mediaPlanCourseKey,
  mediaPlanForMonth,
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

console.log("media plan: all assertions passed");
