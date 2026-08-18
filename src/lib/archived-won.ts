/**
 * When a win lives in the archive rather than in the CRM.
 *
 * Winning a deal in Odoo ends with the record archived. It leaves the active
 * CRM export and lands in the archived tab still carrying `stage = Won`.
 *
 * Every counter in this codebase read the archive as a synonym for Lost. The
 * Lost side of that was handled — a row still marked Won was excluded from the
 * loss count, because a win is not a loss — but nothing ever added it to the
 * win count, and one place counted it as a loss outright. So the win simply
 * evaporated: campaign `Bim - 6/7/26 - CBO - SH` reported 0 wins and a
 * 0.00% close rate beside its own two paid invoices and $667.63 collected,
 * while Odoo's dashboard reported 2 Closed Won for the same campaign and month.
 *
 * So `won` has two sources, not one: active CRM rows sitting in a Won stage,
 * and archived rows that were won before being filed away.
 *
 * Split out of the server modules so the rule can be tested directly — they
 * import through Vite's resolver and cannot be loaded by a bare Node script.
 */

/**
 * Is this stage the Won stage?
 *
 * Odoo's stage is bilingual: the live pipeline names it `Won / ربح`, exactly as
 * `Interested / مهتم ( sales )` and `Quotation / عرض سعر` are named. Only the
 * CRM tab carries a `Cleaned Stage` helper column that reduces that to `Won`;
 * the archive falls back to the raw Arabic-and-English label whenever that
 * column is absent or blank on a row.
 *
 * A test for the bare string `"won"` therefore passed on the CRM tab and failed
 * on the archive — which is the whole bug. Every archived win read as "not
 * won", so it fell through to the loss counter. In a July export of the live
 * archive, all 12 archived wins were spelled `Won / ربح` and none of them
 * matched.
 *
 * So the stage is split on its language separator and each side is compared
 * whole. Substring matching is deliberately avoided: `Retention / إعادة شراء`
 * and `Lost Verification` must not become wins because a fragment happens to
 * appear inside them.
 */
export const isArchivedWonStage = (stage: string): boolean =>
  stage
    .split("/")
    .map((part) => part.trim().toLocaleLowerCase("en"))
    .some((part) => part === "won" || part === "ربح");

/**
 * Ids of deals the active CRM export has already counted as wins.
 *
 * Odoo's active and archived exports are normally disjoint, but a record
 * archived between the two reads appears in both, and that is one win rather
 * than two. A blank id cannot identify a duplicate and is never suppressed —
 * dropping an unidentified win is the worse of the two errors.
 *
 * Exposed separately from the predicate below for callers that classify the
 * stage with their own normaliser and need only the duplicate guard.
 */
export function crmWonIds(crm: readonly { id: string; isWon: boolean }[]): Set<string> {
  return new Set(crm.filter((row) => row.isWon && row.id).map((row) => row.id));
}

/**
 * Builds the "does this archived row count as a win?" test for one population.
 */
export function archivedWinFilter(
  crm: readonly { id: string; isWon: boolean }[],
): (row: { id: string; stage: string }) => boolean {
  const counted = crmWonIds(crm);
  return (row) => isArchivedWonStage(row.stage) && !(row.id && counted.has(row.id));
}
