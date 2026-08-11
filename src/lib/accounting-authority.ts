/**
 * Pick the recognised USD value written by the authoritative accounting job.
 *
 * The n8n workflow calculates `$ Sales` from Odoo's current FX lookup. Direct
 * app reads may additionally contain `USD Paid`, derived from emergency static
 * rates. When both survive an enrichment merge, `$ Sales` must win.
 */
export function authoritativeAccountingUsd(row: Record<string, unknown>): string {
  for (const key of ["$ Sales", "USD Paid", "$ paid", "$ Paid"] as const) {
    const value = row[key];
    if (value === null || value === undefined) continue;
    if (String(value).trim() === "") continue;
    return String(value).trim();
  }
  return "";
}

export interface AccountingCompletenessInput {
  directRows: number;
  directMoves: number;
  directRevenue: number;
  missingCurrencyRate: number;
  referenceRows: number;
  referenceMoves: number;
  referenceRevenue: number;
  nearCompleteRatio?: number;
  revenueTolerance?: number;
}

/**
 * Fail closed before a direct Odoo candidate can replace a durable snapshot.
 *
 * With no prior authority there is nothing to overwrite, so a non-empty and
 * currency-complete direct read may bootstrap the dataset. Once PostgreSQL (or
 * the migration fallback) contains a reference, population and revenue must
 * reconcile before the candidate is allowed to replace it.
 */
export function directAccountingPassesCompletenessGate({
  directRows,
  directMoves,
  directRevenue,
  missingCurrencyRate,
  referenceRows,
  referenceMoves,
  referenceRevenue,
  nearCompleteRatio = 0.98,
  revenueTolerance = Math.max(1, Math.abs(referenceRevenue) * 0.001),
}: AccountingCompletenessInput): boolean {
  if (directRows <= 0 || directMoves <= 0 || missingCurrencyRate !== 0) return false;

  const hasReference = referenceRows > 0 && referenceMoves > 0;
  if (!hasReference) return true;

  return (
    directRows / referenceRows >= nearCompleteRatio &&
    directMoves / referenceMoves >= nearCompleteRatio &&
    Math.abs(directRevenue - referenceRevenue) <= revenueTolerance
  );
}
