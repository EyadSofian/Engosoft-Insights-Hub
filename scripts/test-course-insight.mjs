import assert from "node:assert/strict";
import { rankCourseInsights } from "../src/lib/course-insight.ts";

const course = (key, won, leads, sampleStatus = "reliable") => ({
  key,
  won,
  leads,
  conversionRate: leads > 0 ? (won / leads) * 100 : null,
  sampleStatus,
});

/* --- the reported case ----------------------------------------------------- */
// One employee, one judgeable course: CFM with 21 leads and no win at all.
// This used to report CFM as "best conversion 0.0%" while "needs support" read
// "not enough sample" — the two cards inverted.
{
  const { best, needsSupport } = rankCourseInsights([
    course("cfm", 0, 21),
    course("bim", 1, 3, "insufficient"),
  ]);
  assert.equal(best, null, "a course with no win is never the best conversion");
  assert.equal(needsSupport?.key, "cfm", "a single losing course must still be flagged");
}

/* --- ordinary cases still behave ------------------------------------------- */
{
  const { best, needsSupport } = rankCourseInsights([
    course("pmp", 8, 40), // 20%
    course("cfm", 3, 60), // 5%
  ]);
  assert.equal(best?.key, "pmp");
  assert.equal(needsSupport?.key, "cfm");
}

// A single healthy course is the best one and needs no support flag.
{
  const { best, needsSupport } = rankCourseInsights([course("pmp", 8, 40)]);
  assert.equal(best?.key, "pmp");
  assert.equal(needsSupport, null, "the only course cannot be both best and weakest");
}

// Every reliable course at zero: nothing is "best", the weakest is still named.
{
  const { best, needsSupport } = rankCourseInsights([course("pmp", 0, 30), course("cfm", 0, 21)]);
  assert.equal(best, null);
  assert.equal(needsSupport?.key, "pmp", "ties break on lead count, largest sample last");
}

// Nothing judgeable at all: both cards stay empty rather than guessing.
{
  const { best, needsSupport } = rankCourseInsights([
    course("pmp", 2, 4, "insufficient"),
    course("cfm", 0, 3, "insufficient"),
  ]);
  assert.equal(best, null);
  assert.equal(needsSupport, null);
}

assert.deepEqual(rankCourseInsights([]), { best: null, needsSupport: null });

console.log("course insight tests passed.");
