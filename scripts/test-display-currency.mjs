import assert from "node:assert/strict";
import { formatDisplayMoney, usdToDisplayCurrency } from "../src/lib/display-currency.ts";

assert.equal(usdToDisplayCurrency(100, "USD", 3.7453), 100);
assert.equal(usdToDisplayCurrency(100, "SAR", 3.7453), 374.53);
assert.equal(usdToDisplayCurrency(null, "SAR", 3.7453), null);
assert.equal(usdToDisplayCurrency(100, "SAR", 0), null);

assert.equal(formatDisplayMoney(510.5, "USD", "ar", true), "$510.5");
assert.equal(formatDisplayMoney(1912.18265, "SAR", "ar", true), "1,912.18 ر.س");
assert.equal(formatDisplayMoney(109_000, "SAR", "ar"), "109K ر.س");
assert.equal(formatDisplayMoney(109_000, "SAR", "en"), "SAR 109K");

console.log("display currency tests passed");
