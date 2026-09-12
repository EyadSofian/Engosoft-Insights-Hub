import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeMetaGraphAd,
  resetMetaCreativeCacheForTests,
  syncMetaCreativesDirect,
} from "../../src/lib/meta-creatives.server";
import type { AdCreative } from "../../src/lib/types";

const fallback = (adId = "ad_1"): AdCreative => ({
  platform: "meta",
  account: "Engosoft",
  accountId: "act_1",
  campaign: "PMP campaign",
  campaignId: "campaign_1",
  campaignKey: "id:campaign_1",
  adset: "Professionals",
  adsetId: "adset_1",
  ad: "PMP reel",
  adId,
  creativeId: "creative_1",
  creativeName: "PMP reel",
  creativeType: "",
  mediaType: "unknown",
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

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetMetaCreativeCacheForTests();
});

describe("Meta creative normalization", () => {
  it("maps Meta image, copy, destination and stable dimensions", () => {
    const normalized = normalizeMetaGraphAd(
      {
        id: "ad_1",
        name: "PMP image",
        effective_status: "ACTIVE",
        campaign: { id: "campaign_1", name: "PMP September" },
        adset: { id: "adset_1", name: "Cairo professionals" },
        creative: {
          id: "creative_7",
          name: "PMP creative",
          title: "Become PMP certified",
          body: "Join the next live group.",
          thumbnail_url: "https://scontent.example/preview.jpg",
          instagram_permalink_url: "https://www.instagram.com/p/example/",
          object_story_spec: { link_data: { link: "https://engosoft.com/pmp" } },
        },
      },
      fallback(),
      "2026-09-12T12:00:00.000Z",
    );

    expect(normalized).toMatchObject({
      platform: "meta",
      adId: "ad_1",
      creativeId: "creative_7",
      campaignKey: "id:campaign_1",
      mediaType: "image",
      headline: "Become PMP certified",
      body: "Join the next live group.",
      imageUrl: "https://scontent.example/preview.jpg",
      landingPageUrl: "https://engosoft.com/pmp",
      status: "ACTIVE",
    });
  });

  it("recognizes reels and rejects non-web URLs", () => {
    const normalized = normalizeMetaGraphAd(
      {
        id: "ad_1",
        creative: {
          id: "creative_1",
          video_id: "video_1",
          thumbnail_url: "https://scontent.example/reel.jpg",
          instagram_permalink_url: "javascript:alert(1)",
          object_story_spec: { video_data: { message: "Watch the PMP reel" } },
        },
      },
      fallback(),
      "2026-09-12T12:00:00.000Z",
    );

    expect(normalized).toMatchObject({
      mediaType: "video",
      videoId: "video_1",
      body: "Watch the PMP reel",
      permalinkUrl: "",
    });
  });
});

describe("direct Meta creative sync", () => {
  it("batches real Ad IDs, returns the first response and never exposes the token", async () => {
    const secret = "meta-secret-token";
    vi.stubEnv("META_ACCESS_TOKEN", secret);
    vi.stubEnv("META_API_VERSION", "v25.0");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: URL | RequestInfo) => {
        const url = new URL(String(request));
        expect(url.searchParams.get("ids")).toBe("ad_1,ad_2");
        expect(url.searchParams.get("access_token")).toBe(secret);
        return new Response(
          JSON.stringify({
            ad_1: {
              id: "ad_1",
              creative: {
                id: "creative_1",
                body: "First creative",
                thumbnail_url: "https://scontent.example/one.jpg",
              },
            },
            ad_2: {
              id: "ad_2",
              creative: {
                id: "creative_2",
                video_id: "video_2",
                thumbnail_url: "https://scontent.example/two.jpg",
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const result = await syncMetaCreativesDirect([
      fallback("ad_1"),
      { ...fallback("ad_2"), creativeId: "creative_2" },
    ]);

    expect(result).toMatchObject({
      configured: true,
      ok: true,
      requested: 2,
      fetched: 2,
      failed: 0,
      persisted: false,
    });
    expect(result.creatives.map((row) => row.mediaType)).toEqual(["image", "video"]);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("redacts credentials from Meta failures", async () => {
    const secret = "meta-secret-token";
    vi.stubEnv("META_ACCESS_TOKEN", secret);
    vi.stubEnv("DATABASE_URL", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: `Bad access_token=${secret}` } }), {
            status: 401,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const result = await syncMetaCreativesDirect([fallback()]);
    expect(result.ok).toBe(false);
    expect(result.failed).toBe(1);
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
