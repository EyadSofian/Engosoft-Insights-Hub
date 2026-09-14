import { describe, expect, it } from "vitest";
import { bucketConfidence, campaignConfidence } from "@/lib/sales-funnel.server";

/**
 * The legacy sales report joins CRM rows to campaigns through fields typed onto
 * the CRM row. None of that is exact: exact attribution needs a provider-issued
 * lead or ad ID and lives in the closed-loop graph.
 */
describe("legacy sales campaign attribution confidence", () => {
  it("labels a CRM row carrying a campaign ID as declared, never exact", () => {
    expect(campaignConfidence({ campaignId: "120253701419100712", campaignName: "CFM" })).toBe(
      "declared",
    );
  });

  it("labels a campaign reached through its name alone as inferred", () => {
    expect(campaignConfidence({ campaignId: "", campaignName: "CFM - Sept" })).toBe("inferred");
  });

  it("labels a row with no campaign as unknown", () => {
    expect(campaignConfidence({ campaignId: " ", campaignName: "" })).toBe("unknown");
  });

  it("downgrades a campaign row to inferred when any lead reached it by name", () => {
    expect(bucketConfidence({ declaredLeads: 40, inferredLeads: 1, unknownLeads: 0 })).toBe(
      "inferred",
    );
    expect(bucketConfidence({ declaredLeads: 40, inferredLeads: 0, unknownLeads: 0 })).toBe(
      "declared",
    );
    expect(bucketConfidence({ declaredLeads: 0, inferredLeads: 0, unknownLeads: 12 })).toBe(
      "unknown",
    );
  });
});
