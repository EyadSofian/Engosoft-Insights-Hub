import assert from "node:assert/strict";
import { DEFAULT_DATE_PRESET, defaultReportingMonth } from "../src/lib/reporting-window.ts";

const latest = "2026-08-28";
const expected = { from: "2026-08-01", to: latest };

assert.equal(DEFAULT_DATE_PRESET, "month", "the dashboard opens on This month");
assert.deepEqual(defaultReportingMonth(latest), expected, "server default follows the same month");

console.log("default period tests passed.");
