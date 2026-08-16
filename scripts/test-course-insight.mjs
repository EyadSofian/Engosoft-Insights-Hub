import assert from "node:assert/strict";
import { isSoldCourse, rankCourseInsights } from "../src/lib/course-insight.ts";

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

/* --- the profile shape this rule was rewritten for ------------------------- */
// Modelled on Bahaa Ramdan, August 2026. The figures the screen actually
// reported are exact: CFM $3,797.09 (57.8% of his sales), Interior $480.67 on
// one invoice, PMP 20% on 2 Won of 10 leads, Management 0% on 8 decided of 12.
// Invoice counts, the CFM cohort split, and the BIM row are representative
// rather than read from production — they exercise the rule, they are not a
// record of his month.
const bahaa = [
  course("cfm", 0, 6, 22, 3797.09, 9), //  his biggest seller, cohort still open
  course("pmp", 2, 0, 10, 1_100, 2), //   his only converting course
  course("interior", 0, 2, 27, 480.67, 1),
  course("bim", 0, 4, 17), //             leads only, never sold
  course("management", 0, 8, 12), //      leads only, never sold, cohort decided
  course("elec", 0, 0, 1),
];
{
  const { best, needsSupport, bestReason, needsSupportReason } = rankCourseInsights(bahaa);
  assert.equal(best?.key, "pmp", "a course with real wins must not be hidden by a decided gate");
  assert.equal(bestReason, "");
  // The whole point of the rewrite: Management is 0% on a fully decided cohort,
  // but he has never sold a seat of it. Twelve leads were routed to a rep who
  // sells CFM and PMP; that is a routing fact, not a verdict on him.
  assert.notEqual(
    needsSupport?.key,
    "management",
    "a course he has never sold can never be his weakness",
  );
  assert.equal(needsSupport, null);
  assert.equal(
    needsSupportReason,
    "cohort_still_open",
    "nothing he sells has a decided cohort yet, so the honest answer is 'too early'",
  );
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

/* --- a cohort still in play is neither strength nor weakness --------------- */
{
  // 22 leads, 6 decided (27%), all lost — too early to call it a failure.
  const { best, needsSupport, needsSupportReason } = rankCourseInsights([
    course("cfm", 0, 6, 22, 3_130, 8),
  ]);
  assert.equal(best, null);
  assert.equal(needsSupport, null);
  assert.equal(needsSupportReason, "cohort_still_open");
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
