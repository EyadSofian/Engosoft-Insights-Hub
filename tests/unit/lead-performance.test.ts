import { describe, expect, it } from "vitest";
import {
  buildLeadPerformance,
  sixCalendarMonths,
  type PerformanceLead,
} from "@/lib/lead-performance";

const lead = (
  id: string,
  createdAt: string,
  patch: Partial<PerformanceLead> = {},
): PerformanceLead => ({
  id,
  createdAt,
  recordType: "lead",
  status: "lead",
  source: "Facebook",
  leadSegment: "",
  course: "CFM",
  campaign: "cfm-sayed",
  salesperson: "Sales A",
  phone: "",
  mobile: "",
  email: "",
  lossReason: "",
  ...patch,
});

const base = () => ({
  asOf: "2026-10-23",
  selectedMonth: "2026-05",
  course: "",
  linksAvailable: true,
  leads: [
    lead("1", "2026-05-03", { recordType: "opportunity", status: "won", phone: "+966500000001" }),
    lead("2", "2026-05-09", { status: "lost", phone: "+966500000001", lossReason: "No Answer" }),
    lead("3", "2026-06-02", { phone: "+966500000001" }),
    lead("4", "2026-05-14", { source: "Facebook", leadSegment: "WhatsApp Broadcast" }),
    lead("5", "2026-05-15", { source: "Recommendation" }),
    lead("6", "2026-10-03", { phone: "+966500000006", campaign: "cfm-shazly" }),
  ],
  invoices: [
    { orderRef: "S1", date: "2026-06-02", usdPaid: 100, salesperson: "Closer A" },
    { orderRef: "S1", date: "2026-07-02", usdPaid: -30, salesperson: "Closer A" },
    { orderRef: "S6", date: "2026-10-05", usdPaid: 50, salesperson: "Closer B" },
    { orderRef: "S6", date: "2026-10-06", usdPaid: -50, salesperson: "Closer B" },
    { orderRef: "UNLINKED", date: "2026-06-07", usdPaid: 999, salesperson: "Closer C" },
  ],
  links: [
    { orderName: "S1", opportunityId: "1" },
    { orderName: "S6", opportunityId: "6" },
  ],
  qa: [{ id: "2", verdict: "invalid" as const, reason: "Wrong phone number" }],
  calls: [{ phone: "+966500000006", day: "2026-10-04", totalCalls: 2 }],
});

describe("six-month lead performance", () => {
  it("uses calendar creation cohorts and excludes broadcast/recommendation even under Facebook", () => {
    expect(sixCalendarMonths("2026-10-23")).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    const result = buildLeadPerformance(base());
    expect(result.selected.leads).toBe(2);
    expect(result.coverage.excludedBroadcast).toBe(1);
    expect(result.coverage.excludedRecommendation).toBe(1);
    expect(result.records.map((row) => row.id)).toEqual(["1", "2"]);
    expect(result.selected.duplicateSameMonth).toBe(1);
    expect(result.rows[1]?.duplicateEarlierMonth).toBe(1);
  });

  it("excludes misspelled WhatsApp and AutoDialer broadcasts without dropping identity duplicates", () => {
    const result = buildLeadPerformance({
      ...base(),
      leads: [
        lead("first", "2026-05-02", { phone: "+966500000001" }),
        lead("repeat", "2026-05-03", { phone: "+966500000001" }),
        lead("broadcast-typo", "2026-05-04", { source: "Whtsapp Broadcast" }),
        lead("autodialer", "2026-05-05", { source: "AutoDailer Broadcast" }),
      ],
      invoices: [],
      links: [],
      calls: null,
    });
    expect(result.selected.leads).toBe(2);
    expect(result.selected.duplicateSameMonth).toBe(1);
    expect(result.records.map((row) => row.id)).toEqual(["first", "repeat"]);
    expect(result.coverage.excludedBroadcast).toBe(1);
    expect(result.coverage.excludedAutodialerBroadcast).toBe(1);
  });

  it("separates same-entry-month verified Lost and paid conversion from outcomes that happened later", () => {
    const result = buildLeadPerformance({
      ...base(),
      leads: [
        lead("same-lost", "2026-05-02", {
          status: "lost",
          lostAt: "2026-05-20",
          lostAtBasis: "date_closed",
        }),
        lead("later-lost", "2026-05-03", {
          status: "lost",
          lostAt: "2026-06-02",
          lostAtBasis: "date_closed",
        }),
        lead("fallback-lost", "2026-05-04", {
          status: "lost",
          lostAt: "2026-05-19",
          lostAtBasis: "write_date_fallback",
        }),
        lead("paid-now", "2026-05-05", { recordType: "opportunity" }),
        lead("paid-later", "2026-05-06", { recordType: "opportunity" }),
      ],
      links: [
        { orderName: "S-NOW", opportunityId: "paid-now" },
        { orderName: "S-LATER", opportunityId: "paid-later" },
      ],
      invoices: [
        { orderRef: "S-NOW", date: "2026-05-12", usdPaid: 100, salesperson: "A" },
        { orderRef: "S-LATER", date: "2026-06-12", usdPaid: 100, salesperson: "A" },
      ],
      calls: null,
    });
    expect(result.selected.lost).toBe(3);
    expect(result.selected.lostSameEntryMonth).toBe(1);
    expect(result.selected.lostTimingUnverified).toBe(1);
    expect(result.selected.paidLeads).toBe(2);
    expect(result.selected.paidSameEntryMonth).toBe(1);
    expect(result.selected.paidSameEntryMonthRate).toBe(20);
    expect(result.rows[0]?.calendarLost).toBe(1);
    expect(result.rows[1]?.calendarLost).toBe(1);
    expect(result.rows[1]?.calendarLostOlderEntry).toBe(1);
    expect(result.rows[1]?.calendarPaid).toBe(1);
    expect(result.rows[1]?.calendarPaidOlderEntry).toBe(1);
  });

  it("keeps the entry cohort distinct from the current Fresh tag and emits auditable records", () => {
    const result = buildLeadPerformance({
      ...base(),
      leads: [
        lead("fresh", "2026-05-03", { leadSegment: "Fresh", phone: "+966500000001" }),
        lead("blank", "2026-05-04", { leadSegment: "", phone: "+966500000002" }),
      ],
      invoices: [],
      links: [],
      calls: [{ phone: "+966500000001", day: "2026-05-03", totalCalls: 2 }],
    });
    expect(result.selected.leads).toBe(2);
    expect(result.selected.freshTagged).toBe(1);
    expect(result.selected.segmentMissing).toBe(1);
    expect(result.records).toHaveLength(2);
    expect(result.records.find((row) => row.id === "fresh")?.attempts).toBe(2);
    expect(result.records.find((row) => row.id === "blank")?.leadSegment).toBe("");
    expect("phone" in result.records[0]!).toBe(false);
    expect("email" in result.records[0]!).toBe(false);
  });

  it("does not equate Fresh segment with an active untouched lead and reports the closing channel separately", () => {
    const result = buildLeadPerformance({
      ...base(),
      leads: [
        lead("fresh-open", "2026-05-02", {
          recordType: "opportunity",
          status: "open",
          leadSegment: "Fresh",
        }),
        lead("fresh-won", "2026-05-03", {
          recordType: "opportunity",
          status: "won",
          leadSegment: "Fresh",
          closingChannel: "Phone",
        }),
        lead("active-lead", "2026-05-04", { leadSegment: "" }),
      ],
      invoices: [],
      links: [],
      calls: null,
    });
    expect(result.selected.freshTagged).toBe(2);
    expect(
      result.records.filter((row) => row.recordType === "lead" && row.status === "lead"),
    ).toHaveLength(1);
    expect(result.byClosingChannel.map((row) => [row.name, row.crmWon])).toEqual([["Phone", 1]]);
  });

  it("counts only positive-net exact-linked orders and attributes later payments to the entry month", () => {
    const result = buildLeadPerformance(base());
    expect(result.selected.paidLeads).toBe(1);
    expect(result.selected.paidOrders).toBe(1);
    expect(result.selected.paidRevenue).toBe(70);
    expect(result.selected.paidLater).toBe(1);
    expect(result.selected.conversionRate).toBe(50);
    expect(result.rows[5]?.paidLeads).toBe(0); // S6 was fully refunded.
    expect(result.coverage.unlinkedAccountingLines).toBe(1);
    expect(result.bySalesCloser[0]?.name).toBe("Closer A");
  });

  it("audits invoice linkage only inside the six-month report window, not the 2025 archive", () => {
    const result = buildLeadPerformance({
      ...base(),
      invoices: [
        ...base().invoices,
        { movement: "OLD", orderRef: "", date: "2025-10-01", usdPaid: 50, salesperson: "" },
        {
          movement: "INV-1",
          orderRef: "S1",
          date: "2026-06-03",
          usdPaid: 20,
          salesperson: "Closer A",
        },
        {
          movement: "INV-1",
          orderRef: "S1",
          date: "2026-06-03",
          usdPaid: 10,
          salesperson: "Closer A",
        },
        {
          movement: "INV-2",
          orderRef: "",
          date: "2026-06-04",
          usdPaid: 10,
          salesperson: "Closer C",
        },
      ],
    });
    expect(result.coverage.linkedAccountingLines).toBe(6);
    expect(result.coverage.unlinkedAccountingLines).toBe(2);
    expect(result.coverage.linkedAccountingInvoices).toBe(5);
    expect(result.coverage.unlinkedAccountingInvoices).toBe(2);
    expect(result.coverage.unlinkedWithSellerLines).toBe(2);
  });

  it("does not misallocate PBX calls across leads sharing a phone and keeps loss reasons within Lost", () => {
    const result = buildLeadPerformance({ ...base(), selectedMonth: "2026-10" });
    expect(result.selected.contact2).toBe(1);
    expect(result.selected.averageDaysToFirstCall).toBe(1);
    expect(result.selected.callMatchable).toBe(1);
    const may = buildLeadPerformance(base());
    expect(may.selected.callMatchable).toBe(0);
    expect(may.selected.noAnswer).toBe(1);
    expect(may.selected.lost).toBe(1);
    expect(may.selected.unqualified).toBe(1);
    expect(may.unqualifiedReasons.find((row) => row.category === "customer_data")?.count).toBe(1);
  });

  it("matches PBX trunk-normalized digits to one unique CRM phone without guessing shared owners", () => {
    const result = buildLeadPerformance({
      ...base(),
      leads: [lead("only", "2026-10-03", { phone: "+966500000006" })],
      invoices: [],
      links: [],
      calls: [{ phone: "6500000006", day: "2026-10-04", totalCalls: 3 }],
      selectedMonth: "2026-10",
    });
    expect(result.selected.contact3Plus).toBe(1);
    expect(result.selected.averageAttempts).toBe(3);
  });

  it("does not call a next-day contact within 24 hours without exact timestamps", () => {
    const result = buildLeadPerformance({
      ...base(),
      leads: [lead("only", "2026-10-03", { phone: "+966500000006" })],
      invoices: [],
      links: [],
      calls: [{ phone: "+966500000006", day: "2026-10-04", totalCalls: 1 }],
      selectedMonth: "2026-10",
    });
    expect(result.selected.contacted).toBe(1);
    expect(result.selected.contactedWithin24h).toBe(0);
    expect(result.selected.exactLagSample).toBe(0);
  });

  it("rates each funnel stage against the stage before it, over the base that stage can see", () => {
    const result = buildLeadPerformance({ ...base(), selectedMonth: "2026-10" });
    const stage = (key: string) => result.stages.find((row) => row.key === key)!;
    expect(stage("entered").count).toBe(1);
    expect(stage("contacted").count).toBe(1);
    // One of one matchable lead was called: a step rate over entries would be
    // identical here, but over an unmatchable cohort it would invent a failure.
    expect(stage("contacted").stepRate).toBe(100);
    expect(result.selected.contactedWithin24h).toBe(0);
    // S6 was fully refunded, so the paid stage is honestly zero, not hidden.
    expect(stage("paid").count).toBe(0);
    expect(stage("paid").shareOfEntries).toBe(0);
    // The opportunity step is today's status, never a logged transition.
    expect(stage("opportunity").evidenced).toBe(false);
    expect(stage("opportunity").stepRate).toBeNull();
    expect(stage("paid").stepRate).toBeNull();
  });

  it("withholds the contacted stage instead of reading missing calls as nobody called", () => {
    const result = buildLeadPerformance({ ...base(), calls: null, selectedMonth: "2026-10" });
    const contacted = result.stages.find((row) => row.key === "contacted")!;
    expect(result.selected.contacted).toBeNull();
    expect(contacted.count).toBeNull();
    expect(contacted.shareOfEntries).toBeNull();
    expect(contacted.stepRate).toBeNull();
    expect(contacted.evidenced).toBe(false);
  });

  it("carries contact evidence into every breakdown dimension, not only the month total", () => {
    const result = buildLeadPerformance({ ...base(), selectedMonth: "2026-10" });
    const campaign = result.byCampaign.find((row) => row.name === "cfm-shazly")!;
    expect(campaign.averageAttempts).toBe(2);
    expect(campaign.contacted).toBe(1);
    const owner = result.bySalesOwner.find((row) => row.name === "Sales A")!;
    expect(owner.averageDaysToFirstCall).toBe(1);
  });

  it("reports unavailable evidence as unavailable, not as zero", () => {
    const result = buildLeadPerformance({
      ...base(),
      calls: null,
      links: [],
      linksAvailable: false,
    });
    expect(result.selected.contact0).toBeNull();
    expect(result.selected.averageAttempts).toBeNull();
    expect(result.coverage.linksAvailable).toBe(false);
  });
});
