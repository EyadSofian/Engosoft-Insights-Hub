import { describe, expect, it } from "vitest";
import {
  graphUsagePercent,
  isThrottleError,
  reconcileTargets,
  type ReconcileCandidate,
} from "../../src/lib/meta-catalog-reconcile";
import { leadFormIdOf, normalizeMetaGraphAd } from "../../src/lib/meta-creatives.server";
import type { AdCreative } from "../../src/lib/types";

const blank = (adId: string): AdCreative => ({
  platform: "meta",
  account: "",
  accountId: "act_405972484493798",
  campaign: "",
  campaignId: "",
  campaignKey: "",
  adset: "",
  adsetId: "",
  ad: "",
  adId,
  creativeId: "",
  creativeName: "",
  creativeType: "",
  mediaType: "",
  headline: "",
  body: "",
  price: "",
  imageUrl: "",
  thumbnailUrl: "",
  videoUrl: "",
  videoId: "",
  permalinkUrl: "",
  landingPageUrl: "",
  status: "",
  reviewStatus: "",
  reviewReason: "",
  createdAt: "",
  updatedAt: "",
  syncedAt: "",
});

const candidate = (overrides: Partial<ReconcileCandidate>): ReconcileCandidate => ({
  adId: "120253702302880712",
  accountId: "act_405972484493798",
  campaignId: "120253701419100712",
  adsetId: "120253701419090712",
  hasCreativeRow: true,
  currentSchema: true,
  syncedAt: "2026-09-14T00:00:00.000Z",
  lastFailure: "",
  ...overrides,
});

describe("lead form from the ad's creative", () => {
  it("reads the form from a video ad's call to action", () => {
    expect(
      leadFormIdOf({
        object_story_spec: {
          video_data: {
            call_to_action: { type: "SIGN_UP", value: { lead_gen_form_id: "788369357497059" } },
          },
        },
      }),
    ).toBe("788369357497059");
  });

  it("reads the form from a flexible creative's asset feed", () => {
    expect(
      leadFormIdOf({
        asset_feed_spec: {
          call_to_actions: [{ type: "SIGN_UP", value: { lead_gen_form_id: "699340279802600" } }],
        },
      }),
    ).toBe("699340279802600");
  });

  it("reads the form from a carousel child", () => {
    expect(
      leadFormIdOf({
        object_story_spec: {
          link_data: {
            child_attachments: [
              { call_to_action: { value: { lead_gen_form_id: "1429977601444396" } } },
            ],
          },
        },
      }),
    ).toBe("1429977601444396");
  });

  it("returns nothing for a website ad rather than inventing a form", () => {
    expect(
      leadFormIdOf({
        object_story_spec: {
          link_data: { link: "https://engosoft.com/cfm", call_to_action: { type: "LEARN_MORE" } },
        },
      }),
    ).toBe("");
  });
});

describe("image creatives and asset feeds", () => {
  it("keeps an image-hash-only creative as an image with a provider asset identity", () => {
    const creative = normalizeMetaGraphAd(
      {
        id: "120211",
        creative: {
          id: "cr_image",
          object_story_spec: {
            link_data: { image_hash: "abc123hash", link: "https://engosoft.com/pmp" },
          },
        },
      },
      blank("120211"),
      "2026-09-15T00:00:00.000Z",
    )!;
    expect(creative.imageHash).toBe("abc123hash");
    expect(creative.assets).toContainEqual({ type: "image", id: "abc123hash", url: "" });
  });

  it("parses every image, video and copy variation of a flexible creative", () => {
    const creative = normalizeMetaGraphAd(
      {
        id: "120212",
        creative: {
          id: "cr_flex",
          asset_feed_spec: {
            images: [{ hash: "h1", url: "https://scontent.example/h1.jpg" }, { hash: "h2" }],
            videos: [{ video_id: "v1", thumbnail_url: "https://scontent.example/v1.jpg" }],
            titles: [{ text: "PMP 8th edition" }, { text: "Pass PMP" }],
            bodies: [{ text: "Start now" }],
            link_urls: [{ website_url: "https://engosoft.com/pmp" }],
            call_to_actions: [{ value: { lead_gen_form_id: "form_9" } }],
          },
        },
      },
      blank("120212"),
      "2026-09-15T00:00:00.000Z",
    )!;
    expect(creative.mediaType).toBe("carousel");
    expect(
      creative.assets!.filter((asset) => asset.type === "image").map((asset) => asset.id),
    ).toEqual(["h1", "h2"]);
    expect(
      creative.assets!.filter((asset) => asset.type === "video").map((asset) => asset.id),
    ).toEqual(["v1"]);
    expect(creative.assetMetadata).toEqual({
      titles: ["PMP 8th edition", "Pass PMP"],
      bodies: ["Start now"],
      linkUrls: ["https://engosoft.com/pmp"],
    });
    expect(creative.leadFormId).toBe("form_9");
  });

  it("does not create a creative when Meta returned an ad without one", () => {
    expect(
      normalizeMetaGraphAd({ id: "120213" }, blank("120213"), "2026-09-15T00:00:00.000Z"),
    ).toBeNull();
  });
});

describe("reconcile planning", () => {
  it("reads missing creatives first, then old-schema rows, and skips current ones", () => {
    const plan = reconcileTargets(
      [
        candidate({ adId: "300000001" }),
        candidate({ adId: "200000001", currentSchema: false }),
        candidate({ adId: "100000001", hasCreativeRow: false, currentSchema: false }),
      ],
      { maxAds: 10, force: false, now: Date.parse("2026-09-15T00:00:00Z") },
    );
    expect(plan.targets.map((row) => row.adId)).toEqual(["100000001", "200000001"]);
    expect(plan.skipped).toBe(1);
  });

  it("re-reads a current row after a week", () => {
    const plan = reconcileTargets([candidate({ syncedAt: "2026-09-01T00:00:00Z" })], {
      maxAds: 10,
      force: false,
      now: Date.parse("2026-09-15T00:00:00Z"),
    });
    expect(plan.targets).toHaveLength(1);
  });

  it("is bounded and never re-asks an ad Meta refused unless forced", () => {
    const refused = candidate({ hasCreativeRow: false, lastFailure: "deleted_or_not_found" });
    const many = Array.from({ length: 50 }, (_, index) =>
      candidate({ adId: `9000000${index + 10}`, hasCreativeRow: false }),
    );
    expect(reconcileTargets([refused, ...many], { maxAds: 20, force: false }).targets).toHaveLength(
      20,
    );
    expect(reconcileTargets([refused], { maxAds: 20, force: false }).targets).toHaveLength(0);
    expect(reconcileTargets([refused], { maxAds: 20, force: true }).targets).toHaveLength(1);
  });

  it("ignores values that are not Meta ad IDs", () => {
    expect(
      reconcileTargets([candidate({ adId: "CFM NOV 25 AD 5", hasCreativeRow: false })], {
        maxAds: 5,
        force: false,
      }).targets,
    ).toHaveLength(0);
  });
});

describe("rate limits", () => {
  it("stops on Meta throttling codes", () => {
    expect(isThrottleError({ code: 17 })).toBe(true);
    expect(isThrottleError({ code: 80004 })).toBe(true);
    expect(isThrottleError({ code: 100 })).toBe(false);
  });

  it("reads the highest usage from Meta's rate-limit headers", () => {
    expect(
      graphUsagePercent({
        app: JSON.stringify({ call_count: 12, total_cputime: 4, total_time: 9 }),
        business: JSON.stringify({
          "405972484493798": [{ type: "ads_management", call_count: 81, total_time: 3 }],
        }),
        account: null,
      }),
    ).toBe(81);
    expect(graphUsagePercent({ app: "not json" })).toBe(0);
  });
});
