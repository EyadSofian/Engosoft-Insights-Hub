/**
 * Reading Odoo's monthly operational sales report.
 *
 * Split out of the SLA reader so the parsing can be tested without a database:
 * this is the second revenue basis on the employee screen, and it is the sheet
 * management already circulates, so a row filed under the wrong month or
 * attached to the wrong spelling of a name is a number someone will argue with
 * in a meeting.
 *
 * The report reaches the dashboard through the generic `/api/ingest/dataset`
 * endpoint, which stores whatever columns it is given. That means the same
 * dataset can arrive either straight from the `public.sales_summary` view in
 * snake_case, or as an Odoo pivot export whose headers are the human labels
 * shown in the UI. Both are accepted; neither is guessed at.
 */

export interface SalesReportRow {
  /** Normalised to `YYYY-MM-DD` on the first of the month. */
  month: string;
  team_name: string | null;
  user_name: string | null;
  achieved_untaxed: number | null;
  achieved_total: number | null;
  deals_count: number | null;
  quotations_count: number | null;
  pipeline_value: number | null;
  team_target: number | null;
  team_attainment_pct: number | null;
}

const text = (value: unknown): string => String(value ?? "").trim();

/** First non-empty value among several spellings of the same column. */
export function pickColumn(row: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return null;
}

/**
 * `null` rather than `0`, so a column the report never filled in cannot be read
 * as a reported zero. Odoo exports money with thousands separators and
 * sometimes a trailing currency, so those are stripped before parsing.
 */
export function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d.,-]/g, "").replace(/,/g, "");
  if (!cleaned || !/\d/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/**
 * Normalise the report's period to the `YYYY-MM-DD` the window filter expects.
 *
 * Odoo's monthly pivot labels a period several ways depending on how it was
 * exported — `2026-08`, `08/2026`, `August 2026`. Anything that does not
 * resolve to a real month returns `""` and is dropped by the caller rather than
 * guessed: a row filed under the wrong month would quietly move an employee's
 * achievement into a period he did not earn it in.
 */
export function reportMonth(value: unknown): string {
  const trimmed = text(value);
  const iso = trimmed.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
  if (iso) {
    const month = Number(iso[2]);
    if (month >= 1 && month <= 12) return `${iso[1]}-${String(month).padStart(2, "0")}-01`;
    return "";
  }
  const slashed = trimmed.match(/^(\d{1,2})[/-](\d{4})$/);
  if (slashed) {
    const month = Number(slashed[1]);
    if (month >= 1 && month <= 12) return `${slashed[2]}-${String(month).padStart(2, "0")}-01`;
    return "";
  }
  const named = trimmed.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (named) {
    const index = MONTH_NAMES.indexOf(named[1].toLowerCase());
    if (index >= 0) return `${named[2]}-${String(index + 1).padStart(2, "0")}-01`;
  }
  return "";
}

/**
 * Turn ingested rows into the report.
 *
 * Rows with no month cannot be placed in a window, and rows with no salesperson
 * cannot be attached to anyone; both are dropped. Dropping them is safe in a
 * way that keeping them is not — an unattributable row would still be summed
 * into a team figure a manager reconciles against a printed sheet.
 */
export function readSalesReport(rows: Record<string, unknown>[]): SalesReportRow[] {
  return rows
    .map((row) => ({
      month: reportMonth(pickColumn(row, "month", "Month", "period", "Period")),
      team_name: text(pickColumn(row, "team_name", "Team", "Sales Team", "team")) || null,
      user_name: text(pickColumn(row, "user_name", "Salesperson", "Sales Person", "user")) || null,
      achieved_untaxed: optionalNumber(
        pickColumn(row, "achieved_untaxed", "Untaxed Amount", "Untaxed Total"),
      ),
      achieved_total: optionalNumber(
        pickColumn(row, "achieved_total", "Total", "Achieved", "Total Amount"),
      ),
      deals_count: optionalNumber(pickColumn(row, "deals_count", "Deals", "Orders", "Count")),
      quotations_count: optionalNumber(pickColumn(row, "quotations_count", "Quotations", "Quotes")),
      pipeline_value: optionalNumber(
        pickColumn(row, "pipeline_value", "Pipeline", "Expected Revenue"),
      ),
      team_target: optionalNumber(pickColumn(row, "team_target", "Target", "Team Target")),
      team_attainment_pct: optionalNumber(
        pickColumn(row, "team_attainment_pct", "Attainment", "Attainment %"),
      ),
    }))
    .filter((row) => row.month && row.user_name);
}
