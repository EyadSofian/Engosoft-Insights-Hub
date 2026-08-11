import assert from "node:assert/strict";
import {
  authoritativeAccountingUsd,
  directAccountingPassesCompletenessGate,
} from "../src/lib/accounting-authority.ts";

assert.equal(
  authoritativeAccountingUsd({ "$ Sales": "123.45", "USD Paid": "119.90" }),
  "123.45",
  "n8n $ Sales must beat static-rate USD Paid",
);
assert.equal(authoritativeAccountingUsd({ "USD Paid": "119.90" }), "119.90");
assert.equal(authoritativeAccountingUsd({ "$ Sales": 0, "USD Paid": 15 }), "0");

const complete = {
  directRows: 6_448,
  directMoves: 2_024,
  directRevenue: 744_657.77,
  missingCurrencyRate: 0,
  referenceRows: 6_448,
  referenceMoves: 2_024,
  referenceRevenue: 744_657.77,
};

assert.equal(directAccountingPassesCompletenessGate(complete), true);
assert.equal(
  directAccountingPassesCompletenessGate({
    ...complete,
    directRows: 6,
    directMoves: 6,
    directRevenue: 1_100,
  }),
  false,
  "a partial direct response must never replace PostgreSQL",
);
assert.equal(
  directAccountingPassesCompletenessGate({ ...complete, directRevenue: 740_168.33 }),
  false,
  "a differently re-rated direct response must never replace authoritative revenue",
);
assert.equal(
  directAccountingPassesCompletenessGate({
    ...complete,
    referenceRows: 0,
    referenceMoves: 0,
    referenceRevenue: 0,
  }),
  true,
  "a valid direct read may bootstrap when no reference exists",
);
assert.equal(
  directAccountingPassesCompletenessGate({ ...complete, missingCurrencyRate: 1 }),
  false,
);

console.log("accounting authority tests passed");
