import { describe, expect, it } from "vitest";
import {
  ACQUISITION_COUNTED_ENTITIES,
  chatwootDestinationChannel,
  chatwootSourceType,
  isExactAttribution,
  metaLeadSourceType,
} from "@/lib/acquisition-attribution";

describe("acquisition vocabulary", () => {
  it("counts leads, conversations and submissions, but not visits, as acquisitions", () => {
    expect(ACQUISITION_COUNTED_ENTITIES).toEqual([
      "meta_lead",
      "chatwoot_conversation",
      "landing_submission",
    ]);
  });

  it("maps Chatwoot channels to destinations", () => {
    expect(chatwootDestinationChannel("Channel::Whatsapp")).toBe("whatsapp");
    expect(chatwootDestinationChannel("Channel::FacebookPage")).toBe("messenger");
    expect(chatwootDestinationChannel("Channel::Instagram")).toBe("instagram_dm");
    expect(chatwootDestinationChannel("Channel::WebWidget")).toBe("website_chat");
    expect(chatwootDestinationChannel("")).toBe("unknown");
  });
});

describe("chatwootSourceType", () => {
  const base = { confidence: "exact", campaignId: "120250553509150718" };

  it("uses provider referral evidence for Meta sources", () => {
    expect(
      chatwootSourceType({ ...base, attributionMethod: "meta_whatsapp_referral", channel: "" }),
    ).toBe("meta_whatsapp_referral");
    expect(
      chatwootSourceType({
        ...base,
        attributionMethod: "meta_referral",
        channel: "Channel::FacebookPage",
      }),
    ).toBe("meta_messenger_referral");
  });

  it("never turns a channel alone, or missing evidence, into a paid or organic source", () => {
    expect(
      chatwootSourceType({
        attributionMethod: "unknown",
        channel: "Channel::Whatsapp",
        confidence: "unknown",
        campaignId: "",
      }),
    ).toBe("unknown");
    expect(
      chatwootSourceType({
        attributionMethod: "organic_direct",
        channel: "Channel::Whatsapp",
        confidence: "inferred",
        campaignId: "",
      }),
    ).toBe("unknown");
  });

  it("keeps website chat evidence separate from Meta", () => {
    expect(
      chatwootSourceType({ ...base, attributionMethod: "utm", channel: "Channel::WebWidget" }),
    ).toBe("website_chat");
  });
});

describe("meta leads and exactness", () => {
  it("maps lead scope to a source type", () => {
    expect(metaLeadSourceType("paid")).toBe("meta_instant_form");
    expect(metaLeadSourceType("organic")).toBe("direct_or_organic");
    expect(metaLeadSourceType("unknown")).toBe("unknown");
  });

  it("requires exact confidence and a campaign ID", () => {
    expect(isExactAttribution({ confidence: "exact", campaignId: "1" })).toBe(true);
    expect(isExactAttribution({ confidence: "exact", campaignId: "" })).toBe(false);
    expect(isExactAttribution({ confidence: "strong", campaignId: "1" })).toBe(false);
  });
});
