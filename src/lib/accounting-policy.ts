import type { AccountingRow } from "./types";

export type AccountingDateBasis = "payment" | "invoice";

/**
 * Paid invoices follow the selected basis. Odoo customer credit notes are
 * recognised on their reversal (Invoice) Date so a later cancellation reduces
 * the month in which it was actually cancelled, not the original sale month.
 */
export function accountingReportingDate(
  row: Pick<AccountingRow, "invoiceDate" | "paymentDate" | "isCreditNote">,
  dateBasis: AccountingDateBasis,
): string {
  if (row.isCreditNote) return row.invoiceDate || row.paymentDate;
  return dateBasis === "invoice" ? row.invoiceDate : row.paymentDate;
}

interface CreditNoteAmounts {
  movement: string;
  isCreditNote: boolean;
  totalInCurrency: number;
  usdPaid: number;
  untaxedTotal: number;
}

/**
 * Anchor every credit note to the value of its own Odoo document.
 *
 * A credit note's lines are not all negative. Reversing an invoice that
 * carried a discount produces a positive line, because the discount is being
 * given back. Forcing each line negative — which `-Math.abs(value)` per line
 * did — subtracted that discount a second time instead of adding it back.
 *
 * Live evidence, read from Odoo on 2026-10-26:
 *
 *   RINVNT/2026/00002  account.move.amount_total  4,500.00 SAR = $1,201.51
 *     report lines: -2,000  -1,000  -300  +1,800  -1,000  -2,000  (net -4,500)
 *     stored as:    -2,000  -1,000  -300  -1,800  -1,000  -2,000  (net -8,100)
 *     over-subtracted by 3,600 SAR = $961.20
 *
 *   RINVNT/2026/00003  amount_total 500.00 SAR = $133.50
 *     report lines: -416.70  -250.02  -250.02  +416.70  (net -500.04)
 *     stored as:    -416.70  -250.02  -250.02  -416.70  (net -1,333.44)
 *     over-subtracted by 833.40 SAR = $222.52
 *
 * February 2026 credit notes are worth $1,976.28 in Odoo and were reported as
 * $3,159.56, which is why the management overview read $1,717.77 below Odoo.
 *
 * The feed's absolute sign convention is not guaranteed — the same document
 * could arrive with every line negated — so this keeps the relative signs
 * inside a document and only anchors the document's net to a reduction. A
 * document whose lines already net negative is left exactly as it is.
 *
 * This must run over a complete snapshot, before any date window is applied:
 * the net of a partial document says nothing about its direction.
 */
export function normalizeCreditNoteDocuments<T extends CreditNoteAmounts>(rows: T[]): T[] {
  const netByMovement = new Map<string, number>();
  for (const row of rows) {
    if (!row.isCreditNote || !row.movement) continue;
    netByMovement.set(row.movement, (netByMovement.get(row.movement) ?? 0) + row.usdPaid);
  }
  const flip = new Set(
    [...netByMovement].filter(([, net]) => net > 0).map(([movement]) => movement),
  );
  if (flip.size === 0) return rows;
  return rows.map((row) =>
    row.isCreditNote && flip.has(row.movement)
      ? {
          ...row,
          totalInCurrency: -row.totalInCurrency,
          usdPaid: -row.usdPaid,
          untaxedTotal: -row.untaxedTotal,
        }
      : row,
  );
}
