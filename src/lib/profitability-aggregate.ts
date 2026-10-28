import type { ProfitabilityMonth, ProfitabilitySnapshot } from "./profitability.server";

const TOTAL_FIELDS = [
  "netProfit",
  "income",
  "grossProfit",
  "operatingIncome",
  "otherIncome",
  "costOfRevenue",
  "expenses",
  "depreciation",
] as const;

/** Sum Odoo's displayed monthly USD amounts, never revalue the full year at one rate. */
export function aggregateProfitabilityMonths(
  months: ProfitabilityMonth[],
): ProfitabilitySnapshot | null {
  if (!months.length || months.some((month) => month.status !== "ready" || !month.snapshot))
    return null;

  const snapshots = months.map((month) => month.snapshot!);
  const first = snapshots[0];
  const companyIds = first.companies.map((company) => company.id).join(",");
  if (
    snapshots.some(
      (snapshot) =>
        snapshot.currency !== "USD" ||
        snapshot.reportId !== first.reportId ||
        snapshot.postedOnly !== first.postedOnly ||
        snapshot.companies.map((company) => company.id).join(",") !== companyIds,
    )
  )
    return null;

  const totals = Object.fromEntries(
    TOTAL_FIELDS.map((field) => [
      field,
      snapshots.some((snapshot) => snapshot[field] === null)
        ? null
        : snapshots.reduce((cents, snapshot) => cents + Math.round(snapshot[field]! * 100), 0) /
          100,
    ]),
  ) as Pick<ProfitabilitySnapshot, (typeof TOTAL_FIELDS)[number]>;

  return {
    ...first,
    ...totals,
    from: months[0].from,
    to: months.at(-1)!.to,
    // A period-wide Odoo report would use a different conversion basis.
    // Account drilldown must therefore use each month's own Odoo report.
    lines: [],
    calculationBasis: "sum_of_odoo_months",
    fetchedAt: snapshots.reduce(
      (latest, snapshot) => (snapshot.fetchedAt > latest ? snapshot.fetchedAt : latest),
      first.fetchedAt,
    ),
  };
}
