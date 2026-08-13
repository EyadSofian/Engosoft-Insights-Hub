import assert from "node:assert/strict";
import {
  legacyAdCourseValue,
  legacyAdLeadValue,
  legacyAdPlatform,
  lockedLegacyAccountingUsd,
} from "../src/lib/legacy-datasets.ts";

assert.equal(legacyAdPlatform({ Platform: "Meta Ads" }), "meta");
assert.equal(legacyAdPlatform({ __platform: "Snapchat" }), "snapchat");
assert.equal(legacyAdPlatform({ المنصة: "تيك توك" }), "tiktok");
assert.equal(legacyAdPlatform({ Platform: "Unknown" }), null);

const misleadingTikTok = { "On-Facebook leads": "999", Leads: "42" };
assert.equal(legacyAdLeadValue(misleadingTikTok, "tiktok"), null);
assert.equal(legacyAdLeadValue({ "Leads (on facebook Leads)": "7" }, "meta"), "7");
assert.equal(legacyAdLeadValue({ "Leads (Native)": "5" }, "snapchat"), "5");
assert.equal(legacyAdCourseValue({ "Modified Course": "PMP" }), "PMP");
assert.equal(legacyAdCourseValue({ Course: "CFM" }), "CFM");

assert.equal(lockedLegacyAccountingUsd({ __source_usd_locked: "123.45" }), "123.45");
assert.equal(lockedLegacyAccountingUsd({ "$ Sales": "98.7" }), "98.7");
assert.equal(lockedLegacyAccountingUsd({ "Total in Currency": "5000", Currency: "EGP" }), "");

console.log("Legacy dataset semantic guards passed.");
