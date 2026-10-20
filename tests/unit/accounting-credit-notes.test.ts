import { describe, expect, it } from "vitest";
import { reconcileCreditNotes } from "@/lib/accounting-credit-notes.server";
import type { AccountingRow } from "@/lib/types";

type Move = Parameters<typeof reconcileCreditNotes>[1][number];
type Line = Parameters<typeof reconcileCreditNotes>[2][number];

const posted = {
  id: 65206,
  name: "RINVNT/2026/00020",
  invoice_date: "2026-10-11",
  state: "posted",
  move_type: "out_refund",
  amount_total: 2500.79,
  amount_untaxed: 2174.6,
  currency_id: [149, "SAR"],
  company_id: [3, "Engosoft - KSA"],
  partner_id: [10, "Customer"],
} as Move;

const lines = [
  {
    id: 237221,
    move_id: [65206, "RINVNT/2026/00020"],
    product_id: [2019, "The Freelance Masterclass"],
    product_categ_id: [1, "Other Revenue"],
    quantity: -1,
    price_total: -500,
    price_subtotal: -450,
  },
  {
    id: 237222,
    move_id: [65206, "RINVNT/2026/00020"],
    product_id: [1320, "Interior Design"],
    product_categ_id: [2, "Interior"],
    quantity: -1,
    price_total: -2000.79,
    price_subtotal: -1724.6,
  },
] as Line[];

describe("posted Odoo credit notes", () => {
  it("adds a missing note once at line grain and reconciles to the move total", () => {
    const result = reconcileCreditNotes(
      [],
      [posted],
      lines,
      { EGP: 50.5, SAR: 3.7453 },
      "https://engosoft.com",
    );
    expect(result.reconciliation.status).toBe("live");
    expect(result.reconciliation.addedDocuments).toBe(1);
    expect(result.reconciliation.documents[0].invoiceDate).toBe("2026-10-11");
    expect(result.reconciliation.documents[0].odooUrl).toContain("id=65206");
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((row) => row.isCreditNote && row.invoiceDate === "2026-10-11")).toBe(
      true,
    );
    expect(result.rows.reduce((sum, row) => sum + row.totalInCurrency, 0)).toBeCloseTo(-2500.79);
    expect(result.rows.reduce((sum, row) => sum + row.usdPaid, 0)).toBeCloseTo(-2500.79 / 3.7453);
  });

  it("does not duplicate synced notes or include cancelled documents", () => {
    const existing = [{ movement: posted.name, isCreditNote: true }] as AccountingRow[];
    const cancelled = { ...posted, id: 65207, name: "RINVNT/2026/00021", state: "cancel" } as Move;
    const result = reconcileCreditNotes(
      existing,
      [posted, cancelled],
      lines,
      { EGP: 50.5, SAR: 3.7453 },
      "https://engosoft.com",
    );
    expect(result.rows).toHaveLength(1);
    expect(result.reconciliation.documents).toHaveLength(1);
    expect(result.reconciliation.documents[0].inAccountingSnapshot).toBe(true);
    expect(result.reconciliation.addedDocuments).toBe(0);
  });

  it("lists unsupported-currency notes without inventing a USD amount", () => {
    const kwd = { ...posted, currency_id: [150, "KWD"] } as Move;
    const result = reconcileCreditNotes(
      [],
      [kwd],
      [],
      { EGP: 50.5, SAR: 3.7453 },
      "https://engosoft.com",
    );
    expect(result.reconciliation.documents).toHaveLength(1);
    expect(result.reconciliation.unsupportedCurrencies).toEqual(["KWD"]);
    expect(result.rows).toHaveLength(0);
  });
});
