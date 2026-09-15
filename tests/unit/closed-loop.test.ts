import { describe, expect, it } from "vitest";
import {
  closedLoopFunnel,
  coverageOf,
  creativeAssets,
  crmOutcome,
  emptyMetrics,
  finalizeMetrics,
  linkAcquisitionsToCrm,
  metaLeadConfidence,
  rankByLeadQuality,
  resolveMetaHierarchy,
  rollupByGrain,
  type AcquisitionFactRow,
  type CrmOutcome,
  type CrmRecord,
  type MetaAdEntity,
} from "@/lib/closed-loop";

const catalog = new Map<string, MetaAdEntity>([
  [
    "ad-1",
    {
      adId: "ad-1",
      adName: "Video 03",
      accountId: "act_9",
      campaignId: "camp-1",
      campaignName: "CFM Sept",
      adsetId: "set-1",
      adsetName: "KSA broad",
      creativeId: "cr-1",
      creativeName: "CFM video",
    },
  ],
]);

const crm = (overrides: Partial<CrmRecord>): CrmRecord => ({
  id: "100",
  recordType: "opportunity",
  businessStatus: "open",
  stageKey: "open",
  openStatus: "",
  priority: "Cold",
  createdAt: "2026-09-01 10:00:00",
  facebookLeadId: "",
  adId: "",
  campaignId: "",
  ...overrides,
});

const outcome = (overrides: Partial<CrmOutcome> = {}): CrmOutcome => ({
  crmLeadId: "100",
  interested: false,
  qualified: false,
  quotation: false,
  won: false,
  lost: false,
  saleOrderIds: [],
  invoiceCount: 0,
  revenuePaidUsd: 0,
  firstInvoiceAt: "",
  ...overrides,
});

const fact = (overrides: Partial<AcquisitionFactRow>): AcquisitionFactRow => ({
  acquisitionEventId: "meta_lead:1",
  entityType: "meta_lead",
  destinationChannel: "meta_instant_form",
  sourcePlatform: "facebook",
  attributionConfidence: "exact",
  campaignId: "camp-1",
  campaignName: "CFM Sept",
  adsetId: "set-1",
  adsetName: "KSA broad",
  adId: "ad-1",
  adName: "Video 03",
  creativeId: "cr-1",
  creativeName: "CFM video",
  formId: "",
  landingPageId: "",
  course: "",
  salesperson: "",
  matchConfidence: "exact",
  outcome: null,
  ...overrides,
});

describe("Meta hierarchy", () => {
  it("resolves Campaign → Ad Set → Ad → Creative from the catalog by exact ad ID", () => {
    expect(resolveMetaHierarchy("ad-1", catalog)).toEqual({
      accountId: "act_9",
      campaignId: "camp-1",
      campaignName: "CFM Sept",
      adsetId: "set-1",
      adsetName: "KSA broad",
      adId: "ad-1",
      adName: "Video 03",
      creativeId: "cr-1",
      creativeName: "CFM video",
      resolved: true,
    });
  });

  it("never fills a level for an ad the catalog does not know", () => {
    const unresolved = resolveMetaHierarchy("ad-unknown", catalog);
    expect(unresolved.resolved).toBe(false);
    expect(unresolved.campaignId).toBe("");
    expect(unresolved.creativeId).toBe("");
  });

  it("is exact only with a provider lead ID and a catalog-resolved ad", () => {
    expect(
      metaLeadConfidence({ providerLeadId: "L1", adId: "ad-1", campaignId: "", resolved: true }),
    ).toBe("exact");
    expect(
      metaLeadConfidence({ providerLeadId: "L1", adId: "ad-9", campaignId: "", resolved: false }),
    ).toBe("declared");
    expect(
      metaLeadConfidence({ providerLeadId: "", adId: "ad-1", campaignId: "", resolved: true }),
    ).toBe("declared");
    expect(
      metaLeadConfidence({ providerLeadId: "L1", adId: "", campaignId: "", resolved: false }),
    ).toBe("unknown");
  });
});

describe("creative assets", () => {
  it("keeps provider asset IDs and never promotes an asset to exact attribution", () => {
    const assets = creativeAssets({
      creativeId: "cr-1",
      adId: "ad-1",
      videoId: "vid-7",
      imageHash: "",
      imageUrl: "https://cdn/x.jpg",
      thumbnailUrl: "https://cdn/t.jpg",
      feedAssets: [
        { type: "image", id: "hash-2", url: "https://cdn/2.jpg" },
        { type: "video", id: "vid-7" },
      ],
    });
    expect(assets.map((asset) => `${asset.assetType}:${asset.assetId}`)).toEqual([
      "video:vid-7",
      "image:hash-2",
    ]);
    expect(assets.every((asset) => asset.attributionLevel === "reporting")).toBe(true);
  });

  it("creates no asset identity when Meta gave no asset ID", () => {
    expect(
      creativeAssets({
        creativeId: "cr-1",
        adId: "ad-1",
        videoId: "",
        imageHash: "",
        imageUrl: "https://cdn/x.jpg",
        thumbnailUrl: "",
      }),
    ).toEqual([]);
  });
});

describe("CRM outcomes", () => {
  it("derives lifecycle from stable fields and rolls up paid revenue through the order's opportunity", () => {
    const result = crmOutcome(
      crm({ id: "100", businessStatus: "won", stageKey: "won", openStatus: "Interested" }),
      [
        { orderId: "7", orderName: "S1", opportunityId: "100", state: "sale" },
        { orderId: "8", orderName: "S2", opportunityId: "999", state: "sale" },
      ],
      [
        { orderName: "S1", movement: "INV/1", usdPaid: 100.5, paymentDate: "2026-09-05" },
        { orderName: "S1", movement: "INV/1", usdPaid: 49.5, paymentDate: "2026-09-05" },
        { orderName: "S2", movement: "INV/2", usdPaid: 999, paymentDate: "2026-09-02" },
      ],
    );
    expect(result).toMatchObject({
      interested: true,
      qualified: true,
      quotation: true,
      won: true,
      lost: false,
      saleOrderIds: ["7"],
      invoiceCount: 1,
      revenuePaidUsd: 150,
      firstInvoiceAt: "2026-09-05",
    });
  });

  it("does not call an open, cold, unanswered lead interested or qualified", () => {
    expect(crmOutcome(crm({}), [], [])).toMatchObject({
      interested: false,
      qualified: false,
      quotation: false,
      won: false,
      revenuePaidUsd: 0,
    });
    expect(crmOutcome(crm({ priority: "Hot", openStatus: "Interested" }), [], [])).toMatchObject({
      interested: true,
      qualified: true,
      quotation: false,
    });
  });
});

describe("acquisition → CRM links", () => {
  const records = [
    crm({ id: "100", facebookLeadId: "L1", businessStatus: "open", createdAt: "2026-09-01" }),
    crm({ id: "101", facebookLeadId: "L1", businessStatus: "won", createdAt: "2026-09-03" }),
    crm({ id: "200", businessStatus: "open" }),
    crm({ id: "300", facebookLeadId: "L3" }),
  ];

  it("links a Meta lead to the CRM record carrying its provider lead ID", () => {
    const links = linkAcquisitionsToCrm(
      [
        {
          acquisitionEventId: "meta_lead:L3",
          entityType: "meta_lead",
          providerLeadId: "L3",
          chatwootConversationId: "",
          chatwootContactId: "",
          landingSubmissionId: "",
          chatwootCrmLeadIds: [],
        },
      ],
      records,
    );
    expect(links).toEqual([
      expect.objectContaining({
        crmLeadId: "300",
        matchMethod: "crm_carried_provider_lead_id",
        matchConfidence: "exact",
        isPrimary: true,
      }),
    ]);
  });

  it("keeps one primary link when two CRM records carry the same lead, so it counts once", () => {
    const links = linkAcquisitionsToCrm(
      [
        {
          acquisitionEventId: "meta_lead:L1",
          entityType: "meta_lead",
          providerLeadId: "L1",
          chatwootConversationId: "",
          chatwootContactId: "",
          landingSubmissionId: "",
          chatwootCrmLeadIds: [],
        },
      ],
      records,
    );
    expect(links).toHaveLength(2);
    expect(links.filter((link) => link.isPrimary).map((link) => link.crmLeadId)).toEqual(["101"]);
  });

  it("never links a conversation to CRM history created before it (returning customer)", () => {
    const links = linkAcquisitionsToCrm(
      [
        {
          acquisitionEventId: "chatwoot_conversation:57",
          entityType: "chatwoot_conversation",
          providerLeadId: "",
          chatwootConversationId: "57",
          chatwootContactId: "11",
          landingSubmissionId: "",
          chatwootCrmLeadIds: ["old", "new"],
          occurredAt: "2026-09-14 17:00",
        },
      ],
      [
        crm({ id: "old", businessStatus: "won", createdAt: "2026-02-01 09:00:00" }),
        crm({ id: "new", businessStatus: "open", createdAt: "2026-09-14 17:05:00" }),
      ],
    );
    expect(links.map((link) => link.crmLeadId)).toEqual(["new"]);
    expect(
      linkAcquisitionsToCrm(
        [
          {
            acquisitionEventId: "chatwoot_conversation:58",
            entityType: "chatwoot_conversation",
            providerLeadId: "",
            chatwootConversationId: "58",
            chatwootContactId: "12",
            landingSubmissionId: "",
            chatwootCrmLeadIds: ["old"],
          },
        ],
        [crm({ id: "old", createdAt: "2026-02-01 09:00:00" })],
      ),
    ).toEqual([]);
  });

  it("links a conversation only to CRM IDs already related to it, as inferred, never by guessing", () => {
    const links = linkAcquisitionsToCrm(
      [
        {
          acquisitionEventId: "chatwoot_conversation:55",
          entityType: "chatwoot_conversation",
          providerLeadId: "",
          chatwootConversationId: "55",
          chatwootContactId: "9",
          landingSubmissionId: "",
          chatwootCrmLeadIds: ["200", "does-not-exist"],
          occurredAt: "2026-09-01 09:00",
        },
        {
          acquisitionEventId: "chatwoot_conversation:56",
          entityType: "chatwoot_conversation",
          providerLeadId: "",
          chatwootConversationId: "56",
          chatwootContactId: "10",
          landingSubmissionId: "",
          chatwootCrmLeadIds: [],
        },
        {
          acquisitionEventId: "landing_submission:s1",
          entityType: "landing_submission",
          providerLeadId: "",
          chatwootConversationId: "",
          chatwootContactId: "",
          landingSubmissionId: "s1",
          chatwootCrmLeadIds: [],
        },
      ],
      records,
    );
    expect(links).toEqual([
      expect.objectContaining({
        acquisitionEventId: "chatwoot_conversation:55",
        crmLeadId: "200",
        matchMethod: "chatwoot_phone_key",
        matchConfidence: "inferred",
        isPrimary: true,
      }),
    ]);
  });
});

describe("rollups", () => {
  const won = outcome({
    interested: true,
    qualified: true,
    quotation: true,
    won: true,
    saleOrderIds: ["7"],
    invoiceCount: 1,
    revenuePaidUsd: 600,
  });
  const cold = outcome();

  it("joins creative spend by exact creative ID and rolls up won revenue", () => {
    const facts = [
      fact({ acquisitionEventId: "a", outcome: won }),
      fact({ acquisitionEventId: "b", outcome: cold }),
      fact({ acquisitionEventId: "c", outcome: null }),
    ];
    const [row] = rollupByGrain(
      facts,
      [
        {
          campaignId: "camp-1",
          adsetId: "set-1",
          adId: "ad-1",
          creativeId: "cr-1",
          spend: 90,
          impressions: 1000,
          clicks: 50,
        },
        {
          campaignId: "camp-2",
          adsetId: "set-2",
          adId: "ad-2",
          creativeId: "cr-2",
          spend: 10,
          impressions: 5,
          clicks: 1,
        },
      ],
      "creative",
    ).filter((item) => item.creativeId === "cr-1");
    expect(row).toMatchObject({
      creativeId: "cr-1",
      creativeName: "CFM video",
      leads: 3,
      crmMatched: 2,
      won: 1,
      revenue: 600,
      spend: 90,
      cpl: 30,
      cac: 90,
      winRate: 0.5,
      revenuePerLead: 200,
      roas: 6.67,
    });
  });

  it("keeps unknown and declared acquisitions out of entity rows", () => {
    const rows = rollupByGrain(
      [
        fact({
          acquisitionEventId: "x",
          attributionConfidence: "unknown",
          campaignId: "",
          adId: "",
          creativeId: "",
        }),
        fact({ acquisitionEventId: "y", attributionConfidence: "declared" }),
      ],
      [],
      "campaign",
    );
    expect(rows).toEqual([]);
  });

  it("builds the campaign → ad set → ad hierarchy on exact IDs", () => {
    const facts = [
      fact({ acquisitionEventId: "a" }),
      fact({ acquisitionEventId: "b", adId: "ad-2", adName: "Image 1", creativeId: "cr-2" }),
    ];
    expect(rollupByGrain(facts, [], "campaign").map((row) => [row.campaignId, row.leads])).toEqual([
      ["camp-1", 2],
    ]);
    expect(rollupByGrain(facts, [], "adset").map((row) => [row.adsetId, row.leads])).toEqual([
      ["set-1", 2],
    ]);
    expect(rollupByGrain(facts, [], "ad").map((row) => [row.adId, row.adName, row.leads])).toEqual([
      ["ad-1", "Video 03", 1],
      ["ad-2", "Image 1", 1],
    ]);
  });

  it("ranks the creative with fewer, better leads above cheap leads that never buy", () => {
    const cheap = { ...emptyMetrics(), key: "cheap", leads: 100, crmMatched: 100, spend: 100 };
    const strong = {
      ...emptyMetrics(),
      key: "strong",
      leads: 30,
      crmMatched: 30,
      won: 6,
      revenue: 3000,
      spend: 150,
    };
    const ranked = rankByLeadQuality(
      [finalizeMetrics(cheap), finalizeMetrics(strong)].map((row, index) => ({
        ...row,
        key: index ? "strong" : "cheap",
      })),
    );
    expect(ranked[0].key).toBe("strong");
    expect(finalizeMetrics({ ...cheap }).cpl).toBeLessThan(finalizeMetrics({ ...strong }).cpl ?? 0);
  });

  it("reports coverage and uses CRM-matched leads as the rate denominator", () => {
    const facts = [
      fact({ acquisitionEventId: "a", outcome: won }),
      fact({
        acquisitionEventId: "b",
        attributionConfidence: "unknown",
        campaignId: "",
        adsetId: "",
        adId: "",
        creativeId: "",
        matchConfidence: "inferred",
        outcome: cold,
      }),
      fact({
        acquisitionEventId: "c",
        attributionConfidence: "unknown",
        campaignId: "",
        adsetId: "",
        adId: "",
        creativeId: "",
        matchConfidence: "",
        outcome: null,
      }),
    ];
    expect(coverageOf(facts)).toMatchObject({
      total: 3,
      withCampaignId: 1,
      withCreativeId: 1,
      exact: 1,
      unknown: 2,
      crmMatched: 2,
      crmMatchedExact: 1,
    });
    const metrics = emptyMetrics();
    facts.forEach((item) => {
      metrics.leads += 1;
      if (item.outcome) {
        metrics.crmMatched += 1;
        if (item.outcome.won) metrics.won += 1;
      }
    });
    expect(finalizeMetrics(metrics).winRate).toBe(0.5);
  });

  it("chains funnel conversion rates across the steps that have values", () => {
    const metrics = {
      ...emptyMetrics(),
      leads: 50,
      crmMatched: 40,
      interested: 20,
      quotations: 10,
      won: 5,
      saleOrders: 5,
      invoices: 4,
      revenue: 2000,
    };
    const steps = closedLoopFunnel({ impressions: 10000, clicks: 500, metrics });
    expect(steps.find((step) => step.key === "clicks")?.rateFromPrevious).toBe(0.05);
    expect(steps.find((step) => step.key === "crm_matched")?.rateFromPrevious).toBe(0.8);
    expect(steps.find((step) => step.key === "won")?.rateFromPrevious).toBe(0.5);
    expect(steps.find((step) => step.key === "revenue")?.rateFromPrevious).toBeNull();
    expect(
      closedLoopFunnel({ impressions: null, clicks: null, metrics })[2].rateFromPrevious,
    ).toBeNull();
  });
});

describe("ambiguous inferred links", () => {
  const conversation = (id: string, crmIds: string[]) => ({
    acquisitionEventId: `chatwoot_conversation:${id}`,
    entityType: "chatwoot_conversation",
    providerLeadId: "",
    chatwootConversationId: id,
    chatwootContactId: id,
    landingSubmissionId: "",
    chatwootCrmLeadIds: crmIds,
    occurredAt: "2026-09-10 10:00:00",
  });
  const record = (id: string) => ({
    id,
    recordType: "lead",
    businessStatus: "open",
    stageKey: "open",
    openStatus: "",
    priority: "",
    createdAt: "2026-09-10 11:00:00",
    facebookLeadId: "",
    adId: "",
    campaignId: "",
  });

  it("flags a phone key shared by several CRM records instead of choosing one", () => {
    const links = linkAcquisitionsToCrm(
      [conversation("1", ["A", "B"])],
      [record("A"), record("B")],
    );
    expect(links.every((link) => link.matchConfidence === "ambiguous" && !link.isPrimary)).toBe(
      true,
    );
    expect(links[0]!.ambiguityReason).toBe("phone_key_shared_by_several_crm_records");
  });

  it("flags a CRM record claimed by two conversations on both sides", () => {
    const links = linkAcquisitionsToCrm(
      [conversation("1", ["A"]), conversation("2", ["A"])],
      [record("A")],
    );
    expect(links).toHaveLength(2);
    expect(
      links.every((link) => link.ambiguityReason === "crm_record_claimed_by_several_conversations"),
    ).toBe(true);
    expect(links.some((link) => link.isPrimary)).toBe(false);
  });

  it("never touches exact provider-ID links", () => {
    const links = linkAcquisitionsToCrm(
      [
        {
          acquisitionEventId: "meta_lead:1762205674919639",
          entityType: "meta_lead",
          providerLeadId: "1762205674919639",
          chatwootConversationId: "",
          chatwootContactId: "",
          landingSubmissionId: "",
          chatwootCrmLeadIds: [],
          occurredAt: "2026-08-22 20:17:22",
        },
      ],
      [
        { ...record("145254"), facebookLeadId: "1762205674919639" },
        { ...record("999"), facebookLeadId: "1762205674919639" },
      ],
    );
    expect(links.filter((link) => link.isPrimary)).toHaveLength(1);
    expect(links.every((link) => link.matchConfidence === "exact")).toBe(true);
  });
});
