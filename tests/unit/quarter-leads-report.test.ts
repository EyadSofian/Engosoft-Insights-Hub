import { describe, it, expect } from "vitest";
import {
  buildQuarterLeadReview,
  leadSpendExclusion,
  type ReviewAd,
  type ReviewLead,
  type ReviewPayment,
} from "@/lib/quarter-leads-report";
const ad = (patch: Partial<ReviewAd> = {}): ReviewAd => ({
  month: "2026-08",
  course: "CFM",
  platform: "meta",
  campaign: "CFM campaign",
  campaignKey: "id:1",
  account: "Leads account",
  objective: "leads",
  spend: 100,
  clicks: 20,
  nativeLeads: 25,
  ...patch,
});
const lead = (id: string, patch: Partial<ReviewLead> = {}): ReviewLead => ({
  id,
  createdAt: "2026-08-05",
  course: "CFM",
  platform: "meta",
  campaign: "CFM campaign",
  campaignKey: "id:1",
  source: "Facebook",
  segment: "",
  status: "open",
  recordType: "opportunity",
  closeDate: "",
  dateBasis: "",
  nativeEvidence: false,
  ...patch,
});
const payment = (patch: Partial<ReviewPayment> = {}): ReviewPayment => ({
  company: "KSA",
  invoice: "INV",
  order: "S1",
  leadId: "1",
  date: "2026-09-10",
  course: "CFM",
  amount: 500,
  ...patch,
});
const input = () => ({
  ads: [ad()],
  leads: [
    lead("1", { status: "won", closeDate: "2026-08-15", dateBasis: "won_date" }),
    lead("2", {
      status: "lost",
      recordType: "lead",
      closeDate: "2026-09-14",
      dateBasis: "date_closed",
    }),
    lead("3"),
  ],
  payments: [payment()],
  asOf: "2026-11-12",
  spendCoverage: { "2026-08": true, "2026-09": true, "2026-10": true },
  crmReady: true,
  revenueReady: true,
  linksReady: true,
});
describe("August–October lead acquisition review", () => {
  it("excludes website, social and unknown-objective spend without excluding genuine lead forms on Instagram", () => {
    expect(leadSpendExclusion(ad({ campaign: "CFM-con-web" }))).toBe("website");
    expect(leadSpendExclusion(ad({ campaign: "IG-traffic-1/8" }))).toBe("social_awareness");
    expect(leadSpendExclusion(ad({ campaign: "CFM webinar" }))).toBe("webinar");
    expect(leadSpendExclusion(ad({ objective: "unknown" }))).toBe("non_lead_or_unknown");
    expect(leadSpendExclusion(ad({ campaign: "CFM Instagram Leads" }))).toBeNull();
    const r = buildQuarterLeadReview({
      ...input(),
      ads: [
        ad(),
        ad({ campaign: "web-con", campaignKey: "web", spend: 40 }),
        ad({ campaign: "Branding", campaignKey: "brand", spend: 10 }),
      ],
    });
    expect(r.months[0].spend).toBe(100);
    expect(r.months[0].excludedSpend).toBe(50);
    expect(r.months[0].nativeCpl).toBe(4);
  });
  it("Fresh means all month entries, not today's mutable Fresh tag, and current Won/Lost are subsets", () => {
    const r = buildQuarterLeadReview(input()),
      m = r.months[0];
    expect(m.crmLeads).toBe(3);
    expect(m.won).toBe(1);
    expect(m.lost).toBe(1);
    expect(m.open).toBe(1);
    expect(m.wonRate).toBeCloseTo(1 / 3);
    expect(m.lostLeads).toBe(1);
    expect(m.lostOpportunities).toBe(0);
  });
  it("attributes later receipts to the original creation month and withholds future, pre-entry and unlinked receipts", () => {
    const r = buildQuarterLeadReview({
      ...input(),
      payments: [
        payment(),
        payment({ leadId: "old", amount: 200 }),
        payment({ date: "2026-08-01", amount: 200 }),
        payment({ date: "2026-11-13", amount: 200 }),
      ],
    });
    expect(r.months[0].cohortRevenue).toBe(500);
    expect(r.months[1].cohortRevenue).toBe(0);
    expect(r.months[0].cohortRoas).toBe(5);
    expect(r.coverage.beforeEntryRevenue).toBe(200);
  });
  it("uses dated closed samples only, leaves open/undated out of the mean, and reports missing dates", () => {
    const r = buildQuarterLeadReview({
      ...input(),
      leads: [...input().leads, lead("4", { status: "won" })],
    });
    expect(r.months[0].datedClosures).toBe(2);
    expect(r.months[0].undatedClosures).toBe(1);
    expect(r.months[0].wonCycle).toBe(10);
    expect(r.months[0].lostCycle).toBe(40);
    expect(r.months[0].cycleMean).toBe(25);
    expect(r.months[0].lifecycle.reduce((s, b) => s + (b.count || 0), 0)).toBe(2);
  });
  it("deduplicates IDs and applies source/segment exclusions, with Website-source records separate", () => {
    const r = buildQuarterLeadReview({
      ...input(),
      leads: [
        ...input().leads,
        lead("1"),
        lead("4", { segment: "WhatsApp Broadcast" }),
        lead("5", { source: "Recommendation" }),
        lead("6", { platform: "unknown", source: "Website" }),
      ],
    });
    expect(r.months[0].crmLeads).toBe(3);
    expect(r.coverage.sourcePolicy).toBe(2);
    expect(r.coverage.nonPlatform).toBe(1);
  });
  it("does not substitute website conversions for missing native forms or assume missing spend is zero", () => {
    const r = buildQuarterLeadReview({
      ...input(),
      ads: [ad({ platform: "tiktok", nativeLeads: null })],
      spendCoverage: { "2026-08": false },
    });
    expect(r.months[0].spend).toBeNull();
    expect(r.months[0].spendKnown).toBe(100);
    expect(r.months[0].nativeLeads).toBeNull();
    expect(r.months[0].nativeCpl).toBeNull();
  });
  it("prevents refunded orders from counting as paid and avoids wrong-course revenue", () => {
    const r = buildQuarterLeadReview({
      ...input(),
      payments: [
        payment(),
        payment({ invoice: "RINV", amount: -500 }),
        payment({ course: "PMP", amount: 200 }),
      ],
    });
    expect(r.months[0].paidLeads).toBe(0);
    expect(r.months[0].cohortRevenue).toBe(0);
    expect(r.coverage.courseMismatchRevenue).toBe(200);
  });
  it("keeps unavailable CRM and paid attribution null, including lifecycle buckets", () => {
    const r = buildQuarterLeadReview({ ...input(), crmReady: false, linksReady: false });
    expect(r.months[0].crmLeads).toBeNull();
    expect(r.months[0].cohortRoas).toBeNull();
    expect(r.months[0].lifecycle[0].count).toBeNull();
  });
});
