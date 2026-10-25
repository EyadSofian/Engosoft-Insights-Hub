/**
 * Pure rules behind the acquisition performance view, shared by the server
 * query and its tests.
 */

export const PERFORMANCE_GRAINS = ["campaign", "adset", "ad", "creative"] as const;
export type PerformanceGrain = (typeof PERFORMANCE_GRAINS)[number];

export type ConfidenceBucket = "exact" | "declared" | "inferred" | "unknown";

/**
 * Exact needs provider-issued confidence and the campaign ID it proved.
 * UTM and tracking-token evidence is declared by whoever built the link;
 * referrer evidence is inferred. Everything else is unknown.
 */
export function confidenceBucket(confidence: string, hasCampaignId: boolean): ConfidenceBucket {
  const value = confidence.trim().toLowerCase();
  if (value === "exact") return hasCampaignId ? "exact" : "unknown";
  if (value === "declared" || value === "strong") return "declared";
  if (value === "inferred") return "inferred";
  return "unknown";
}

/** Cost per event, only when there is both spend and at least one event to divide it by. */
export function costPer(spend: number, events: number): number | null {
  if (!Number.isFinite(spend) || spend <= 0 || !Number.isFinite(events) || events <= 0) return null;
  return Math.round((spend / events) * 100) / 100;
}

/**
 * The tracked landing page a Meta creative URL points at, by exact path on
 * engosoft.com (`/cfm`, `/en/cfm`). Short links, shop and product URLs are not
 * resolved: a creative that points elsewhere is not a landing page campaign.
 */
export function landingPageForUrl(
  url: string,
  pages: readonly { id: string; slug: string }[],
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "engosoft.com") return null;
  const path = parsed.pathname.toLowerCase().replace(/\/+$/, "");
  for (const page of pages) {
    const slug = page.slug.toLowerCase();
    if (path === `/${slug}` || path === `/en/${slug}` || path === `/ar/${slug}`) return page.id;
  }
  return null;
}
