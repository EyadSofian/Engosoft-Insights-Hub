import { describe, expect, it } from "vitest";
import { buildEntryMonthCohorts, type CohortInvoiceLine } from "@/lib/revenue-cohort";

const line = (over: Partial<CohortInvoiceLine>): CohortInvoiceLine => ({
  orderRef: "S1",
  movement: "INV/1",
  usdPaid: 100,
  paymentDate: "2026-09-10",
  invoiceDate: "2026-09-09",
  isCreditNote: false,
  ...over,
});

const leads = [
  { id: "1", createdAt: "2026-07-05", won: true },
  { id: "2", createdAt: "2026-07-20", won: false },
  { id: "3", createdAt: "2026-08-02", won: true },
  { id: "4", createdAt: "2026-08-15", won: false },
  { id: "9", createdAt: "2026-05-01", won: true },
];

const links = [
  { orderName: "S1", opportunityId: "1" },
  { orderName: "S1b", opportunityId: "1" },
  { orderName: "S3", opportunityId: "3" },
  { orderName: "S9", opportunityId: "9" },
  { orderName: "S-GHOST", opportunityId: "777" },
  { orderName: "S-AMBIG", opportunityId: "2" },
  { orderName: "S-AMBIG", opportunityId: "4" },
];

const lines = [
  // Lead 1 (July): two invoices, one paid in September, and a partial credit note.
  line({ orderRef: "S1", movement: "INV/1", usdPaid: 300, paymentDate: "2026-07-25" }),
  line({ orderRef: "S1b", movement: "INV/2", usdPaid: 200, paymentDate: "2026-09-03" }),
  line({
    orderRef: "S1",
    movement: "RINV/1",
    usdPaid: -50,
    paymentDate: "",
    invoiceDate: "2026-09-05",
    isCreditNote: true,
  }),
  // Lead 3 (August): paid in September.
  line({ orderRef: "S3", movement: "INV/3", usdPaid: 400, paymentDate: "2026-09-01" }),
  // Lead 9 (May, outside the window).
  line({ orderRef: "S9", movement: "INV/9", usdPaid: 70, paymentDate: "2026-08-01" }),
  // Linked to an opportunity the CRM population does not hold.
  line({ orderRef: "S-GHOST", movement: "INV/7", usdPaid: 25, paymentDate: "2026-08-10" }),
  // One order name pointing at two opportunities is not deterministic.
  line({ orderRef: "S-AMBIG", movement: "INV/8", usdPaid: 60, paymentDate: "2026-08-11" }),
  // No sale order at all.
  line({ orderRef: "", movement: "INV/10", usdPaid: 90, paymentDate: "2026-08-12" }),
  // Paid after the as-of date: not revenue yet.
  line({ orderRef: "S3", movement: "INV/11", usdPaid: 999, paymentDate: "2026-10-01" }),
];

const result = buildEntryMonthCohorts({
  leads,
  lines,
  links,
  window: { from: "2026-07-01", to: "2026-08-31" },
  asOf: "2026-09-15",
});

describe("accounting entry-month cohorts", () => {
  it("credits revenue to the month the CRM record entered, whatever the payment date", () => {
    const july = result.rows.find((row) => row.entryMonth === "2026-07")!;
    const august = result.rows.find((row) => row.entryMonth === "2026-08")!;
    expect(july.paidRevenue).toBe(450);
    expect(august.paidRevenue).toBe(400);
    expect(result.rows.map((row) => row.entryMonth)).toEqual(["2026-07", "2026-08"]);
  });

  it("counts unique leads, won, paying customers and distinct paid invoices per cohort", () => {
    const july = result.rows.find((row) => row.entryMonth === "2026-07")!;
    expect(july).toMatchObject({
      uniqueLeads: 2,
      won: 1,
      customersWithPaidInvoice: 1,
      distinctPaidInvoices: 2,
      creditNotes: 1,
    });
    expect(july.invoiceConversionRate).toBe(50);
    expect(july.averagePaidRevenuePerCustomer).toBe(450);
    expect(july.averageDaysToFirstInvoice).toBe(20);
  });

  it("never uses a non-deterministic link", () => {
    const july = result.rows.find((row) => row.entryMonth === "2026-07")!;
    const august = result.rows.find((row) => row.entryMonth === "2026-08")!;
    expect(july.customersWithPaidInvoice + august.customersWithPaidInvoice).toBe(2);
  });

  it("reconciles every Accounting line up to the as-of date", () => {
    const r = result.reconciliation;
    // 300 + 200 − 50 + 400 + 70 + 25 + 60 + 90; the 999 line is paid after the as-of date.
    expect(r.totalAccountingRevenue).toBe(1_095);
    expect(r.cohortRevenue).toBe(850);
    expect(r.otherCohortsRevenue).toBe(70);
    expect(r.linkedUnknownCrmRevenue).toBe(25);
    expect(r.unlinkedRevenue).toBe(150);
    expect(
      Math.round(
        (r.cohortRevenue + r.otherCohortsRevenue + r.linkedUnknownCrmRevenue + r.unlinkedRevenue) *
          100,
      ) / 100,
    ).toBe(r.totalAccountingRevenue);
    expect(result.totals.paidRevenue).toBe(r.cohortRevenue);
  });

  it("differs from payment-date collections for the same month", () => {
    // Revenue collected in September (payment date) comes from July and August entrants,
    // while no September cohort exists in the window at all.
    const septemberCollections = lines
      .filter((row) => (row.isCreditNote ? row.invoiceDate : row.paymentDate).startsWith("2026-09"))
      .reduce((sum, row) => sum + row.usdPaid, 0);
    expect(septemberCollections).toBe(550);
    expect(result.rows.some((row) => row.entryMonth === "2026-09")).toBe(false);
  });
});
