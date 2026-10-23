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
    expect(result.selected.duplicateSameMonth).toBe(1);
    expect(result.rows[1]?.duplicateEarlierMonth).toBe(1);
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
