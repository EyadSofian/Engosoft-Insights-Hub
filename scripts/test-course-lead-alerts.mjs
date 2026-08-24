import assert from "node:assert/strict";
import { analyzeCourseLeadFacts } from "../src/lib/course-lead-alerts.ts";

const anchorDate = "2026-08-23";
const comparisonFrom = "2026-08-01";
const comparisonTo = "2026-08-24";
const facts = [
  // Production-shaped CFM example: 444 ÷ 24 = 18.5 expected leads/day.
  { date: comparisonFrom, course: "CFM", leads: 438, spend: 3541.61 },
  { date: anchorDate, course: "CFM", leads: 6, spend: 76.03 },
  { date: comparisonFrom, course: "PMP", leads: 236, spend: 1140 },
  { date: anchorDate, course: "PMP", leads: 4, spend: 60 },
  { date: comparisonFrom, course: "Zero", leads: 96, spend: 546 },
  { date: anchorDate, course: "Zero", leads: 0, spend: 30 },
  { date: comparisonFrom, course: "Small", leads: 24, spend: 0 },
  { date: anchorDate, course: "Small", leads: 0, spend: 0 },
  { date: comparisonFrom, course: "Stable", leads: 138, spend: 690 },
  { date: anchorDate, course: "Stable", leads: 6, spend: 30 },
  { date: comparisonFrom, course: "Ended", leads: 192, spend: 960 },
  { date: anchorDate, course: "Ended", leads: 0, spend: 0 },
];

const report = analyzeCourseLeadFacts(facts, {
  anchorDate,
  comparisonFrom,
  comparisonTo,
  generatedAt: "2026-08-24T08:00:00Z",
});
const cfm = report.rows.find((row) => row.course === "CFM");
const pmp = report.rows.find((row) => row.course === "PMP");
const zero = report.rows.find((row) => row.course === "Zero");
const small = report.rows.find((row) => row.course === "Small");
const stable = report.rows.find((row) => row.course === "Stable");
const ended = report.rows.find((row) => row.course === "Ended");

assert.ok(cfm);
assert.equal(cfm.current.leads, 6);
assert.equal(cfm.baseline.totalLeads, 444);
assert.equal(cfm.baseline.leadsPerDay, 18.5);
assert.equal(cfm.baseline.periodDays, 24);
assert.deepEqual(cfm.issues, ["lead_drop", "cpl_spike"]);
assert.equal(cfm.status, "critical");

assert.ok(pmp);
assert.equal(pmp.baseline.leadsPerDay, 10);
assert.equal(pmp.leadDeltaPct, -60);
assert.equal(pmp.current.cpl, 15);
assert.equal(pmp.baseline.cpl, 5);
assert.deepEqual(pmp.issues, ["lead_drop", "cpl_spike"]);
assert.equal(pmp.status, "critical");

assert.ok(zero);
assert.deepEqual(zero.issues, ["spend_without_leads", "lead_drop"]);
assert.equal(zero.status, "critical");

assert.ok(small);
assert.equal(small.status, "stable", "small period averages must not create noisy alerts");
assert.ok(stable);
assert.equal(stable.status, "stable");
assert.equal(stable.trend.length, 28);
assert.ok(ended);
assert.equal(ended.hasCurrentCampaignSpend, false);
assert.equal(ended.status, "stable", "ended campaigns must not raise current alerts");

assert.deepEqual(report.comparisonPeriod, {
  from: comparisonFrom,
  to: comparisonTo,
  days: 24,
  mode: "selected_period_average",
});
assert.equal(report.summary.courseCount, 4);
assert.equal(report.summary.referenceCourseCount, 6);
assert.equal(report.summary.alertCount, 3);
assert.equal(report.summary.leadDropCount, 3);
assert.equal(report.summary.cplSpikeCount, 2);
assert.equal(report.summary.spendWithoutLeadsCount, 1);

const suppressed = analyzeCourseLeadFacts(facts, {
  anchorDate,
  comparisonFrom,
  comparisonTo,
  suppressAlerts: true,
  freshnessAgeDays: 5,
  freshnessMessage: "stale",
});
assert.equal(suppressed.summary.alertCount, 0);
assert.equal(suppressed.freshness.ok, false);
assert.equal(suppressed.freshness.ageDays, 5);

console.log("course lead alert tests passed");
