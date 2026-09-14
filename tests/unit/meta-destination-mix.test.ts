import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCoverageMatrix,
  classifyMetaAdDestination,
  extractMetaAdEvidence,
  parseMetaActions,
  type ClassifiedAdPerformance,
  type MetaAdEvidence,
} from "@/lib/meta-destination-mix";
import {
  getMetaDestinationMix,
  resetMetaDestinationMixCacheForTests,
} from "@/lib/meta-destination-mix.server";

const evidence = (overrides: Partial<MetaAdEvidence> = {}): MetaAdEvidence => ({
  destinationType: "UNDEFINED",
  optimizationGoal: "",
  callToActionTypes: [],
  appDestinations: [],
  leadFormIds: [],
  links: [],
  ...overrides,
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetMetaDestinationMixCacheForTests();
});

describe("classifyMetaAdDestination", () => {
  it("uses the ad set's messaging destination first", () => {
    expect(classifyMetaAdDestination(evidence({ destinationType: "WHATSAPP" }))).toMatchObject({
      type: "MESSAGING",
      messagingDestination: "WhatsApp",
    });
    expect(
      classifyMetaAdDestination(
        evidence({ destinationType: "MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP" }),
      ).messagingDestination,
    ).toBe("Instagram DM + Messenger + WhatsApp");
    expect(
      classifyMetaAdDestination(evidence({ callToActionTypes: ["WHATSAPP_MESSAGE"] })).type,
    ).toBe("MESSAGING");
  });

  it("classifies native lead forms, including on-ad lead generation without a form id", () => {
    expect(
      classifyMetaAdDestination(
        evidence({ destinationType: "ON_AD", optimizationGoal: "QUALITY_LEAD" }),
      ).type,
    ).toBe("META_INSTANT_FORM");
    expect(classifyMetaAdDestination(evidence({ leadFormIds: ["form_1"] })).type).toBe(
      "META_INSTANT_FORM",
    );
  });

  it("follows the creative for mixed website-and-form ad sets and flags them", () => {
    const withForm = classifyMetaAdDestination(
      evidence({
        destinationType: "WEBSITE_AND_LEAD_FORM",
        leadFormIds: ["form_1"],
        links: ["https://engosoft.com/cfm"],
      }),
    );
    expect(withForm).toMatchObject({ type: "META_INSTANT_FORM", mixedDestination: true });
    const withoutForm = classifyMetaAdDestination(
      evidence({ destinationType: "WEBSITE_AND_LEAD_FORM", links: ["https://engosoft.com/cfm"] }),
    );
    expect(withoutForm).toMatchObject({
      type: "WEBSITE_LANDING",
      mixedDestination: true,
      landingUrl: "https://engosoft.com/cfm",
    });
  });

  it("separates calls, external websites and everything else", () => {
    expect(classifyMetaAdDestination(evidence({ destinationType: "PHONE_CALL" })).type).toBe(
      "CALL",
    );
    expect(
      classifyMetaAdDestination(evidence({ links: ["https://engosoft.com/shop/pmp"] })).type,
    ).toBe("WEBSITE_LANDING");
    // A link to Meta's own properties is not a website landing page.
    expect(
      classifyMetaAdDestination(evidence({ links: ["https://www.facebook.com/engosoft"] })).type,
    ).toBe("OTHER");
    expect(classifyMetaAdDestination(evidence({ destinationType: "ON_POST" })).type).toBe("OTHER");
  });
});

describe("extractMetaAdEvidence", () => {
  it("reads lead form ids, buttons and links from Graph creatives", () => {
    const extracted = extractMetaAdEvidence({
      adset: {
        destination_type: "WEBSITE_AND_LEAD_FORM",
        optimization_goal: "OFFSITE_CONVERSIONS",
      },
      creative: {
        object_story_spec: {
          link_data: {
            link: "https://engosoft.com/cfm",
            call_to_action: { type: "SIGN_UP", value: { lead_gen_form_id: "form_9" } },
          },
        },
        asset_feed_spec: { link_urls: [{ website_url: "https://engosoft.com/cfm" }] },
      },
    });
    expect(extracted).toEqual({
      destinationType: "WEBSITE_AND_LEAD_FORM",
      optimizationGoal: "OFFSITE_CONVERSIONS",
      callToActionTypes: ["SIGN_UP"],
      appDestinations: [],
      leadFormIds: ["form_9"],
      links: ["https://engosoft.com/cfm"],
    });
  });
});

describe("buildCoverageMatrix", () => {
  const ad = (
    overrides: Partial<ClassifiedAdPerformance> & Pick<ClassifiedAdPerformance, "classification">,
  ): ClassifiedAdPerformance => ({
    campaignId: "c1",
    adId: "a1",
    currency: "USD",
    spend: 0,
    impressions: 0,
    clicks: 0,
    actions: {},
    ...overrides,
  });
  const form = classifyMetaAdDestination(evidence({ leadFormIds: ["f"] }));

  it("always lists every destination type with its ingestion status", () => {
    const matrix = buildCoverageMatrix([]);
    expect(matrix.map((row) => row.type)).toEqual([
      "MESSAGING",
      "WEBSITE_LANDING",
      "META_INSTANT_FORM",
      "CALL",
      "OTHER",
    ]);
    expect(matrix.find((row) => row.type === "META_INSTANT_FORM")?.ingestion).toBe("missing");
  });

  it("counts distinct campaigns and never sums spend across currencies", () => {
    const matrix = buildCoverageMatrix([
      ad({
        classification: form,
        campaignId: "c1",
        adId: "a1",
        spend: 10.105,
        actions: parseMetaActions([{ action_type: "onsite_conversion.lead_grouped", value: "3" }]),
      }),
      ad({ classification: form, campaignId: "c1", adId: "a2", spend: 5, currency: "EGP" }),
      ad({ classification: form, campaignId: "c2", adId: "a3", spend: 1.2 }),
    ]);
    const row = matrix.find((entry) => entry.type === "META_INSTANT_FORM");
    expect(row).toMatchObject({ campaigns: 2, ads: 3, primaryResult: "instantFormLeads" });
    expect(row?.spendByCurrency).toEqual({ USD: 11.31, EGP: 5 });
    expect(row?.results.instantFormLeads).toBe(3);
  });
});

describe("getMetaDestinationMix", () => {
  const TOKEN = "test-token-abc123";
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  function stubGraph(overrides: { adsError?: boolean } = {}) {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/me/adaccounts"))
        return respond({ data: [{ id: "act_1", currency: "USD" }] });
      if (url.pathname.endsWith("/insights"))
        return respond({
          data: [
            {
              campaign_id: "c1",
              ad_id: "a1",
              spend: "10.50",
              impressions: "100",
              clicks: "5",
              actions: [{ action_type: "onsite_conversion.lead_grouped", value: "3" }],
            },
            {
              campaign_id: "c2",
              ad_id: "a2",
              spend: "4",
              impressions: "50",
              clicks: "2",
              actions: [
                { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "2" },
              ],
            },
            { campaign_id: "c3", ad_id: "a3", spend: "0", impressions: "0", clicks: "0" },
          ],
        });
      if (url.searchParams.has("ids")) {
        if (overrides.adsError) return respond({ error: { message: `bad token ${TOKEN}` } }, 400);
        return respond({
          a1: {
            id: "a1",
            adset: { destination_type: "ON_AD", optimization_goal: "QUALITY_LEAD" },
            creative: {},
          },
          a2: { id: "a2", adset: { destination_type: "WHATSAPP" }, creative: {} },
        });
      }
      return respond({ error: { message: "unexpected" } }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("returns aggregate-only rows for delivered ads and caches the period", async () => {
    vi.stubEnv("META_ACCESS_TOKEN", TOKEN);
    const fetchMock = stubGraph();
    const mix = await getMetaDestinationMix({ from: "2026-06-16", to: "2026-09-14" });

    expect(mix).toMatchObject({
      configured: true,
      ok: true,
      scope: "meta_reported_aggregate",
      deliveredAds: 2,
      classifiedAds: 2,
      campaigns: 2,
      spendByCurrency: { USD: 14.5 },
    });
    const form = mix.matrix.find((row) => row.type === "META_INSTANT_FORM");
    const messaging = mix.matrix.find((row) => row.type === "MESSAGING");
    expect(form).toMatchObject({ ads: 1, spendByCurrency: { USD: 10.5 } });
    expect(form?.results.instantFormLeads).toBe(3);
    expect(messaging?.results.messagingConversationsStarted).toBe(2);
    expect(JSON.stringify(mix)).not.toMatch(/"a1"|"a2"/);

    for (const [input] of fetchMock.mock.calls) expect(String(input)).not.toContain(TOKEN);
    const calls = fetchMock.mock.calls.length;
    await getMetaDestinationMix({ from: "2026-06-16", to: "2026-09-14" });
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("reports unclassified spend and redacts the token from errors", async () => {
    vi.stubEnv("META_ACCESS_TOKEN", TOKEN);
    stubGraph({ adsError: true });
    const mix = await getMetaDestinationMix();
    expect(mix.ok).toBe(false);
    expect(mix.unclassifiedAds).toBe(2);
    expect(mix.unclassifiedSpendByCurrency).toEqual({ USD: 14.5 });
    expect(JSON.stringify(mix.errors)).not.toContain(TOKEN);
  });

  it("does not call Meta without a token", async () => {
    vi.stubEnv("META_ACCESS_TOKEN", "");
    const fetchMock = stubGraph();
    const mix = await getMetaDestinationMix();
    expect(mix.configured).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
