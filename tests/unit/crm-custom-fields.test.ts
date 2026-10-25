import { describe, expect, it } from "vitest";
import { crmCustomFieldPlan, crmCustomValue } from "@/lib/crm-odoo.server";

/**
 * Live Odoo (read 2026-10-26) carries TWO ad-set pairs on crm.lead:
 *   adset_id  / adset_name   populated on ~77% / ~75% of leads
 *   ad_set_id / ad_set_name  present on the model, empty on every row
 * Resolving to the first candidate that merely EXISTS selected the empty pair,
 * so every CRM row shipped a blank "Ad Set ID" and ad-set attribution fell back
 * to guessing from ad names. Resolution now keeps every candidate and each row
 * answers with whichever field it actually filled in.
 */
const field = (string: string, type = "char") => ({ string, type });

const liveMetadata = {
  ad_id: field("Ad ID"),
  ad_name: field("Ad Name"),
  adset_id: field("Ad Set ID"),
  adset_name: field("Ad Set Name"),
  ad_set_id: field("Ad Set Id"),
  ad_set_name: field("Ad Set Name"),
  campaign_id2: field("Campaign ID"),
  campaign_name: field("Campaign Name"),
  x_studio_course_categories: field("Course Categories", "many2one"),
  x_studio_answered: field("Calling reply?", "selection"),
};

describe("CRM custom field resolution", () => {
  const plan = crmCustomFieldPlan(liveMetadata);

  it("keeps both ad-set fields instead of the first that exists", () => {
    expect(plan.adsetId).toContain("adset_id");
    expect(plan.adsetId).toContain("ad_set_id");
  });

  it("prefers the populated ad-set field over the empty duplicate", () => {
    expect(plan.adsetId[0]).toBe("adset_id");
    expect(plan.adsetName[0]).toBe("adset_name");
  });

  it("reads the ad-set id from the field the row actually filled", () => {
    const row = {
      id: 1,
      ad_id: "120251300681860713",
      ad_name: "INTERIOR-21/11/25- sayed -RY",
      adset_id: "120251300681860712",
      adset_name: "INTERIOR-21/11/25- sayed -RY",
      ad_set_id: false,
      ad_set_name: false,
    };
    expect(crmCustomValue(row, plan.adsetId)).toBe("120251300681860712");
    expect(crmCustomValue(row, plan.adsetName)).toBe("INTERIOR-21/11/25- sayed -RY");
  });

  it("still resolves an instance that fills the other pair", () => {
    const mirrored = { id: 2, ad_set_id: "999", ad_set_name: "legacy set", adset_id: false };
    expect(crmCustomValue(mirrored, plan.adsetId)).toBe("999");
    expect(crmCustomValue(mirrored, plan.adsetName)).toBe("legacy set");
  });

  it("treats a label match as additive, not a replacement", () => {
    expect(crmCustomFieldPlan({ x_weird_adset: field("Ad Set ID") }).adsetId).toEqual([
      "x_weird_adset",
    ]);
  });

  it("reads empty for a dimension this Odoo does not expose", () => {
    const bare = crmCustomFieldPlan({});
    expect(bare.adsetId).toEqual([]);
    expect(crmCustomValue({ id: 3, adset_id: "x" }, bare.adsetId)).toBe("");
  });
});
