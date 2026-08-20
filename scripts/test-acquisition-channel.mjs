import assert from "node:assert/strict";
import {
  acquisitionChannel,
  isOrganicSourceKey,
  PLATFORM_SOURCE_KEYS,
} from "../src/lib/acquisition-channel.ts";
import { ACQUISITION_CHANNEL_LABEL, ACQUISITION_CHANNELS } from "../src/lib/constants.ts";

assert.deepEqual(
  ACQUISITION_CHANNELS,
  ["organic", "meta", "snapchat", "tiktok", "google"],
  "Organic must remain the first visible channel after All on narrow screens",
);
assert.match(
  ACQUISITION_CHANNEL_LABEL.organic.ar,
  /Odoo/,
  "the Organic label must make its Odoo source explicit",
);

for (const source of [
  "website",
  "uchat",
  "whatsapp broadcast",
  "recommended from customer",
  "recommendation sales",
  "phone call",
  "company page",
  "cfm landing page",
  "webinar",
  "e-mail",
  "chatgpt.com",
]) {
  assert.equal(isOrganicSourceKey(source), true, `${source} should be Organic`);
}

for (const source of [
  "",
  ...Object.values(PLATFORM_SOURCE_KEYS).flat(),
  "ads",
  "paid",
  "paid ads",
  "cpc",
  "ppc",
  "sem",
]) {
  assert.equal(isOrganicSourceKey(source), false, `${source || "blank"} should not be Organic`);
}

assert.equal(isOrganicSourceKey("  Website  "), true, "source matching ignores outer whitespace");
assert.equal(isOrganicSourceKey("FACEBOOK"), false, "paid matching ignores case");
assert.equal(acquisitionChannel({ platform: "meta" }), "meta");
assert.equal(acquisitionChannel({ channel: "organic" }), "organic");
assert.equal(
  acquisitionChannel({ platform: "meta", channel: "organic" }),
  "organic",
  "the explicit Organic channel wins over stale platform state",
);

console.log("acquisition channel tests passed");
