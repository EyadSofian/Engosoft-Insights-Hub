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

export function signedCreditAmount(value: number, isCreditNote: boolean): number {
  return isCreditNote ? -Math.abs(value) : value;
}
