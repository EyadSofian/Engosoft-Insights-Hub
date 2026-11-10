import { describe, expect, it } from "vitest";
import {
  analyzeMarketingCosts,
  phoneIdentity,
  type WaCostPoint,
  type BroadcastJob,
  type InvoiceFact,
} from "@/lib/marketing-costs";

const point: WaCostPoint = {
  accountId: "waba",
  date: "2026-10-01",
  phone: "966500000000",
  category: "MARKETING",
  pricingType: "REGULAR",
  currency: "USD",
  cost: 20,
  volume: 1000,
};
const job = (id: string, date: string, campaign = id): BroadcastJob => ({
  id,
  campaign,
  template: "t",
  category: "MARKETING",
  inboxId: "15",
  operator: "Operator",
  createdAt: date,
  status: "completed",
  total: 1,
  accepted: 1,
  errors: 0,
  skipped: 0,
  events: [
    {
      jobId: id,
      messageId: id,
      phone: "+966500000000",
      date,
      acceptedAt: `${date}T10:00:00Z`,
      timeBasis: "send_log",
    },
  ],
});
const invoice = (key: string, source = "Facebook", date = "2026-10-05"): InvoiceFact => ({
  key,
  movement: key,
  company: "KSA",
  invoiceDate: date,
  reportingDate: date,
  source,
  revenue: 100,
  creditNote: false,
  phones: ["+966500000000"],
});

describe("marketing and WhatsApp cost analysis", () => {
  it("keeps account cost separate from estimated campaign scenarios", () => {
    const a = analyzeMarketingCosts([point], [job("j", "2026-10-01")], []);
    expect(a.costUsd).toBe(20);
    expect(a.campaigns[0].estimatedUsd).toBe(0.02);
    expect(a.accepted).toBe(1);
    expect(a.volume).toBe(1000);
  });
  it("does not invent a USD conversion or a price for an unknown template category", () => {
    expect(analyzeMarketingCosts([{ ...point, currency: "SAR" }], [], []).costUsd).toBeNull();
    expect(
      analyzeMarketingCosts([point], [{ ...job("j", "2026-10-01"), category: "UNKNOWN" }], [])
        .campaigns[0].estimatedUsd,
    ).toBeNull();
  });
  it("preserves unusual provider service costs and raises a classification flag", () => {
    const a = analyzeMarketingCosts([{ ...point, category: "SERVICE", cost: 5 }], [], []);
    expect(a.costUsd).toBe(5);
    expect(a.serviceCostAnomaly).toBe(true);
  });
  it("deduplicates message evidence and allocates each invoice once to the latest preceding-day campaign", () => {
    const j = job("one", "2026-10-01");
    const a = analyzeMarketingCosts(
      [point],
      [j, j, job("two", "2026-10-03")],
      [invoice("INV"), invoice("INV")],
    );
    expect(a.accepted).toBe(2);
    expect(a.assistedRevenue).toBe(100);
    expect(a.assistedInvoices).toBe(1);
    expect(a.campaigns.find((c) => c.campaign === "one")?.assistedRevenue).toBe(0);
    expect(a.campaigns.find((c) => c.campaign === "two")?.assistedRevenue).toBe(100);
    expect(a.records[0].matchingCampaigns).toHaveLength(2);
  });
  it("does not double count direct Broadcast revenue as an extra assisted sale", () => {
    const a = analyzeMarketingCosts(
      [point],
      [job("one", "2026-10-01")],
      [
        invoice("a", "Whtsapp Broadcast"),
        { ...invoice("refund", "WhatsApp Broadcast"), creditNote: true, revenue: -20 },
      ],
    );
    expect(a.broadcastRevenue).toBe(80);
    expect(a.broadcastInvoices).toBe(1);
    expect(a.assistedRevenue).toBe(0);
    expect(a.campaigns[0].assistedInvoices).toBe(1);
  });
  it("separates same-day and post-invoice exposures from proven prior-day matching", () => {
    const a = analyzeMarketingCosts(
      [],
      [job("same", "2026-10-05"), job("later", "2026-10-07")],
      [invoice("INV")],
    );
    expect(a.assistedRevenue).toBe(0);
    expect(a.sameDay).toBe(1);
    expect(a.records[0].match).toBe("same_day_unknown_order");
  });
  it("requires a strong international identity and does not match countries on suffix alone", () => {
    expect(phoneIdentity("+966 50 000 0000")).toBe(phoneIdentity("00966500000000"));
    const a = analyzeMarketingCosts(
      [],
      [job("j", "2026-10-01")],
      [{ ...invoice("INV"), phones: ["+20500000000"] }],
    );
    expect(a.assistedRevenue).toBe(0);
    expect(
      analyzeMarketingCosts([], [], [{ ...invoice("INV"), phones: [] }]).records[0].match,
    ).toBe("phone_unavailable");
  });
});
