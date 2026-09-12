import { describe, expect, it, vi } from "vitest";
import {
  assertOpenAIAdsUsdAccount,
  fetchOpenAIAds,
  normalizeOpenAICreative,
  normalizeOpenAIInsight,
  paginateOpenAIAds,
  resetOpenAIAdsCacheForTests,
} from "../../src/lib/openai-ads.server";
import {
  buildOpenAIConversionEvent,
  hashOpenAIEmail,
  hashOpenAIExternalId,
  hashOpenAIPhone,
} from "../../src/lib/openai-conversions.server";
import { computeTotals, type FilteredData } from "../../src/lib/metrics.server";
import type { AdRow } from "../../src/lib/types";
import { parseFilters } from "../../src/lib/api.server";

describe("OpenAI Ads normalization", () => {
  const account = { id: "adacct_1", name: "Engosoft ChatGPT Ads" };
  const objectives = new Map([["cmpn_1", "website_conversion" as const]]);

  it("normalizes one ad-day with stable IDs and preserves numeric zero", () => {
    const row = normalizeOpenAIInsight(
      account,
      {
        readable_time: "2026-09-09",
        campaign_id: "cmpn_1",
        campaign_name: "PMP lead campaign",
        ad_group_id: "adgrp_1",
        ad_group_name: "Cairo professionals",
        ad_id: "ad_1",
        ad_name: "PMP card",
        spend: "12.50",
        impressions: 1_000,
        clicks: 0,
      },
      objectives,
      new Map([["2026-09-09\u001fad_1", 3]]),
      "2026-09-10T10:00:00.000Z",
    );

    expect(row).toMatchObject({
      date: "2026-09-09",
      accountId: "adacct_1",
      campaignId: "cmpn_1",
      adsetId: "adgrp_1",
      adId: "ad_1",
      objective: "website_conversion",
      spend: 12.5,
      impressions: 1_000,
      clicks: 0,
      conversions: 3,
    });
  });

  it("keeps unavailable conversions null and rejects partial delivery metrics", () => {
    const base = {
      readable_time: "2026-09-09",
      campaign_id: "cmpn_1",
      ad_group_id: "adgrp_1",
      ad_id: "ad_1",
      spend: 5,
      impressions: 100,
      clicks: 4,
    };
    expect(normalizeOpenAIInsight(account, base, objectives, null, "sync")?.conversions).toBeNull();
    expect(
      normalizeOpenAIInsight(account, { ...base, spend: null }, objectives, null, "sync"),
    ).toBeNull();
    expect(
      normalizeOpenAIInsight(
        account,
        { ...base, readable_time: "09/09/2026" },
        objectives,
        null,
        "sync",
      ),
    ).toBeNull();
  });

  it("maps creative resources separately from daily facts", () => {
    const creative = normalizeOpenAICreative(
      account,
      { id: "cmpn_1", name: "PMP lead campaign" },
      { id: "adgrp_1", name: "Cairo professionals" },
      {
        id: "ad_1",
        name: "PMP card",
        status: "active",
        review_status: "approved",
        created_at: 1_757_376_000,
        updated_at: 1_757_379_600,
        creative: {
          type: "chat_card",
          title: "Advance your project career",
          body: "Join Engosoft's PMP program.",
          file_id: "file_1",
          image_url: "https://cdn.openai.com/ads/file_1.png",
          target_url: "https://engosoft.com/pmp",
        },
      },
      "2026-09-10T10:00:00.000Z",
    );
    expect(creative).toMatchObject({
      platform: "chatgpt",
      campaignKey: "id:cmpn_1",
      adId: "ad_1",
      creativeType: "chat_card",
      fileId: "file_1",
      headline: "Advance your project career",
      reviewStatus: "approved",
    });
    expect(creative.createdAt).toMatch(/^2025-/);
  });

  it("fails closed when account spend is not USD", () => {
    expect(() => assertOpenAIAdsUsdAccount({ id: "adacct_1", currency_code: "EGP" })).toThrow(
      /requires USD ad spend/,
    );
    expect(() => assertOpenAIAdsUsdAccount({ id: "adacct_1", currency_code: "usd" })).not.toThrow();
  });

  it("drops non-web creative URLs before they reach the browser", () => {
    const creative = normalizeOpenAICreative(
      account,
      { id: "cmpn_1", name: "Campaign" },
      { id: "adgrp_1", name: "Group" },
      {
        id: "ad_2",
        name: "Unsafe creative",
        status: "active",
        creative: { image_url: "data:text/html,unsafe", target_url: "javascript:alert(1)" },
      },
      "sync",
    );
    expect(creative.imageUrl).toBe("");
    expect(creative.landingPageUrl).toBe("");
  });
});

describe("OpenAI Ads pagination", () => {
  it("follows last_id until has_more is false", async () => {
    const cursors: string[] = [];
    const rows = await paginateOpenAIAds(async (after) => {
      cursors.push(after);
      return after
        ? { data: [3], has_more: false, last_id: "page_2" }
        : { data: [1, 2], has_more: true, last_id: "page_1" };
    });
    expect(rows).toEqual([1, 2, 3]);
    expect(cursors).toEqual(["", "page_1"]);
  });

  it("rejects missing or repeated cursors instead of looping", async () => {
    await expect(
      paginateOpenAIAds(async () => ({ data: [], has_more: true, last_id: null })),
    ).rejects.toThrow(/invalid cursor/);
  });
});

describe("OpenAI Ads request failures", () => {
  it("returns source health without leaking the API key", async () => {
    const secret = "test-ads-key-secret";
    vi.stubEnv("OPENAI_ADS_API_KEY", secret);
    vi.stubEnv("OPENAI_ADS_API_KEYS", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: "permission denied" } }), {
            status: 403,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    resetOpenAIAdsCacheForTests();

    try {
      const result = await fetchOpenAIAds(true);
      expect(result.health.ok).toBe(false);
      expect(result.source).toBe("none");
      expect(result.errors.join(" ")).toContain("permission denied");
      expect(JSON.stringify(result)).not.toContain(secret);
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      resetOpenAIAdsCacheForTests();
    }
  });
});

describe("cross-platform totals", () => {
  const row = (platform: AdRow["platform"], spend: number): AdRow => ({
    platform,
    date: "2026-09-09",
    account: platform,
    accountId: `${platform}_account`,
    objective: "leads",
    campaign: `${platform} campaign`,
    campaignId: `${platform}_campaign`,
    campaignKey: `id:${platform}_campaign`,
    adset: `${platform} ad group`,
    adsetId: `${platform}_adgroup`,
    ad: `${platform} ad`,
    adId: `${platform}_ad`,
    spend,
    impressions: 1_000,
    clicksAll: 100,
    linkClicks: platform === "meta" ? 80 : null,
    platformLeads: 10,
    viewCompletions: null,
    syncedAt: "2026-09-10T10:00:00.000Z",
  });

  it("adds ChatGPT to the scalable split without changing legacy fields", () => {
    const ads = [row("meta", 100), row("chatgpt", 40)];
    const totals = computeTotals({
      ads,
      crm: [],
      invoiced: [],
      accounting: [],
      lost: [],
      cpaBasis: "won",
      snapshot: { ads },
    } as unknown as FilteredData);
    expect(totals.spend).toBe(140);
    expect(totals.spendByPlatform).toEqual({
      meta: 100,
      snapchat: 0,
      tiktok: 0,
      google: 0,
      chatgpt: 40,
    });
    expect(totals.spendMeta).toBe(100);
    expect(totals.spendGoogle).toBe(0);
  });
});

describe("ChatGPT platform filtering", () => {
  it("accepts the native chatgpt platform key in global filters", async () => {
    const filters = await parseFilters(
      new Request("http://localhost/api/ads?platform=chatgpt&range=all"),
    );
    expect(filters.platform).toBe("chatgpt");
    expect(filters.range).toBe("all");
  });
});

describe("prepared OpenAI conversion events", () => {
  it("maps Odoo truth to official event types without sending", () => {
    const event = buildOpenAIConversionEvent({
      id: "invoice_42",
      outcome: "paid_invoice",
      occurredAt: Date.now() - 1_000,
      actionSource: "offline",
      amount: 125.5,
      currency: "USD",
      courseId: "pmp",
    });
    expect(event).toMatchObject({
      id: "engosoft_paid_invoice_invoice_42",
      type: "order_created",
      action_source: "offline",
      data: { type: "contents", amount: 12_550, currency: "USD" },
    });
  });

  it("normalizes identifiers before SHA-256 hashing", () => {
    expect(hashOpenAIEmail(" Test@Example.com ")).toBe(hashOpenAIEmail("test@example.com"));
    expect(hashOpenAIPhone("+1 (415) 555-2671")).toBe(hashOpenAIPhone("14155552671"));
    expect(hashOpenAIExternalId(" Lead-42 ")).toBe(hashOpenAIExternalId("Lead-42"));
  });
});
