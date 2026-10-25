import { describe, expect, it } from "vitest";
import {
  PLATFORM_ALIASES,
  SOURCE_PLATFORMS,
  chatwootChannelSql,
  chatwootDestinationChannel,
  normalizeSourcePlatform,
  sourcePlatformSql,
  summarizeAcquisitionGroups,
  type AcquisitionGroup,
} from "@/lib/acquisition-attribution";

const group = (overrides: Partial<AcquisitionGroup>): AcquisitionGroup => ({
  entity_type: "chatwoot_conversation",
  source_type: "unknown",
  destination_channel: "whatsapp",
  source_platform: "unknown",
  events: 0,
  exact: 0,
  spend_covered: 0,
  ...overrides,
});

describe("source platform normalization", () => {
  it("maps Meta site_source_name codes and hosts to the controlled set", () => {
    expect(normalizeSourcePlatform("an")).toBe("audience_network");
    expect(normalizeSourcePlatform("fb")).toBe("facebook");
    expect(normalizeSourcePlatform("IG")).toBe("instagram");
    expect(normalizeSourcePlatform("msg")).toBe("messenger");
    expect(normalizeSourcePlatform("www.facebook.com")).toBe("facebook");
  });

  it("separates missing values from unrecognised ones", () => {
    expect(normalizeSourcePlatform("")).toBe("unknown");
    expect(normalizeSourcePlatform(null, "direct")).toBe("direct");
    expect(normalizeSourcePlatform("newsletter-7")).toBe("other");
  });

  it("only ever produces platforms from the vocabulary, in TS and SQL alike", () => {
    for (const [alias, platform] of Object.entries(PLATFORM_ALIASES)) {
      expect(SOURCE_PLATFORMS).toContain(platform);
      // Aliases are inlined into SQL, so they must never contain a quote.
      expect(alias).toMatch(/^[a-z0-9_.() -]+$/);
    }
    const sql = sourcePlatformSql("first_source");
    expect(sql).toContain("WHEN 'an' THEN 'audience_network'");
    expect(sql).toContain("ELSE 'other'");
  });

  it("reads both stored channel forms as one destination", () => {
    expect(chatwootDestinationChannel("Channel::Whatsapp")).toBe("whatsapp");
    expect(chatwootDestinationChannel("whatsapp")).toBe("whatsapp");
    expect(chatwootDestinationChannel("Channel::Telegram")).toBe("unknown");
    expect(chatwootChannelSql("c.channel")).toContain("WHEN 'whatsapp' THEN 'whatsapp'");
  });
});

describe("summarizeAcquisitionGroups", () => {
  const groups = [
    group({ destination_channel: "whatsapp", events: 293 }),
    group({ destination_channel: "messenger", events: 45 }),
    group({ destination_channel: "website_chat", events: 45 }),
    group({ destination_channel: "unknown", events: 1 }),
    group({
      entity_type: "landing_visit",
      source_type: "landing_page_visit",
      destination_channel: "landing_page",
      source_platform: "facebook",
      events: 3,
    }),
    group({
      entity_type: "landing_visit",
      source_type: "landing_page_visit",
      destination_channel: "landing_page",
      source_platform: "direct",
      events: 2,
    }),
    group({
      entity_type: "landing_submission",
      source_type: "landing_page_form",
      destination_channel: "landing_page",
      source_platform: "facebook",
      events: 1,
    }),
  ];

  it("derives every card from the same rows the table shows", () => {
    const cards = summarizeAcquisitionGroups(groups, { spendDataAvailable: true });
    const acquisitionRows = groups.filter((row) => row.entity_type !== "landing_visit");
    expect(cards.totalEvents).toBe(acquisitionRows.reduce((sum, row) => sum + row.events, 0));
    expect(cards.totalEvents).toBe(385);
    expect(cards.messagingConversations).toBe(384);
    expect(cards.landingVisits).toBe(5);
    expect(cards.landingSubmissions).toBe(1);
    expect(cards.metaInstantFormLeads).toBe(0);
    expect(cards.knownSourceEvents + cards.unknownEvents).toBe(cards.totalEvents);
    expect(cards.knownSourceEvents).toBe(1);
    expect(cards.conversationsByChannel).toEqual({
      whatsapp: 293,
      messenger: 45,
      website_chat: 45,
      unknown: 1,
    });
  });

  it("keeps a valid zero as zero and unavailable data as null", () => {
    const withSpend = summarizeAcquisitionGroups(groups, { spendDataAvailable: true });
    expect(withSpend.exactAttribution).toBe(0);
    expect(withSpend.spendCoveredEvents).toBe(0);
    expect(withSpend.attributionRate).toBe(0);
    const withoutSpend = summarizeAcquisitionGroups(groups, { spendDataAvailable: false });
    expect(withoutSpend.spendCoveredEvents).toBeNull();
    expect(summarizeAcquisitionGroups([], { spendDataAvailable: true }).attributionRate).toBeNull();
  });

  it("computes the attribution rate from exact acquisitions over acquisitions only", () => {
    const cards = summarizeAcquisitionGroups(
      [
        group({
          entity_type: "meta_lead",
          source_type: "meta_instant_form",
          events: 30,
          exact: 27,
          spend_covered: 25,
        }),
        group({ events: 70 }),
        group({
          entity_type: "landing_visit",
          source_type: "landing_page_visit",
          destination_channel: "landing_page",
          events: 900,
        }),
      ],
      { spendDataAvailable: true },
    );
    expect(cards.metaInstantFormLeads).toBe(30);
    expect(cards.totalEvents).toBe(100);
    expect(cards.landingVisits).toBe(900);
    expect(cards.attributionRate).toBeCloseTo(0.27);
    expect(cards.spendCoveredEvents).toBe(25);
    expect(cards.eventsByPlatform).not.toHaveProperty("landing_page");
  });
});
