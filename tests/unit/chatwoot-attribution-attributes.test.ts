import { describe, expect, it } from "vitest";
import {
  CHATWOOT_ATTRIBUTION_DEFINITIONS,
  CHATWOOT_ATTRIBUTION_KEYS,
  buildChatwootAttributionAttributes,
  customerSourceFor,
  planChatwootAttributionUpdate,
} from "@/lib/chatwoot-attribution-attributes";
import { mediaBuyerOf } from "@/lib/media-buyers";

const exactReferral = {
  channel: "Channel::Whatsapp",
  branch: "KSA",
  attributionMethod: "meta_whatsapp_referral",
  confidence: "exact",
  source: "ig",
  medium: "paid_social",
  campaignId: "120250553509150718",
  campaignName: "cmrp-9/26-sayed-broad",
  adsetId: "120250553509150719",
  adsetName: "Broad",
  adId: "120250553509150720",
  adName: "Video 03",
  creativeId: "120250553509150721",
  creativeName: "CMRP video creative",
  ctwaClid: "ctwa-click",
  utmSource: "facebook",
  utmMedium: "paid_social",
  utmCampaign: "cmrp_september",
};

describe("attribute schema", () => {
  it("defines one canonical key per field, with a label for each", () => {
    expect(new Set(CHATWOOT_ATTRIBUTION_KEYS).size).toBe(CHATWOOT_ATTRIBUTION_KEYS.length);
    expect(CHATWOOT_ATTRIBUTION_KEYS).toEqual(
      expect.arrayContaining([
        "meta_campaign_name",
        "meta_adset_name",
        "meta_ad_name",
        "meta_creative_name",
        "marketer_name",
        "customer_source",
        "customer_type",
      ]),
    );
    for (const definition of CHATWOOT_ATTRIBUTION_DEFINITIONS) {
      expect(definition.key).toMatch(/^[a-z_]+$/);
      expect(definition.name.length).toBeGreaterThan(2);
    }
  });
});

describe("mediaBuyerOf", () => {
  it("reads the documented campaign-name tokens and refuses ambiguity", () => {
    expect(mediaBuyerOf("cfm-13/9/36-sayed-land")).toBe("sayed");
    expect(mediaBuyerOf("Automotive - Riyadh - 4/7/26 - CBO - sh")).toBe("shazly");
    expect(mediaBuyerOf("shop-web-campaign")).toBeNull();
    expect(mediaBuyerOf("cfm-sayed-sh")).toBe("ambiguous");
  });
});

describe("customerSourceFor", () => {
  it("uses the inbox channel and exact referrals, never a guess", () => {
    const source = (attributionMethod: string, channel: string) =>
      customerSourceFor({ attributionMethod, channel });
    expect(source("meta_whatsapp_referral", "Channel::Whatsapp")).toBe("click_to_whatsapp");
    expect(source("meta_referral", "whatsapp")).toBe("click_to_whatsapp");
    expect(source("unknown", "Channel::Whatsapp")).toBe("unknown");
    expect(source("unknown", "Channel::FacebookPage")).toBe("messenger");
    expect(source("unknown", "Channel::Instagram")).toBe("instagram_dm");
    expect(source("unknown", "Channel::Api")).toBe("website_chat");
    expect(source("unknown", "Channel::WebWidget")).toBe("website_chat");
    expect(
      customerSourceFor({
        attributionMethod: "organic_direct",
        channel: "",
        confidence: "inferred",
      }),
    ).toBe("unknown");
  });
});

describe("buildChatwootAttributionAttributes", () => {
  it("writes only known facts and unknown markers for a historical WhatsApp conversation", () => {
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
      customer_source: "unknown",
      customer_type: "unknown",
      attribution_method: "unknown",
      attribution_confidence: "unknown",
      attribution_unknown_reason: "historical_evidence_missing",
    });
  });

  it("classifies Messenger and website conversations by their inbox", () => {
    expect(
      buildChatwootAttributionAttributes({
        channel: "Channel::FacebookPage",
        attributionMethod: "unknown",
        confidence: "unknown",
        historical: true,
      }).customer_source,
    ).toBe("messenger");
    expect(
      buildChatwootAttributionAttributes({
        channel: "Channel::Api",
        attributionMethod: "unknown",
        confidence: "unknown",
        customerType: "website_visitor",
      }),
    ).toMatchObject({ customer_source: "website_chat", customer_type: "website_visitor" });
  });

  it("never carries campaign, ad, name, marketer or click data without evidence, and never says organic", () => {
    const attributes = buildChatwootAttributionAttributes({
      ...exactReferral,
      attributionMethod: "inbox_mapping",
      confidence: "inferred",
      unknownReason: "organic_direct",
    });
    for (const key of [
      "meta_campaign_id",
      "meta_campaign_name",
      "meta_adset_id",
      "meta_ad_id",
      "meta_ad_name",
      "meta_creative_id",
      "ctwa_clid",
      "marketer_name",
      "attribution_campaign",
      "attribution_source",
    ] as const)
      expect(attributes[key]).toBeUndefined();
    expect(attributes.attribution_method).toBe("unknown");
    expect(attributes.attribution_unknown_reason).toBe("referral_evidence_missing");
  });

  it("writes the full exact schema for a Meta click-to-WhatsApp referral", () => {
    const attributes = buildChatwootAttributionAttributes({
      ...exactReferral,
      customerType: "new_lead",
    });
    expect(attributes).toEqual({
      attribution_channel: "whatsapp",
      engosoft_branch: "KSA",
      customer_source: "click_to_whatsapp",
      customer_type: "new_lead",
      marketer_name: "Sayed",
      attribution_method: "meta_whatsapp_referral",
      attribution_confidence: "exact",
      attribution_source: "instagram",
      attribution_medium: "paid_social",
      attribution_campaign: "cmrp-9/26-sayed-broad",
      meta_campaign_id: "120250553509150718",
      meta_campaign_name: "cmrp-9/26-sayed-broad",
      meta_adset_id: "120250553509150719",
      meta_adset_name: "Broad",
      meta_ad_id: "120250553509150720",
      meta_ad_name: "Video 03",
      meta_creative_id: "120250553509150721",
      meta_creative_name: "CMRP video creative",
      ctwa_clid: "ctwa-click",
      utm_source: "facebook",
      utm_medium: "paid_social",
      utm_campaign: "cmrp_september",
    });
    for (const key of Object.keys(attributes)) expect(CHATWOOT_ATTRIBUTION_KEYS).toContain(key);
  });

  it("assigns a marketer only to an exact campaign, with explicit mappings winning over the naming rule", () => {
    expect(
      buildChatwootAttributionAttributes({ ...exactReferral, campaignName: "cfm-sayed-sh" })
        .marketer_name,
    ).toBeUndefined();
    expect(
      buildChatwootAttributionAttributes({ ...exactReferral, marketer: "Shazly" }).marketer_name,
    ).toBe("Shazly");
    expect(
      buildChatwootAttributionAttributes({ ...exactReferral, campaignId: "" }).marketer_name,
    ).toBeUndefined();
    const utm = buildChatwootAttributionAttributes({
      channel: "Channel::WebWidget",
      attributionMethod: "utm",
      confidence: "strong",
      campaignId: "999",
      campaignName: "cfm-sayed",
      utmCampaign: "cfm-sayed",
    });
    expect(utm.marketer_name).toBeUndefined();
    expect(utm.meta_campaign_id).toBeUndefined();
    expect(utm.attribution_campaign).toBe("cfm-sayed");
  });

  it("carries a Meta name only with the exact ID it belongs to", () => {
    const attributes = buildChatwootAttributionAttributes({
      ...exactReferral,
      adId: "",
      creativeId: "",
    });
    expect(attributes.meta_ad_name).toBeUndefined();
    expect(attributes.meta_creative_name).toBeUndefined();
    expect(attributes.meta_adset_name).toBe("Broad");
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
  const exact = buildChatwootAttributionAttributes(exactReferral);

  it("fills empty attributes only and never sends a blank", () => {
    const changes = planChatwootAttributionUpdate(
      { attribution_method: "unknown", attribution_confidence: "unknown", course: "PMP" },
      unknownHistorical,
      "backfill",
    );
    expect(changes).toEqual({
      attribution_channel: "whatsapp",
      engosoft_branch: "KSA",
      customer_source: "unknown",
      customer_type: "unknown",
      attribution_unknown_reason: "historical_evidence_missing",
    });
    expect(Object.values(changes).every(Boolean)).toBe(true);
    expect(
      planChatwootAttributionUpdate({ utm_source: "google" }, { utm_source: "" }, "live"),
    ).toEqual({});
  });

  it("never replaces exact attribution with unknown data or an unknown classification", () => {
    const current = {
      attribution_method: "meta_whatsapp_referral",
      attribution_confidence: "exact",
      meta_campaign_id: "120250553509150718",
    };
    for (const mode of ["live", "backfill"] as const)
      expect(planChatwootAttributionUpdate(current, unknownHistorical, mode)).toEqual({
        attribution_channel: "whatsapp",
        engosoft_branch: "KSA",
      });
  });

  it("never replaces exact attribution with weaker evidence", () => {
    const utm = buildChatwootAttributionAttributes({
      channel: "Channel::Whatsapp",
      attributionMethod: "utm",
      confidence: "strong",
      utmSource: "google",
      utmCampaign: "brand",
    });
    const changes = planChatwootAttributionUpdate({ ...exact, utm_source: "" }, utm, "live");
    expect(changes).not.toHaveProperty("attribution_method");
    expect(changes).not.toHaveProperty("attribution_confidence");
    expect(changes).not.toHaveProperty("attribution_campaign");
  });

  it("keeps business context an agent or earlier write already set", () => {
    const changes = planChatwootAttributionUpdate(
      {
        engosoft_branch: "Egypt",
        attribution_channel: "whatsapp",
        marketer_name: "Shazly",
        customer_source: "messenger",
        customer_type: "existing_customer",
      },
      exact,
      "live",
    );
    expect(changes).not.toHaveProperty("engosoft_branch");
    expect(changes).not.toHaveProperty("marketer_name");
    expect(changes).not.toHaveProperty("customer_source");
    expect(changes).not.toHaveProperty("customer_type");
  });

  it("lets new exact evidence replace unknown markers and upgrade an unknown source", () => {
    expect(
      planChatwootAttributionUpdate(
        {
          attribution_method: "unknown",
          attribution_confidence: "unknown",
          customer_source: "unknown",
          customer_type: "unknown",
          attribution_channel: "whatsapp",
        },
        exact,
        "live",
      ),
    ).toMatchObject({
      attribution_method: "meta_whatsapp_referral",
      attribution_confidence: "exact",
      customer_source: "click_to_whatsapp",
      marketer_name: "Sayed",
      meta_campaign_id: "120250553509150718",
      meta_ad_name: "Video 03",
    });
  });
});
