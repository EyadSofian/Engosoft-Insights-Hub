import assert from "node:assert/strict";
import {
  isWebsiteCampaignName,
  isWebsiteConversionCampaignName,
  isWebinarCampaignName,
  paidCampaignPurpose,
} from "../src/lib/campaign-purpose.ts";

for (const name of [
  "web-signup-1/7",
  "web-con-all-1/7/26-sa",
  "web-con",
  "con-web-shop",
  "Traffic-all-web-20/7/26",
])
  assert.equal(isWebsiteCampaignName(name), true, name);

assert.equal(isWebsiteConversionCampaignName("web-con-all-1/7/26-sa"), true);
assert.equal(isWebsiteConversionCampaignName("web-signup-1/7"), false);
assert.equal(isWebinarCampaignName("CMRP-WEBINAR-20/8/26-lp"), true);
assert.equal(isWebsiteCampaignName("CMRP-WEBINAR-20/8/26-lp"), false);
assert.equal(paidCampaignPurpose("INTERIOR-webinar-30/7/26"), "webinar");
assert.equal(paidCampaignPurpose("web-con"), "website");
assert.equal(paidCampaignPurpose("PMP-1/7/26-sayed"), "other");

process.stdout.write("campaign purpose tests passed\n");
