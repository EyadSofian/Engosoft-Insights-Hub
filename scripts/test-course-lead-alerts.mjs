import assert from "node:assert/strict";
import { analyzeCourseLeadFacts } from "../src/lib/course-lead-alerts.ts";

const anchorDate = "2026-08-22";
const baselineDates = Array.from({ length: 8 }, (_, index) => {
  const date = new Date(`${anchorDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (index + 1) * 7);
  return date.toISOString().slice(0, 10);
});

const facts = [];
for (const date of baselineDates) {
  facts.push({ date, course: "PMP", leads: 10, spend: 50 });
  facts.push({ date, course: "CFM", leads: 4, spend: 24 });
  facts.push({ date, course: "Small", leads: 1, spend: 0 });
  facts.push({ date, course: "Stable", leads: 6, spend: 30 });
}
facts.push({ date: anchorDate, course: "PMP", leads: 4, spend: 60 });
facts.push({ date: anchorDate, course: "CFM", leads: 0, spend: 30 });
facts.push({ date: anchorDate, course: "Small", leads: 0, spend: 0 });
facts.push({ date: anchorDate, course: "Stable", leads: 6, spend: 30 });

const report = analyzeCourseLeadFacts(facts, { anchorDate, generatedAt: "2026-08-23T08:00:00Z" });
const pmp = report.rows.find((row) => row.course === "PMP");
const cfm = report.rows.find((row) => row.course === "CFM");
const small = report.rows.find((row) => row.course === "Small");
const stable = report.rows.find((row) => row.course === "Stable");

assert.ok(pmp);
assert.equal(pmp.current.leads, 4);
assert.equal(pmp.baseline.leadsPerDay, 10);
assert.equal(pmp.leadDeltaPct, -60);
assert.equal(pmp.current.cpl, 15);
assert.equal(pmp.baseline.cpl, 5);
assert.deepEqual(pmp.issues, ["lead_drop", "cpl_spike"]);
assert.equal(pmp.status, "critical");

assert.ok(cfm);
assert.deepEqual(cfm.issues, ["spend_without_leads", "lead_drop"]);
assert.equal(cfm.status, "critical");

assert.ok(small);
assert.equal(small.status, "stable", "small baselines must not create noisy alerts");
assert.ok(stable);
assert.equal(stable.status, "stable");
assert.equal(stable.trend.length, 28);

assert.equal(report.summary.alertCount, 2);
assert.equal(report.summary.leadDropCount, 2);
assert.equal(report.summary.cplSpikeCount, 1);
assert.equal(report.summary.spendWithoutLeadsCount, 1);

const suppressed = analyzeCourseLeadFacts(facts, {
  anchorDate,
  suppressAlerts: true,
  freshnessAgeDays: 5,
  freshnessMessage: "stale",
});
assert.equal(suppressed.summary.alertCount, 0);
assert.equal(suppressed.freshness.ok, false);
assert.equal(suppressed.freshness.ageDays, 5);

console.log("course lead alert tests passed");
