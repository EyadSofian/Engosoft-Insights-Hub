/**
 * Media buyer ownership, from Engosoft's campaign naming convention.
 *
 * Campaign names carry the buyer's token, for example `cfm-13/9/36-sayed-land`
 * or `Automotive - Riyadh - 4/7/26 - CBO - sh`: `SAYED` is Sayed and `SH` is
 * Shazly. A name carrying both tokens is ambiguous and belongs to neither. This
 * is the default rule the Media Buyers dashboard uses. Engosoft explicitly
 * assigned Automotive, BIM and CMRP to Shazly regardless of an old SAYED tag.
 * Attribution applies only to a campaign already identified by provider
 * evidence, never to a guessed campaign.
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

/** Explicit course ownership wins over legacy buyer tokens in campaign names. */
export function mediaBuyerForCampaign(
  course: string,
  campaignName: string,
): MediaBuyerId | "ambiguous" | null {
  const normalizedCourse = course.trim().toLocaleLowerCase("en");
  if (["auto", "automotive", "bim", "cmrp"].includes(normalizedCourse)) return "shazly";
  return mediaBuyerOf(campaignName);
}

/** The buyer's display name for an exact campaign name, or "" when none or ambiguous. */
export function mediaBuyerNameForCampaign(campaignName: string): string {
  const buyer = mediaBuyerOf(campaignName);
  return buyer && buyer !== "ambiguous" ? MEDIA_BUYERS[buyer].name : "";
}

/** The figures a buyer's ROAS is built from. */
export interface BuyerReturn {
  /** Spend inside the window: the buyer's managed spend. */
  spend: number;
  revenue: number;
  /** Campaigns paid inside the window that spent nothing in it. */
  delayedCampaigns: number;
  delayedRevenue: number;
  /** What those campaigns spent before the window. */
  earlierSpend: number;
  /** Delayed revenue whose campaign has no recorded spend in any window. */
  uncostedRevenue: number;
  roasRevenue: number;
  roasSpend: number;
  roas: number | null;
}

/**
 * A buyer's return on spend, crediting delayed revenue with its own cost.
 *
 * A campaign can stop spending and keep collecting: an invoice paid inside the
 * window may come from a campaign whose last spend is weeks older. That revenue
 * is credited to the campaign's buyer, so the campaign's earlier spend joins
 * the denominator. Dividing it by window spend alone priced it at zero and
 * made a buyer's return read far higher than any campaign earned.
 *
 * Revenue from a campaign with no recorded spend anywhere (an organic-named
 * campaign, or spend older than the ad feeds reach) cannot be priced. It stays
 * in `revenue` and is reported as `uncostedRevenue`, but it is not divided by
 * somebody else's spend.
 */
export function buyerReturn(
  rows: ReadonlyArray<{ key: string; spend: number; revenue: number }>,
  earlierSpendByKey: ReadonlyMap<string, number>,
): BuyerReturn {
  let spend = 0;
  let revenue = 0;
  let delayedCampaigns = 0;
  let delayedRevenue = 0;
  let earlierSpend = 0;
  let uncostedRevenue = 0;
  for (const row of rows) {
    spend += row.spend;
    revenue += row.revenue;
    if (row.spend > 0 || row.revenue <= 0) continue;
    const earlier = earlierSpendByKey.get(row.key) ?? 0;
    delayedCampaigns++;
    delayedRevenue += row.revenue;
    if (earlier > 0) earlierSpend += earlier;
    else uncostedRevenue += row.revenue;
  }
  const roasRevenue = revenue - uncostedRevenue;
  const roasSpend = spend + earlierSpend;
  return {
    spend,
    revenue,
    delayedCampaigns,
    delayedRevenue,
    earlierSpend,
    uncostedRevenue,
    roasRevenue,
    roasSpend,
    roas: roasSpend > 0 ? roasRevenue / roasSpend : null,
  };
}

/** True for a campaign paid inside the window that spent nothing in it. */
export function isDelayedRevenueRow(row: { spend: number; revenue: number }): boolean {
  return row.spend <= 0 && row.revenue > 0;
}
