import { describe, expect, it } from "vitest";
import { normalizeCreditNoteDocuments } from "@/lib/accounting-policy";

type Row = {
  movement: string;
  isCreditNote: boolean;
  totalInCurrency: number;
  usdPaid: number;
  untaxedTotal: number;
  product?: string;
};

const SAR = 1 / 3.7453;
const line = (movement: string, sar: number, product: string, isCreditNote = true): Row => ({
  movement,
  isCreditNote,
  totalInCurrency: sar,
  usdPaid: sar * SAR,
  untaxedTotal: sar,
  product,
});

/**
 * RINVNT/2026/00002, read from Odoo on 2026-10-26:
 *   account.move.amount_total = 4,500.00 SAR = $1,201.51
 *   account.invoice.report lines, with their own signs:
 *     -2,000.00  [3]   Interior Design - 3ds Max - Event
 *     -2,000.00  [524] Interior Design Using SketchUp - Event
 *     -1,000.00  [5]   Interior Design - AutoCAD - Event
 *     -1,000.00  [340] Interior Design-Photoshop with AI-Event
 *       -300.00  [347] Interior Design-freelance &marketing
 *     +1,800.00  [330] 21.05% on specific products   <- discount given back
 *   net -4,500.00 SAR
 * Forcing every line negative reported -8,100.00 SAR = -$2,162.71, so the
 * discount was subtracted again instead of added back: $961.20 too much.
 */
const odooLines = [
  line("RINVNT/2026/00002", -2000, "[3] 3ds Max"),
  line("RINVNT/2026/00002", -2000, "[524] SketchUp"),
  line("RINVNT/2026/00002", -1000, "[5] AutoCAD"),
  line("RINVNT/2026/00002", -1000, "[340] Photoshop with AI"),
  line("RINVNT/2026/00002", -300, "[347] freelance & marketing"),
  line("RINVNT/2026/00002", 1800, "[330] 21.05% on specific products"),
];

const net = (rows: Row[], movement: string) =>
  rows.filter((r) => r.movement === movement).reduce((s, r) => s + r.totalInCurrency, 0);

describe("credit-note document signs", () => {
  it("matches Odoo's document total when lines already net negative", () => {
    const out = normalizeCreditNoteDocuments(odooLines);
    expect(net(out, "RINVNT/2026/00002")).toBeCloseTo(-4500, 6);
    // the discount line is still a positive give-back, not a second deduction
    expect(out.find((r) => r.product?.includes("21.05%"))!.totalInCurrency).toBe(1800);
  });

  it("anchors a document that arrives with every line negated", () => {
    const mirrored = odooLines.map((r) => ({
      ...r,
      totalInCurrency: -r.totalInCurrency,
      usdPaid: -r.usdPaid,
      untaxedTotal: -r.untaxedTotal,
    }));
    const out = normalizeCreditNoteDocuments(mirrored);
    expect(net(out, "RINVNT/2026/00002")).toBeCloseTo(-4500, 6);
    expect(out.reduce((s, r) => s + r.usdPaid, 0)).toBeCloseTo(-4500 * SAR, 6);
  });

  it("never reports more refund than the document is worth", () => {
    const out = normalizeCreditNoteDocuments(odooLines);
    const usd = out.reduce((s, r) => s + r.usdPaid, 0);
    expect(usd).toBeCloseTo(-1201.51, 2);
    expect(usd).toBeGreaterThan(-2162.71); // the figure the old per-line rule produced
  });

  it("leaves ordinary invoices alone, discount lines included", () => {
    // [330] "21.05% on specific products" is negative on a real invoice:
    // INVNT/2026/000157 line 187205 = -2,020.00 SAR.
    const invoice = [
      line("INVNT/2026/000157", 9600, "[109] PMP - Event", false),
      line("INVNT/2026/000157", -2020, "[330] 21.05% on specific products", false),
    ];
    expect(normalizeCreditNoteDocuments(invoice)).toEqual(invoice);
  });

  it("keeps documents independent of one another", () => {
    const mixed = [
      ...odooLines,
      // RINVNT/2026/00003: amount_total 500.00 SAR, lines -416.70 -250.02
      // -250.02 +416.70, arriving negated.
      line("RINVNT/2026/00003", 416.7, "[11] Revit Architecture"),
      line("RINVNT/2026/00003", 250.02, "[153] Architecture Workshop"),
      line("RINVNT/2026/00003", 250.02, "[13] Lumion"),
      line("RINVNT/2026/00003", -416.7, "[331] Architecture discount"),
    ];
    const out = normalizeCreditNoteDocuments(mixed);
    expect(net(out, "RINVNT/2026/00002")).toBeCloseTo(-4500, 6);
    expect(net(out, "RINVNT/2026/00003")).toBeCloseTo(-500.04, 6);
  });

  it("returns the same array when nothing needs anchoring", () => {
    expect(normalizeCreditNoteDocuments(odooLines)).toBe(odooLines);
  });
});
