import type { CampaignOperationalState } from "./types";

/**
 * Risk alerts are decisions, not historical reporting. If the last platform
 * check is older than this, silence the alert instead of accusing a campaign
 * that may already have been paused or ended.
 */
export const OPERATIONAL_STATE_MAX_AGE_MS = 20 * 60 * 1000;

const upper = (value: string): string => value.trim().toUpperCase();

function scheduleIsCurrent(state: CampaignOperationalState, now: number): boolean {
  const parse = (value: string, endOfDay: boolean): number => {
    if (!value) return Number.NaN;
    const candidate = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T${endOfDay ? "23:59:59" : "00:00:00"}Z`
      : value;
    return Date.parse(candidate);
  };
  const start = parse(state.startTime, false);
  const stop = parse(state.stopTime, true);
  return (!Number.isFinite(start) || start <= now) && (!Number.isFinite(stop) || stop >= now);
}

/**
 * Strict current-delivery policy shared by the popup and campaign workspace.
 * A configured switch by itself is insufficient: ended Google campaigns,
 * non-delivering Snapchat campaigns, and Meta campaigns without live children
 * are not operationally Active.
 */
export function isOperationalStateCurrent(
  state: CampaignOperationalState,
  now = Date.now(),
  maxAgeMs = OPERATIONAL_STATE_MAX_AGE_MS,
): boolean {
  if (state.deliveryState !== "active" || !scheduleIsCurrent(state, now)) return false;

  const checkedAt = Date.parse(state.checkedAt);
  if (!Number.isFinite(checkedAt)) return false;
  // Permit modest clock skew, but never a timestamp suspiciously far ahead.
  if (checkedAt > now + 5 * 60 * 1000 || now - checkedAt > maxAgeMs) return false;

  const configured = upper(state.configuredStatus);
  const effective = upper(state.effectiveStatus);
  const serving = upper(state.servingStatus);

  switch (state.platform) {
    case "meta":
      return (
        configured === "ACTIVE" &&
        effective === "ACTIVE" &&
        state.activeAdsets > 0 &&
        state.activeAds > 0
      );
    case "snapchat":
      return configured === "ACTIVE" && (!serving || serving === "SERVING");
    case "tiktok":
      return (
        configured === "ENABLE" &&
        (!effective || effective === "ENABLE" || effective === "CAMPAIGN_STATUS_ENABLE")
      );
    case "google":
      return (
        configured === "ENABLED" &&
        (serving === "SERVING" || (!serving && !["ENDED", "PAUSED", "REMOVED"].includes(effective)))
      );
  }
}
