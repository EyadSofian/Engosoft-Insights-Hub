import assert from "node:assert/strict";
import { hasReportableLost, usesStoredLost } from "../src/lib/lost-authority.ts";

assert.equal(hasReportableLost("odoo-direct"), true);
assert.equal(hasReportableLost("postgres-last-good"), true);
assert.equal(hasReportableLost("unavailable"), false);

assert.equal(usesStoredLost("odoo-direct"), false);
assert.equal(usesStoredLost("postgres-last-good"), true);
assert.equal(usesStoredLost("unavailable"), false);

console.log("Lost authority tests passed");
