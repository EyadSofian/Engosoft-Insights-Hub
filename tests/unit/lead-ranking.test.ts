import { describe, expect, it } from "vitest";
import { buildLeadRankings, leadRankingWindow, nextDistributionMonth } from "@/lib/lead-ranking";
import type { AccountingRow, CrmLeadRow, LostRow } from "@/lib/types";

const lead = (over: Partial<CrmLeadRow> = {}) =>
  ({
    id: "1",
    salesperson: "Sara",
    salesTeam: "A",
    course: "Mech",
    courses: "HVAC",
    createdAt: "2026-04-01",
    wonDate: "2026-09-30",
    closedAt: "",
    isWon: true,
    ...over,
  }) as CrmLeadRow;
const sale = (over: Partial<AccountingRow> = {}) =>
  ({
    id: "line-1",
    salesperson: "Sara",
    salesTeam: "A",
    course: "Mech",
    product: "HVAC",
    company: "Egypt",
    usdPaid: 100,
    movement: "INV/1",
    isCreditNote: false,
    paymentDate: "2026-04-01",
    invoiceDate: "2026-03-01",
    ...over,
  }) as AccountingRow;
const build = (over: Partial<Parameters<typeof buildLeadRankings>[0]> = {}) =>
  buildLeadRankings({ month: "2026-10", crm: [lead()], lost: [], accounting: [sale()], ...over });
const specialty = (result: ReturnType<typeof build>, spec = "Mech") =>
  result.groups.find((group) => group.specialization === spec && group.course === null)!;

describe("distribution month", () => {
  it("uses six complete months, across year and leap-year boundaries", () => {
    expect(leadRankingWindow("2026-10")).toEqual({
      month: "2026-10",
      from: "2026-04-01",
      to: "2026-09-30",
    });
    expect(leadRankingWindow("2026-01")).toEqual({
      month: "2026-01",
      from: "2025-07-01",
      to: "2025-12-31",
    });
    expect(leadRankingWindow("2024-03").to).toBe("2024-02-29");
  });
  it("rejects invalid months", () => {
    for (const value of ["", "2026-13", "2026-1", "x", "0000-01", "2026-10-01"])
      expect(() => leadRankingWindow(value)).toThrow();
  });
  it("defaults to next month using Cairo, including its midnight boundary", () => {
    expect(nextDistributionMonth(new Date("2026-09-30T12:00:00Z"))).toBe("2026-10");
    expect(nextDistributionMonth(new Date("2026-09-30T22:00:00Z"))).toBe("2026-11");
    expect(nextDistributionMonth(new Date("2026-12-15T12:00:00Z"))).toBe("2027-01");
  });
});

describe("employee specialty ranking", () => {
  it("names months without source records rather than implying a complete six-month history", () => {
    expect(build().coverage).toEqual({
      expectedMonths: ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"],
      monthsWithoutLeads: ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"],
      monthsWithoutInvoices: ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"],
    });
  });
  it("keeps discounts in specialty net revenue without creating a discount course", () => {
    const result = build({
      accounting: [
        sale(),
        sale({ id: "discount", product: "[333] 53.33% on specific products", usdPaid: -10 }),
      ],
    });
    expect(specialty(result).rows[0].revenue).toBe(90);
    expect(
      result.groups.filter((group) => group.course !== null).map((group) => group.course),
    ).toEqual(["HVAC"]);
  });
  it("treats punctuation placeholders as missing specialties", () => {
    const result = build({ crm: [lead({ course: "." })], accounting: [sale({ course: "—" })] });
    expect(result.groups).toEqual([]);
    expect(result.diagnostics).toMatchObject({ unclassifiedLeads: 1, unclassifiedRevenue: 100 });
  });
  it("normalizes three measures in each specialty before applying 50/25/25", () => {
    const result = build({
      crm: [lead(), lead({ id: "2", isWon: false }), lead({ id: "3", salesperson: "Omar" })],
      accounting: [
        sale({ usdPaid: 200 }),
        sale({ id: "line-2", salesperson: "Omar", usdPaid: 100 }),
        sale({ id: "line-3", salesperson: "Omar", movement: "INV/2", usdPaid: 0 }),
      ],
    });
    const rows = specialty(result).rows;
    expect(rows.map((row) => [row.name, row.score, row.rank])).toEqual([
      ["Omar", 75, 1],
      ["Sara", 75, 1],
    ]);
    expect(rows.find((r) => r.name === "Sara")!.components).toEqual({
      revenue: 50,
      invoices: 12.5,
      conversion: 12.5,
    });
    expect(rows.find((r) => r.name === "Omar")!.conversionRate).toBe(100);
  });
  it("counts a multi-course invoice once at specialty level and in each course", () => {
    const first = sale({ usdPaid: 40 });
    const result = build({
      crm: [lead({ courses: "HVAC, Plumbing" })],
      accounting: [first, first, sale({ id: "line-2", product: "Plumbing", usdPaid: 60 })],
    });
    expect(specialty(result).rows[0]).toMatchObject({
      revenue: 100,
      invoices: 1,
      leads: 1,
      score: 100,
    });
    const products = result.groups.filter((group) => group.course !== null);
    expect(
      products.map((group) => [group.course, group.rows[0].invoices, group.rows[0].leads]),
    ).toEqual([
      ["HVAC", 1, 1],
      ["Plumbing", 1, 1],
    ]);
  });
  it("includes Lost in the denominator and deduplicates across CRM and Lost", () => {
    const lost = {
      ...lead({ id: "2", isWon: false }),
      businessStatus: "lost",
    } as unknown as LostRow;
    const result = build({ crm: [lead(), lead({ id: "2" })], lost: [lost, lost] });
    expect(specialty(result).rows[0]).toMatchObject({ leads: 2, won: 1, conversionRate: 50 });
  });
  it("uses payment date and reversal invoice date, excluding the target month", () => {
    const result = build({
      crm: [
        lead(),
        lead({ id: "late", createdAt: "2026-10-01" }),
        lead({ id: "old", createdAt: "2026-03-31" }),
      ],
      accounting: [
        sale(),
        sale({
          id: "refund",
          isCreditNote: true,
          usdPaid: -20,
          movement: "RINV/1",
          paymentDate: "2026-03-01",
          invoiceDate: "2026-09-30",
        }),
        sale({ id: "late", usdPaid: 9999, paymentDate: "2026-10-01" }),
      ],
    });
    expect(specialty(result).rows[0]).toMatchObject({ revenue: 80, invoices: 1, leads: 1 });
  });
  it("does not credit a win after the cutoff, and withholds scores for undated wins", () => {
    const future = build({ crm: [lead({ wonDate: "2026-10-01" })] });
    expect(specialty(future).rows[0]).toMatchObject({ won: 0, conversionRate: 0, score: 75 });
    const undated = build({ crm: [lead({ wonDate: "", closedAt: "" })] });
    expect(specialty(undated).rows[0]).toMatchObject({
      undatedWon: 1,
      conversionRate: null,
      score: null,
      rank: null,
    });
  });
  it("does not invent conversion from invoices or missing Lost", () => {
    expect(specialty(build({ crm: [] })).rows[0]).toMatchObject({
      conversionRate: null,
      score: null,
      rank: null,
    });
    expect(specialty(build({ conversionAvailable: false })).rows[0].score).toBeNull();
  });
  it("preserves zero performers and prevents negative or nonfinite scores", () => {
    expect(
      specialty(build({ accounting: [], crm: [lead({ isWon: false })] })).rows[0],
    ).toMatchObject({ score: 0, rank: 1 });
    expect(specialty(build({ accounting: [sale({ usdPaid: -100 })] })).rows[0].score).toBe(50);
    expect(specialty(build({ accounting: [sale({ usdPaid: NaN })] })).rows[0].score).toBe(50);
  });
  it("never pools specialty benchmarks and canonicalizes explicit aliases", () => {
    const result = build({
      crm: [lead(), lead({ id: "2", course: "PMP" }), lead({ id: "3", course: "Maint" })],
      accounting: [
        sale(),
        sale({ id: "2", course: "PMP", usdPaid: 100000 }),
        sale({ id: "3", course: "CMRP" }),
      ],
    });
    expect(
      result.groups
        .filter((group) => group.course === null)
        .map((g) => [g.specialization, g.rows[0].score]),
    ).toEqual([
      ["CMRP", 100],
      ["Mech", 100],
      ["PMP", 100],
    ]);
  });
  it("merges declared employee identities across teams without truncating names", () => {
    const result = build({
      crm: [
        lead({ salesperson: "Sara Login" }),
        lead({ id: "2", salesperson: "Sara HR", salesTeam: "B" }),
      ],
      accounting: [sale()],
      identity: () => ({ key: "user:7", name: "Sara Legal Name" }),
    });
    expect(specialty(result).rows).toHaveLength(1);
    expect(specialty(result).rows[0]).toMatchObject({
      name: "Sara Legal Name",
      teams: ["A", "B"],
      leads: 2,
    });
  });
  it("matches whole course names including commas and does not guess partial names", () => {
    const result = build({
      crm: [lead({ courses: "HVAC, Advanced, Plumbing" }), lead({ id: "2", courses: "Advanced" })],
      accounting: [sale({ product: "HVAC, Advanced" }), sale({ id: "2", product: "Plumbing" })],
    });
    expect(result.groups.find((g) => g.course === "HVAC, Advanced")!.rows[0].leads).toBe(1);
    expect(specialty(result).rows[0].leads).toBe(2);
    expect(result.diagnostics.unmatchedCourseLeads).toBe(1);
  });
  it("counts invoice identity separately by company", () => {
    expect(
      specialty(build({ accounting: [sale(), sale({ id: "2", company: "KSA" })] })).rows[0]
        .invoices,
    ).toBe(2);
  });
  it("reports unattributed rows and withholds only affected missing-invoice ranks", () => {
    const result = build({
      crm: [lead(), lead({ id: "2", salesperson: "Omar" }), lead({ id: "3", salesperson: "" })],
      accounting: [
        sale({ movement: "" }),
        sale({ id: "2", salesperson: "Omar" }),
        sale({ id: "3", course: "" }),
        sale({ id: "4", salesperson: "" }),
      ],
    });
    expect(result.diagnostics).toMatchObject({
      unassignedLeads: 1,
      unassignedRevenue: 100,
      unclassifiedRevenue: 100,
      missingInvoiceIds: 1,
    });
    expect(specialty(result).rows.find((r) => r.name === "Sara")!.score).toBeNull();
    expect(specialty(result).rows.find((r) => r.name === "Omar")!.rank).toBe(1);
  });
  it("does not discard missing lead IDs and still issue an inflated rank", () => {
    expect(
      specialty(build({ crm: [lead(), lead({ id: "", isWon: false })] })).rows[0].rank,
    ).toBeNull();
  });
});
