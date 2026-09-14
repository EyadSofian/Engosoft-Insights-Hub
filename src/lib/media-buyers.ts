/**
 * Media buyer ownership, from Engosoft's campaign naming convention.
 *
 * Campaign names carry the buyer's token, for example `cfm-13/9/36-sayed-land`
 * or `Automotive - Riyadh - 4/7/26 - CBO - sh`: `SAYED` is Sayed and `SH` is
 * Shazly. A name carrying both tokens is ambiguous and belongs to neither. This
 * is the rule the Media Buyers dashboard uses. Attribution applies it only to a
 * campaign that exact provider evidence already identified, never to a guess.
 */

export type MediaBuyerId = "sayed" | "shazly";

export const MEDIA_BUYERS: Record<MediaBuyerId, { name: string; token: string }> = {
  sayed: { name: "Sayed", token: "SAYED" },
  shazly: { name: "Shazly", token: "SH" },
};

export function mediaBuyerOf(name: string): MediaBuyerId | "ambiguous" | null {
  const sayed = /(^|[^a-z0-9])sayed([^a-z0-9]|$)/i.test(name);
  const shazly = /(^|[^a-z0-9])sh([^a-z0-9]|$)/i.test(name);
  if (sayed && shazly) return "ambiguous";
  if (sayed) return "sayed";
  if (shazly) return "shazly";
  return null;
}

/** The buyer's display name for an exact campaign name, or "" when none or ambiguous. */
export function mediaBuyerNameForCampaign(campaignName: string): string {
  const buyer = mediaBuyerOf(campaignName);
  return buyer && buyer !== "ambiguous" ? MEDIA_BUYERS[buyer].name : "";
}
