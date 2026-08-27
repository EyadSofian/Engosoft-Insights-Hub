export type CampaignReturnBand = "loss" | "breakeven" | "positive" | "strong" | "unrated";

/**
 * A deliberately small, visible decision scale based on the numbers shown in
 * the campaign row. Break-even gets a narrow 10% tolerance above cost; below
 * cost is always a loss, while exactly 2x remains in the yellow band.
 */
export function campaignReturnBand(spend: number, revenue: number): CampaignReturnBand {
  if (!Number.isFinite(spend) || !Number.isFinite(revenue) || spend <= 0) return "unrated";
  if (revenue < spend) return "loss";

  const ratio = revenue / spend;
  if (ratio <= 1.1) return "breakeven";
  if (ratio <= 2) return "positive";
  return "strong";
}

export const CAMPAIGN_RETURN_COLOR: Record<Exclude<CampaignReturnBand, "unrated">, string> = {
  loss: "var(--danger)",
  breakeven: "var(--accent)",
  positive: "#d6a400",
  strong: "var(--success)",
};
