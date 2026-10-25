import { describe, expect, it } from "vitest";
import { coalesceCreativeAds } from "../../src/lib/creative-analytics";
import type { CreativeAnalyticsRow } from "../../src/lib/types";

const ad = (key: string, name: string, spend: number, imageUrl = "") =>
  ({
    performanceKey: key,
    creativeId: "shared-resource",
    ad: name,
    spend,
    crmLeads: 2,
    won: 1,
    lost: 1,
    revenue: 100,
    imageUrl,
    thumbnailUrl: "",
    videoUrl: "",
    headline: "",
    body: "",
  }) as CreativeAnalyticsRow;

describe("creative report ad grain", () => {
  it("keeps separate ads that reuse one creative resource", () => {
    const rows = coalesceCreativeAds([
      ad("ad:meta:account:1", "First ad", 50),
      ad("ad:meta:account:2", "Second ad", 75),
    ]);
    expect(rows.map((row) => [row.ad, row.spend])).toEqual([
      ["First ad", 50],
      ["Second ad", 75],
    ]);
  });

  it("deduplicates one ad without summing repeated performance", () => {
    const rows = coalesceCreativeAds([
      ad("ad:meta:account:1", "First ad", 50),
      ad("ad:meta:account:1", "First ad", 50, "https://example.com/image.jpg"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].spend).toBe(50);
    expect(rows[0].imageUrl).toBe("https://example.com/image.jpg");
  });
});
