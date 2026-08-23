import assert from "node:assert/strict";
import {
  isOperationalStateCurrent,
  OPERATIONAL_STATE_MAX_AGE_MS,
} from "../src/lib/campaign-status-policy.ts";

const NOW = Date.parse("2026-08-20T11:00:00Z");
const base = {
  platform: "meta",
  accountId: "account",
  account: "Account",
  accountTimezone: "Africa/Cairo",
  campaignId: "campaign",
  campaignKey: "id:campaign",
  name: "Campaign",
  configuredStatus: "ACTIVE",
  effectiveStatus: "ACTIVE",
  servingStatus: "ELIGIBLE",
  statusReason: "",
  startTime: "2026-08-01T00:00:00Z",
  stopTime: "",
  updatedTime: "",
  activeAdsets: 1,
  activeAds: 1,
  spend24h: 10,
  impressions24h: 100,
  clicks24h: 5,
  platformLeads24h: 0,
  deliveryState: "active",
  checkedAt: "2026-08-20T10:55:00Z",
  source: "n8n_live",
};

assert.equal(isOperationalStateCurrent(base, NOW), true, "fresh live Meta campaign is active");
assert.equal(
  isOperationalStateCurrent({ ...base, effectiveStatus: "PAUSED" }, NOW),
  false,
  "paused campaign never enters the popup",
);
assert.equal(
  isOperationalStateCurrent({ ...base, activeAds: 0 }, NOW),
  false,
  "Meta campaign with no active ad is not running",
);
assert.equal(
  isOperationalStateCurrent({ ...base, stopTime: "2026-08-20T10:30:00Z" }, NOW),
  false,
  "ended campaign is excluded",
);
assert.equal(
  isOperationalStateCurrent({ ...base, checkedAt: "2026-08-20T10:39:59Z" }, NOW),
  false,
  "stale backup cannot resurrect a closed campaign",
);

const google = {
  ...base,
  platform: "google",
  configuredStatus: "ENABLED",
  effectiveStatus: "ELIGIBLE",
  servingStatus: "SERVING",
  activeAdsets: 0,
  activeAds: 0,
  source: "platform_direct",
};
assert.equal(isOperationalStateCurrent(google, NOW), true);
assert.equal(
  isOperationalStateCurrent({ ...google, effectiveStatus: "ENDED", servingStatus: "ENDED" }, NOW),
  false,
  "an enabled-but-ended Google campaign is not Active",
);

const snapchat = {
  ...base,
  platform: "snapchat",
  servingStatus: "LIMITED",
  activeAdsets: 0,
  activeAds: 0,
};
assert.equal(
  isOperationalStateCurrent(snapchat, NOW),
  false,
  "Snapchat must be delivering, not merely configured Active",
);

const tiktok = {
  ...base,
  platform: "tiktok",
  configuredStatus: "ENABLE",
  effectiveStatus: "CAMPAIGN_STATUS_ENABLE",
  servingStatus: "SERVING",
  // The current TikTok collector reports campaign status directly and does not
  // populate Meta-style child counts. That must not hide five live campaigns.
  activeAdsets: 0,
  activeAds: 0,
};
assert.equal(
  isOperationalStateCurrent(tiktok, NOW),
  true,
  "TikTok ENABLE + CAMPAIGN_STATUS_ENABLE is operational even without child counters",
);

assert.equal(OPERATIONAL_STATE_MAX_AGE_MS, 20 * 60 * 1000);
process.stdout.write("campaign status policy tests passed\n");
