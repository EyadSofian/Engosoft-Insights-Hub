import type { CreativeAnalyticsRow } from "@/lib/types";

/** Keep one row per ad, even when several ads reuse the same creative asset. */
export function coalesceCreativeAds(rows: CreativeAnalyticsRow[]): CreativeAnalyticsRow[] {
  const byAd = new Map<string, CreativeAnalyticsRow>();
  for (const current of rows) {
    const previous = byAd.get(current.performanceKey);
    if (!previous) {
      byAd.set(current.performanceKey, current);
      continue;
    }
    const richness = (row: CreativeAnalyticsRow) =>
      [row.imageUrl, row.thumbnailUrl, row.videoUrl, row.headline, row.body].filter(Boolean).length;
    if (richness(current) > richness(previous)) byAd.set(current.performanceKey, current);
  }
  return [...byAd.values()];
}
