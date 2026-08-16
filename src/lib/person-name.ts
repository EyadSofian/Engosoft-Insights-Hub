/**
 * One spelling rule for a person, shared by every source that names one.
 *
 * The same salesperson arrives spelled differently from Odoo CRM, paid invoices,
 * the Yeastar extension directory and the monthly target workbook. Accents are
 * dropped and every run of non-alphanumeric characters collapses to one space,
 * so `Mr.Mohamad` and `mr mohamad` are the same key.
 *
 * This deliberately does NOT drop or reorder name parts. A workbook name that
 * carries extra parts (`… Saeed Hassan Al-Gamal`) is a different key on purpose:
 * guessing across name lengths is how one person's target lands on another. Such
 * cases are declared as explicit aliases in `sales-targets.ts` instead.
 */
export function normalizePersonName(value: string): string {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase("en")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}
