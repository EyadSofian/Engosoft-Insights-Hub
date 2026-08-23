import assert from "node:assert/strict";
import {
  completedWeekendWindow,
  isWeekendDate,
  weekendBudgetDecision,
  weekendDayKey,
  weekStart,
} from "../src/lib/weekend-analysis.ts";

assert.deepEqual(completedWeekendWindow("2026-08-23"), {
  from: "2026-06-28",
  to: "2026-08-22",
  weeks: 8,
  weekendDays: 24,
  comparisonDays: 32,
});
assert.equal(weekendDayKey("2026-08-20"), "thursday");
assert.equal(weekendDayKey("2026-08-21"), "friday");
assert.equal(weekendDayKey("2026-08-22"), "saturday");
assert.equal(isWeekendDate("2026-08-19"), false);
assert.equal(weekStart("2026-08-22"), "2026-08-16");

const baseline = {
  spend: 1_000,
  leads: 100,
  won: 10,
  lost: 20,
  cpl: 10,
  salesRate: 10,
  lostRate: 20,
};
assert.equal(
  weekendBudgetDecision({ ...baseline, cpl: 10.5, salesRate: 9, lostRate: 22 }, baseline, {
    lostAvailable: true,
    hasSpendData: true,
  }),
  "full",
);
assert.equal(
  weekendBudgetDecision({ ...baseline, cpl: 14, salesRate: 5, lostRate: 28 }, baseline, {
    lostAvailable: true,
    hasSpendData: true,
  }),
  "reduce",
);
const weakQualityBaseline = { ...baseline, cpl: 10, salesRate: 1, lostRate: 46 };
assert.equal(
  weekendBudgetDecision({ ...weakQualityBaseline, cpl: 6, salesRate: 1.5, lostRate: 45 }, weakQualityBaseline, {
    lostAvailable: true,
    hasSpendData: true,
  }),
  "reallocate",
);
assert.equal(
  weekendBudgetDecision({ ...baseline, leads: 12 }, baseline, {
    lostAvailable: true,
    hasSpendData: true,
  }),
  "insufficient",
);

console.log("Weekend analysis tests passed");
