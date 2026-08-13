import assert from "node:assert/strict";
import { accountingUsdPaid } from "../src/lib/fx-rates.ts";

const row = {
  currency: "EGP",
  totalInCurrency: 5050,
  usdPaid: 90,
  reportingUsdLocked: false,
};
assert.equal(accountingUsdPaid(row, { EGP: 50.5, SAR: 3.7453 }), 100);
assert.equal(accountingUsdPaid({ ...row, reportingUsdLocked: true }, { EGP: 40, SAR: 3.5 }), 90);
console.log("FX lock tests passed.");
