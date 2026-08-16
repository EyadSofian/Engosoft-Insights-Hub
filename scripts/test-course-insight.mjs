import assert from "node:assert/strict";
import { rankCourseInsights } from "../src/lib/course-insight.ts";

const course = (key, won, lost, leads) => ({
  key,
  won,
  lost,
  leads,
  conversionRate: leads > 0 ? (won / leads) * 100 : null,
});

// Every label the company has ever invoiced. "management" is deliberately not
// here: 1,549 leads and 0 invoices across the whole history.
const SELLABLE = new Set(["cfm", "pmp", "bim", "interior", "elec", "mech"]);

/* --- a label the company never sells is not anyone's weak course ----------- */
// Reported: an employee shown as strong in PMP and needing support in
// "Management" — which is project management, so the two read as a
// contradiction. In the data they are different Odoo labels, and Management is
// a lead pile with no product behind it at all.
{
  const withPile = [
    course("pmp", 2, 0, 10), // real course, real win
    course("management", 0, 8, 12), // 67% decided, $0 ever, not a course
  ];

  const naive = rankCourseInsights(withPile);
  assert.equal(naive.needsSupport?.key, "management", "without the filter it is picked");

  const { best, needsSupport, unsellable, needsSupportReason } = rankCourseInsights(
    withPile,
    SELLABLE,
  );
  assert.equal(best?.key, "pmp");
  assert.equal(needsSupport, null, "an unsellable pile is never the weak course");
  assert.equal(needsSupportReason, "cohort_still_open");
  assert.deepEqual(
    unsellable.map((c) => c.key),
    ["management"],
    "it is reported instead of hidden",
  );
}

// A small pile is not worth naming either way.
{
  const { unsellable } = rankCourseInsights([course("management", 0, 3, 4)], SELLABLE);
  assert.deepEqual(unsellable, []);
}

// With no sellable set supplied, nothing is filtered — the old behaviour.
{
  const { unsellable } = rankCourseInsights([course("management", 0, 8, 12)]);
  assert.deepEqual(unsellable, []);
}

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
  const { best, needsSupport, bestReason, unsellable } = rankCourseInsights(sherif, SELLABLE);
  assert.equal(
    best?.key,
    "pmp",
    "a course with real wins must not be hidden by a decided-count gate",
  );
  assert.equal(bestReason, "");
  // The first rule named CFM — the course he sells most of. The second named
  // Management, which sells nothing anywhere. Neither is a coaching signal, so
  // with his real cohorts no course is weak enough to name.
  assert.notEqual(needsSupport?.key, "cfm");
  assert.notEqual(needsSupport?.key, "management");
  assert.deepEqual(
    unsellable.map((c) => c.key),
    ["management"],
  );
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
  unsellable: [],
});

console.log("course insight tests passed.");
