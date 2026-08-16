import assert from "node:assert/strict";
import {
  MIN_DECIDED_OUTCOMES,
  isSoldCourse,
  rankCourseInsights,
} from "../src/lib/course-insight.ts";

/** `revenue` and `invoices` default to a course he has never sold. */
const course = (key, won, lost, leads, revenue = 0, invoices = 0) => ({
  key,
  won,
  lost,
  leads,
  paidRevenue: revenue,
  invoices,
  conversionRate: leads > 0 ? (won / leads) * 100 : null,
});

/* --- the profile this rule was rewritten for ------------------------------- */
// Sherif Waleed, August 2026, read from production on the 16th. Every figure
// below is his, including the invoice counts.
const sherif = [
  course("cfm", 0, 6, 22, 3797.09, 7), //   his biggest seller
  course("pmp", 2, 0, 10, 1440.93, 7), //   his only converting course
  course("bim", 0, 6, 17, 854.49, 3),
  course("interior", 0, 6, 27, 480.67, 1), // most leads, none won
  course("management", 0, 8, 12), //        never sold — routed, not his
  course("elec", 0, 1, 3), //               never sold, and too small anyway
];
{
  const { best, needsSupport, bestReason, needsSupportReason } = rankCourseInsights(sherif);
  assert.equal(best?.key, "pmp", "a course with real wins must not be hidden by a decided gate");
  assert.equal(bestReason, "");

  // Management is 0% on the most settled cohort he has, but he has never sold a
  // seat of it: twelve leads routed to a rep who sells CFM, PMP, BIM, Interior.
  assert.notEqual(needsSupport?.key, "management", "a course he never sold is never his weakness");

  // Among the courses he does sell, three sit at 0% with six settled leads
  // each. The tie goes to the biggest pile, which is where the loss is largest.
  assert.equal(needsSupport?.key, "interior");
  assert.equal(needsSupport.leads, 27);
  assert.equal(needsSupportReason, "");
}

/* --- but a course he does sell is still judged, once decided --------------- */
{
  // Same shape as CFM above, with the cohort now decided and losing.
  const { needsSupport, needsSupportReason } = rankCourseInsights([
    course("cfm", 0, 14, 22, 3_130, 8),
    course("pmp", 2, 0, 10, 1_100, 2),
  ]);
  assert.equal(needsSupport?.key, "cfm", "his own book is still held to account");
  assert.equal(needsSupportReason, "");
}

/* --- how many settled leads before a course can be called weak ------------- */
{
  // Four settled outcomes is still chance, whatever the cohort size.
  const thin = rankCourseInsights([course("cfm", 0, 4, 22, 3_130, 8)]);
  assert.equal(thin.needsSupport, null);
  assert.equal(thin.needsSupportReason, "too_few_decided");

  // One more, and the same course is judgeable — the open leads behind it are
  // not held against him, they are simply not counted yet.
  const enough = rankCourseInsights([course("cfm", 0, MIN_DECIDED_OUTCOMES, 22, 3_130, 8)]);
  assert.equal(enough.needsSupport?.key, "cfm");
  assert.equal(enough.needsSupportReason, "");
}

/* --- a course with no win is never the strength ---------------------------- */
{
  const { best, bestReason, needsSupport } = rankCourseInsights([
    course("cfm", 0, 20, 30, 3_130, 8),
  ]);
  assert.equal(best, null, "0% can never be the best conversion");
  assert.equal(bestReason, "no_win_yet");
  assert.equal(needsSupport?.key, "cfm", "a single losing course he sells must still be flagged");
}

/* --- what counts as "sold" ------------------------------------------------- */
{
  assert.equal(isSoldCourse(course("a", 0, 0, 5)), false, "leads alone are not a sale");
  assert.equal(isSoldCourse(course("b", 0, 0, 5, 900)), true, "collected money is a sale");
  assert.equal(isSoldCourse(course("c", 0, 0, 5, 0, 2)), true, "an invoice is a sale");
  // Collections are dated by payment, so a deal closed this window may not have
  // been paid yet. The win keeps it inside his book.
  assert.equal(isSoldCourse(course("d", 1, 0, 5)), true, "a win counts before the money lands");
  // A refund is still a seat he sold, and must not silently leave his book.
  assert.equal(isSoldCourse(course("e", 0, 0, 5, -400)), true, "a credit note is still his");
}

/* --- a rep with no sales at all is reported as such, not as a small sample -- */
{
  const { best, needsSupport, bestReason, needsSupportReason } = rankCourseInsights([
    course("management", 0, 8, 12),
    course("bim", 0, 4, 17),
  ]);
  assert.equal(best, null);
  assert.equal(needsSupport, null);
  assert.equal(bestReason, "no_book");
  assert.equal(needsSupportReason, "no_book");
}

/* --- ordinary cases -------------------------------------------------------- */
{
  const { best, needsSupport } = rankCourseInsights([
    course("pmp", 8, 20, 40, 9_000, 8), // 20%, 70% decided
    course("cfm", 3, 45, 60, 4_000, 3), // 5%,  80% decided
  ]);
  assert.equal(best?.key, "pmp");
  assert.equal(needsSupport?.key, "cfm");
}
{
  // The only course cannot be both the strength and the weakness.
  const { best, needsSupport } = rankCourseInsights([course("pmp", 8, 20, 40, 9_000, 8)]);
  assert.equal(best?.key, "pmp");
  assert.equal(needsSupport, null);
}
{
  // Two decided courses both at zero: the larger cohort is the bigger problem.
  const { best, needsSupport } = rankCourseInsights([
    course("pmp", 0, 20, 30, 5_000, 4),
    course("cfm", 0, 14, 21, 2_000, 2),
  ]);
  assert.equal(best, null);
  assert.equal(needsSupport?.key, "pmp");
}

/* --- samples too small to say anything ------------------------------------- */
{
  const { best, needsSupport, bestReason, needsSupportReason } = rankCourseInsights([
    course("pmp", 2, 2, 4, 900, 2),
    course("cfm", 0, 3, 9, 400, 1),
  ]);
  assert.equal(best, null);
  assert.equal(needsSupport, null);
  assert.equal(bestReason, "no_sample");
  assert.equal(needsSupportReason, "no_sample");
}

assert.deepEqual(rankCourseInsights([]), {
  best: null,
  needsSupport: null,
  bestReason: "no_book",
  needsSupportReason: "no_book",
});

console.log("course insight tests passed.");
