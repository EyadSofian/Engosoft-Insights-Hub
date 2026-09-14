import { describe, expect, it } from "vitest";
import {
  CHATWOOT_ATTRIBUTION_KEYS,
  buildChatwootAttributionAttributes,
  planChatwootAttributionUpdate,
} from "@/lib/chatwoot-attribution-attributes";

describe("buildChatwootAttributionAttributes", () => {
  it("writes only operational facts and unknown markers for a historical conversation", () => {
    expect(
      buildChatwootAttributionAttributes({
        channel: "Channel::Whatsapp",
        branch: "KSA",
        attributionMethod: "unknown",
        confidence: "unknown",
        historical: true,
      }),
    ).toEqual({
      attribution_channel: "whatsapp",
      engosoft_branch: "KSA",
      attribution_method: "unknown",
      attribution_confidence: "unknown",
      attribution_unknown_reason: "historical_evidence_missing",
    });
  });

  it("never carries campaign, ad or click IDs without evidence, and never says organic", () => {
    const attributes = buildChatwootAttributionAttributes({
      channel: "whatsapp",
      attributionMethod: "inbox_mapping",
      confidence: "inferred",
      unknownReason: "organic_direct",
      campaignId: "120250553509150718",
      adId: "120250553509150719",
      ctwaClid: "click",
      source: "facebook",
    });
    expect(attributes.meta_campaign_id).toBeUndefined();
    expect(attributes.meta_ad_id).toBeUndefined();
    expect(attributes.ctwa_clid).toBeUndefined();
    expect(attributes.attribution_source).toBeUndefined();
    expect(attributes.attribution_method).toBe("unknown");
    expect(attributes.attribution_unknown_reason).toBe("referral_evidence_missing");
  });

  it("writes the full exact schema for a Meta referral", () => {
    const attributes = buildChatwootAttributionAttributes({
      channel: "Channel::FacebookPage",
      attributionMethod: "meta_messenger_referral",
      confidence: "exact",
      source: "fb",
      medium: "paid_social",
      campaignName: "CFM Riyadh",
      campaignId: "1",
      adsetId: "2",
      adId: "3",
      creativeId: "4",
      ctwaClid: "clid",
    });
    expect(attributes).toMatchObject({
      attribution_channel: "messenger",
      attribution_source: "facebook",
      attribution_medium: "paid_social",
      attribution_campaign: "CFM Riyadh",
      meta_campaign_id: "1",
      meta_adset_id: "2",
      meta_ad_id: "3",
      meta_creative_id: "4",
      ctwa_clid: "clid",
      attribution_method: "meta_messenger_referral",
      attribution_confidence: "exact",
    });
    for (const key of Object.keys(attributes)) expect(CHATWOOT_ATTRIBUTION_KEYS).toContain(key);
  });

  it("keeps Meta IDs out of UTM-only website chat", () => {
    const attributes = buildChatwootAttributionAttributes({
      channel: "Channel::WebWidget",
      attributionMethod: "utm",
      confidence: "strong",
      utmSource: "google",
      utmCampaign: "brand",
      campaignId: "999",
    });
    expect(attributes.meta_campaign_id).toBeUndefined();
    expect(attributes.utm_source).toBe("google");
    expect(attributes.attribution_campaign).toBe("brand");
  });
});

describe("planChatwootAttributionUpdate", () => {
  const unknownHistorical = buildChatwootAttributionAttributes({
    channel: "Channel::Whatsapp",
    branch: "KSA",
    attributionMethod: "unknown",
    confidence: "unknown",
    historical: true,
  });

  it("fills empty attributes only and never sends a blank", () => {
    const changes = planChatwootAttributionUpdate(
      { attribution_method: "unknown", attribution_confidence: "unknown", course: "PMP" },
      unknownHistorical,
      "backfill",
    );
    expect(changes).toEqual({
      attribution_channel: "whatsapp",
      engosoft_branch: "KSA",
      attribution_unknown_reason: "historical_evidence_missing",
    });
    expect(Object.values(changes).every(Boolean)).toBe(true);
  });

  it("never overwrites proven attribution with unknown data", () => {
    const current = {
      attribution_method: "meta_whatsapp_referral",
      attribution_confidence: "exact",
      meta_campaign_id: "120250553509150718",
    };
    expect(planChatwootAttributionUpdate(current, unknownHistorical, "live")).toEqual({
      attribution_channel: "whatsapp",
      engosoft_branch: "KSA",
    });
    expect(planChatwootAttributionUpdate(current, unknownHistorical, "backfill")).toEqual({
      attribution_channel: "whatsapp",
      engosoft_branch: "KSA",
    });
  });

  it("keeps a manual branch or channel an agent already set", () => {
    expect(
      planChatwootAttributionUpdate(
        { engosoft_branch: "Egypt", attribution_channel: "whatsapp" },
        unknownHistorical,
        "live",
      ),
    ).not.toHaveProperty("engosoft_branch");
  });

  it("lets new exact evidence replace unknown markers", () => {
    const exact = buildChatwootAttributionAttributes({
      channel: "whatsapp",
      attributionMethod: "meta_whatsapp_referral",
      confidence: "exact",
      campaignId: "1",
    });
    expect(
      planChatwootAttributionUpdate(
        { attribution_method: "unknown", attribution_confidence: "unknown" },
        exact,
        "live",
      ),
    ).toMatchObject({
      attribution_method: "meta_whatsapp_referral",
      attribution_confidence: "exact",
      meta_campaign_id: "1",
    });
  });
});
