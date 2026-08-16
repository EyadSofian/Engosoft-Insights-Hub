import assert from "node:assert/strict";
import { rankCourseInsights } from "../src/lib/course-insight.ts";

const course = (key, won, lost, leads) => ({
  key,
  won,
  lost,
  leads,
  conversionRate: leads > 0 ? (won / leads) * 100 : null,
});

/* --- the real profile this rule was rewritten for -------------------------- */
// Sherif Waleed, August 2026, read from production. Every number below is his.
const sherif = [
  course("cfm", 0, 6, 22), //  $3,130 collected, but 16 of 22 leads still open
  course("pmp", 2, 0, 11), //  his only converting course
  course("bim", 0, 4, 17),
  course("interior", 0, 2, 27),
  course("management", 0, 6, 11), //  no revenue at all, cohort mostly decided
  course("elec", 0, 0, 1),
];
{
  const { best, needsSupport, bestReason } = rankCourseInsights(sherif);
  assert.equal(
    best?.key,
    "pmp",
    "a course with real wins must not be hidden by a decided-count gate",
  );
  assert.equal(bestReason, "");
  assert.equal(
    needsSupport?.key,
    "management",
    "the weak course is the decided one with no revenue, not the one still in play",
  );
  // The old rule named CFM, the course he sells most of, as his weakness.
  assert.notEqual(needsSupport?.key, "cfm");
}

/* --- a cohort still in play is neither strength nor weakness --------------- */
{
  // 22 leads, 6 decided (27%), all lost — too early to call it a failure.
  const { best, needsSupport, needsSupportReason } = rankCourseInsights([course("cfm", 0, 6, 22)]);
  assert.equal(best, null);
  assert.equal(needsSupport, null);
  assert.equal(needsSupportReason, "cohort_still_open");
}
{
  // Same course once the cohort has actually been decided.
  const { needsSupport, needsSupportReason } = rankCourseInsights([course("cfm", 0, 14, 22)]);
  assert.equal(needsSupport?.key, "cfm");
  assert.equal(needsSupportReason, "");
}

/* --- a course with no win is never the strength ---------------------------- */
{
  const { best, bestReason, needsSupport } = rankCourseInsights([course("cfm", 0, 20, 30)]);
  assert.equal(best, null, "0% can never be the best conversion");
  assert.equal(bestReason, "no_win_yet");
  assert.equal(needsSupport?.key, "cfm", "a single losing course must still be flagged");
}

/* --- ordinary cases -------------------------------------------------------- */
{
  const { best, needsSupport } = rankCourseInsights([
    course("pmp", 8, 20, 40), // 20%, 70% decided
    course("cfm", 3, 45, 60), // 5%,  80% decided
  ]);
  assert.equal(best?.key, "pmp");
  assert.equal(needsSupport?.key, "cfm");
}
{
  // The only course cannot be both the strength and the weakness.
  const { best, needsSupport } = rankCourseInsights([course("pmp", 8, 20, 40)]);
  assert.equal(best?.key, "pmp");
  assert.equal(needsSupport, null);
}
{
  // Two decided courses both at zero: the larger cohort is the bigger problem.
  const { best, needsSupport } = rankCourseInsights([
    course("pmp", 0, 20, 30),
    course("cfm", 0, 14, 21),
  ]);
  assert.equal(best, null);
  assert.equal(needsSupport?.key, "pmp");
}

/* --- samples too small to say anything ------------------------------------- */
{
  const { best, needsSupport, bestReason, needsSupportReason } = rankCourseInsights([
    course("pmp", 2, 2, 4),
    course("cfm", 0, 3, 9),
  ]);
  assert.equal(best, null);
  assert.equal(needsSupport, null);
  assert.equal(bestReason, "no_sample");
  assert.equal(needsSupportReason, "no_sample");
}

assert.deepEqual(rankCourseInsights([]), {
  best: null,
  needsSupport: null,
  bestReason: "no_sample",
  needsSupportReason: "no_sample",
});

console.log("course insight tests passed.");
