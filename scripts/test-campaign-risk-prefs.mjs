import assert from "node:assert/strict";
import { pendingRiskRows, suppressedRiskCount } from "../src/lib/campaign-risk-prefs.ts";

const rows = [{ key: "a" }, { key: "b" }, { key: "c" }];
const now = Date.parse("2026-08-20T00:00:00Z");
const prefs = {
  mutedKeys: ["a"],
  snoozeUntil: 0,
  snoozedKeys: [],
  reviewedUntil: { b: now + 1_000, c: now - 1 },
  restoredAt: 0,
};

assert.deepEqual(
  pendingRiskRows(rows, prefs, now).map((row) => row.key),
  ["c"],
);
assert.equal(suppressedRiskCount(rows, prefs, now), 2);
assert.deepEqual(
  pendingRiskRows(rows, prefs, now + 2_000).map((row) => row.key),
  ["b", "c"],
);

console.log("campaign review preference tests passed");
