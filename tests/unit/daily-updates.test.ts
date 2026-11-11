import { describe, it, expect } from "vitest";
import {
  buildDailyUpdates,
  validDailyDate,
  type DailyEntry,
  type DailyPayment,
} from "@/lib/daily-updates";
const day = "2026-11-11";
const availability = {
  crm: true,
  lost: true,
  revenue: true,
  links: true,
  daySpend: true,
  monthSpend: true,
};
const entry = (id: string, patch: Partial<DailyEntry> = {}): DailyEntry => ({
  id,
  course: "CFM",
  createdAt: day,
  status: "open",
  recordType: "opportunity",
  source: "Facebook",
  segment: "Fresh",
  name: id,
  url: "https://example.test",
  campaign: "CFM-ad",
  ...patch,
});
const payment = (patch: Partial<DailyPayment> = {}): DailyPayment => ({
  course: "CFM",
  company: "KSA",
  order: "S1",
  leadId: "1",
  date: day,
  amount: 100,
  invoice: "INV1",
  ...patch,
});
const base = () => ({
  day,
  availability,
  entries: [entry("1")],
  losses: [],
  payments: [],
  spend: [],
});
describe("daily course brief", () => {
  it("keeps creation cohorts separate from older-created daily loss movements", () => {
    const r = buildDailyUpdates({
      ...base(),
      losses: [
        {
          id: "old",
          course: "CFM",
          date: day,
          recordType: "lead",
          source: "Facebook",
          segment: "",
          name: "old",
          url: "",
        },
      ],
    });
    expect(r.totals.leadsDay).toBe(1);
    expect(r.totals.lostDay).toBe(1);
    expect(r.totals.cohortLostRate).toBe(0);
    expect(r.totals.lostLeadsDay).toBe(1);
  });
  it("counts IDs once and excludes broadcast/recommendation even under a Facebook source", () => {
    const r = buildDailyUpdates({
      ...base(),
      entries: [
        entry("1"),
        entry("1"),
        entry("2", { segment: "WhatsApp Broadcast" }),
        entry("3", { source: "Recommendation" }),
        entry("4", { source: "AutoDialer Broadcast" }),
      ],
    });
    expect(r.totals.leadsDay).toBe(1);
  });
  it("counts paid conversions by exact lead/order link, not invoices or old-lead receipts", () => {
    const r = buildDailyUpdates({
      ...base(),
      entries: [entry("1"), entry("2")],
      payments: [
        payment(),
        payment({ invoice: "INV2", amount: 50 }),
        payment({ order: "S2", leadId: "old", amount: 200 }),
      ],
    });
    expect(r.totals.paidDayCohort).toBe(1);
    expect(r.totals.conversionDay).toBe(0.5);
    expect(r.totals.revenueDay).toBe(350);
    expect(r.totals.invoicesDay).toBe(2);
  });
  it("fully refunded registrations do not count, and companies scope order references", () => {
    const r = buildDailyUpdates({
      ...base(),
      payments: [
        payment(),
        payment({ amount: -100, invoice: "RINV" }),
        payment({ company: "Egypt", leadId: "2", amount: 200 }),
      ],
    });
    expect(r.totals.paidDayCohort).toBe(0);
    expect(r.totals.revenueDay).toBe(200);
  });
  it("day and month-to-date have different cohorts, and future dates stay out", () => {
    const r = buildDailyUpdates({
      ...base(),
      entries: [
        entry("1"),
        entry("2", { createdAt: "2026-11-03" }),
        entry("3", { createdAt: "2026-11-12" }),
      ],
      payments: [payment({ leadId: "2" }), payment({ leadId: "1", date: "2026-11-12" })],
    });
    expect(r.totals.leadsDay).toBe(1);
    expect(r.totals.leadsMonth).toBe(2);
    expect(r.totals.conversionDay).toBe(0);
    expect(r.totals.conversionMonth).toBe(0.5);
  });
  it("null means missing, zero means observed zero and empty ratios are not zero", () => {
    const r = buildDailyUpdates({
      ...base(),
      availability: { ...availability, crm: false, lost: false, links: false, daySpend: false },
    });
    expect(r.totals.leadsDay).toBeNull();
    expect(r.totals.lostDay).toBeNull();
    expect(r.totals.conversionDay).toBeNull();
    expect(r.totals.roasDay).toBeNull();
    expect(r.totals.revenueDay).toBe(0);
    expect(buildDailyUpdates({ ...base(), entries: [] }).totals.conversionDay).toBeNull();
  });
  it("includes spend-only and uncategorized courses without silently dropping money", () => {
    const r = buildDailyUpdates({
      ...base(),
      payments: [payment({ course: "", leadId: "" })],
      spend: [
        {
          course: "PMP",
          campaign: "PMP-ad",
          campaignKey: "id:1",
          platform: "meta",
          date: day,
          spend: 30,
          attribution: "campaign_name",
        },
      ],
    });
    expect(r.rows.some((r) => r.course === "PMP")).toBe(true);
    expect(r.rows.reduce((s, r) => s + (r.revenueDay || 0), 0)).toBe(r.totals.revenueDay);
    expect(r.rows.reduce((s, r) => s + (r.spendDay || 0), 0)).toBe(30);
  });
  it("only accepts real past/current ISO dates", () => {
    expect(validDailyDate("2026-02-30", day)).toBe(false);
    expect(validDailyDate("2026-11-12", day)).toBe(false);
    expect(validDailyDate(day, day)).toBe(true);
  });
});
