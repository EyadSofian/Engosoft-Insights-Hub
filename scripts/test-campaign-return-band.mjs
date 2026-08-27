import assert from "node:assert/strict";
import { campaignReturnBand } from "../src/lib/campaign-return-band.ts";

assert.equal(campaignReturnBand(1_809, 3_569), "positive", "1.97x must stay yellow");
assert.equal(campaignReturnBand(1_716, 7_697), "strong", "returns above 2x must be green");
assert.equal(campaignReturnBand(891, 629), "loss", "spend above revenue must be red");
assert.equal(campaignReturnBand(448, 0), "loss", "zero revenue with spend must be red");
assert.equal(campaignReturnBand(1_000, 1_050), "breakeven", "near break-even must be orange");
assert.equal(campaignReturnBand(1_000, 2_000), "positive", "exactly 2x stays yellow");
assert.equal(campaignReturnBand(1_000, 2_001), "strong", "above 2x turns green");
assert.equal(campaignReturnBand(0, 500), "unrated", "zero spend cannot produce a return band");

console.log("campaign return band tests passed");
