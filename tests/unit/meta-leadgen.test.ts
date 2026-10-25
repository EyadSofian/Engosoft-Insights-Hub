import { describe, expect, it } from "vitest";
import {
  META_LEAD_FIELDS,
  metaLeadPlatform,
  metaLeadScope,
  metaTimestamp,
  normalizeMetaLeadgenWebhook,
  parseMetaLeadForm,
  parseMetaLeadRecord,
} from "@/lib/meta-leadgen";

describe("normalizeMetaLeadgenWebhook", () => {
  const change = (value: Record<string, unknown>) => ({ field: "leadgen", value });

  it("reduces a Page leadgen change to provider IDs only", () => {
    const evidence = normalizeMetaLeadgenWebhook({
      object: "page",
      entry: [
        {
          id: "1500414613618298",
          time: 1789380000,
          changes: [
            change({
              leadgen_id: "900000000000001",
              page_id: "1500414613618298",
              form_id: "1489302304861631",
              ad_id: "120250553509150001",
              adgroup_id: "120250553509150002",
              created_time: 1789380000,
            }),
          ],
        },
      ],
    });
    expect(evidence).toEqual([
      {
        eventKey: "meta_lead:900000000000001",
        leadId: "900000000000001",
        pageId: "1500414613618298",
        formId: "1489302304861631",
        adId: "120250553509150001",
        adsetId: "120250553509150002",
        occurredAt: new Date(1789380000 * 1000).toISOString(),
      },
    ]);
  });

  it("deduplicates retries, ignores other fields and objects, and falls back to the entry page", () => {
    const payload = {
      object: "page",
      entry: [
        {
          id: "125287657625184",
          changes: [
            change({ leadgen_id: "900000000000002", form_id: "1" }),
            change({ leadgen_id: "900000000000002", form_id: "1" }),
            { field: "feed", value: { leadgen_id: "900000000000003" } },
            change({ leadgen_id: "not-a-number" }),
          ],
        },
      ],
    };
    const evidence = normalizeMetaLeadgenWebhook(payload);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({ leadId: "900000000000002", pageId: "125287657625184" });
    expect(
      normalizeMetaLeadgenWebhook({ ...payload, object: "whatsapp_business_account" }),
    ).toEqual([]);
  });
});

describe("lead records", () => {
  it("never requests form answers", () => {
    expect(META_LEAD_FIELDS.split(",")).not.toContain("field_data");
  });

  it("keeps exact IDs and drops anything that is not an ID", () => {
    const record = parseMetaLeadRecord({
      id: "900000000000001",
      created_time: "2026-09-14T10:00:00+0000",
      ad_id: "120250553509150001",
      ad_name: "CFM reel",
      adset_id: "120250553509150002",
      campaign_id: "not-an-id",
      form_id: "1489302304861631",
      platform: "IG",
      is_organic: false,
      field_data: [{ name: "phone_number", values: ["+966500000000"] }],
    });
    expect(record).toEqual({
      leadId: "900000000000001",
      createdTime: "2026-09-14T10:00:00.000Z",
      adId: "120250553509150001",
      adName: "CFM reel",
      adsetId: "120250553509150002",
      adsetName: "",
      campaignId: "",
      campaignName: "",
      formId: "1489302304861631",
      platform: "ig",
      isOrganic: false,
    });
    expect(JSON.stringify(record)).not.toContain("+966500000000");
    expect(parseMetaLeadRecord({ id: "abc" })).toBeNull();
  });

  it("reads form identity with a page fallback", () => {
    expect(
      parseMetaLeadForm(
        { id: "1489302304861631", name: "CFM Sept", status: "ACTIVE", locale: "ar_AR" },
        "1500414613618298",
      ),
    ).toMatchObject({ formId: "1489302304861631", pageId: "1500414613618298", name: "CFM Sept" });
  });
});

describe("scope and platform", () => {
  it("trusts Meta's organic flag, then the ad ID, and never guesses", () => {
    expect(metaLeadScope({ isOrganic: true, adId: "123" })).toEqual({
      scope: "organic",
      unknownReason: "",
    });
    expect(metaLeadScope({ isOrganic: false, adId: "123" })).toEqual({
      scope: "paid",
      unknownReason: "",
    });
    expect(metaLeadScope({ isOrganic: null, adId: "" })).toEqual({
      scope: "unknown",
      unknownReason: "meta_lead_ad_missing",
    });
  });

  it("maps Meta platform codes", () => {
    expect(metaLeadPlatform("fb")).toBe("facebook");
    expect(metaLeadPlatform("ig")).toBe("instagram");
    expect(metaLeadPlatform("")).toBe("meta");
  });

  it("parses Meta timestamps in every shape it sends", () => {
    expect(metaTimestamp(1789380000)).toBe(new Date(1789380000 * 1000).toISOString());
    expect(metaTimestamp("1789380000")).toBe(new Date(1789380000 * 1000).toISOString());
    expect(metaTimestamp("2026-09-14T10:00:00+0000")).toBe("2026-09-14T10:00:00.000Z");
    expect(metaTimestamp("nonsense")).toBeNull();
  });
});
