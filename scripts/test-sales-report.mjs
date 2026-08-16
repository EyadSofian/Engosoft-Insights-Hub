import assert from "node:assert/strict";
import { optionalNumber, readSalesReport, reportMonth } from "../src/lib/sales-report.ts";

/* --- period normalisation -------------------------------------------------- */
// Every spelling has to land on the same day, because the window filter
// compares these as strings.
assert.equal(reportMonth("2026-08"), "2026-08-01");
assert.equal(reportMonth("2026-08-01"), "2026-08-01");
assert.equal(reportMonth("2026-8"), "2026-08-01");
assert.equal(reportMonth("08/2026"), "2026-08-01");
assert.equal(reportMonth("8-2026"), "2026-08-01");
assert.equal(reportMonth("August 2026"), "2026-08-01");
assert.equal(reportMonth("august 2026"), "2026-08-01");

// A month that is not a month is dropped, never coerced. Filing a row under the
// wrong period moves an employee's achievement into a month he did not earn.
assert.equal(reportMonth("2026-13"), "");
assert.equal(reportMonth("13/2026"), "");
assert.equal(reportMonth("Augustus 2026"), "");
assert.equal(reportMonth("Q3 2026"), "");
assert.equal(reportMonth(""), "");
assert.equal(reportMonth(null), "");

/* --- numbers --------------------------------------------------------------- */
// "Not reported" and "reported as zero" are different facts on screen.
assert.equal(optionalNumber(null), null);
assert.equal(optionalNumber(""), null);
assert.equal(optionalNumber("   "), null);
assert.equal(optionalNumber("—"), null, "an Odoo blank cell must not become 0");
assert.equal(optionalNumber(0), 0);
assert.equal(optionalNumber("0"), 0);
assert.equal(optionalNumber("9,000.50"), 9000.5, "thousands separators are stripped");
assert.equal(optionalNumber("$ 6,573.18"), 6573.18, "currency is stripped");
assert.equal(optionalNumber("-400"), -400);

/* --- the view's own column names ------------------------------------------- */
{
  const [row] = readSalesReport([
    {
      month: "2026-08-01",
      team_name: "Egypt",
      user_name: "Bahaa Ramdan",
      achieved_untaxed: "8100",
      achieved_total: "9000",
      deals_count: "12",
      quotations_count: "30",
      pipeline_value: "45000",
      team_target: "50000",
      team_attainment_pct: "73.00",
    },
  ]);
  assert.equal(row.month, "2026-08-01");
  assert.equal(row.user_name, "Bahaa Ramdan");
  assert.equal(row.achieved_total, 9000);
  assert.equal(row.team_attainment_pct, 73);
}

/* --- the same report as an Odoo pivot export ------------------------------- */
{
  const [row] = readSalesReport([
    {
      Month: "August 2026",
      Team: "Egypt",
      Salesperson: "Bahaa Ramdan",
      "Untaxed Amount": "8,100.00",
      Total: "9,000.00",
      Deals: "12",
      Quotations: "30",
      Pipeline: "45,000.00",
    },
  ]);
  assert.equal(row.month, "2026-08-01");
  assert.equal(row.user_name, "Bahaa Ramdan");
  assert.equal(row.achieved_total, 9000);
  assert.equal(row.achieved_untaxed, 8100);
  // Columns the export does not carry stay null rather than becoming zero.
  assert.equal(row.team_target, null);
  assert.equal(row.team_attainment_pct, null);
}

/* --- a reported zero survives ---------------------------------------------- */
{
  const [row] = readSalesReport([
    { month: "2026-08", user_name: "Bahaa Ramdan", achieved_total: "0" },
  ]);
  assert.equal(row.achieved_total, 0, "a zero month is a fact, not a missing figure");
}

/* --- unusable rows are dropped, not summed --------------------------------- */
{
  const rows = readSalesReport([
    { month: "2026-08", user_name: "Bahaa Ramdan", achieved_total: "9000" },
    { month: "", user_name: "Bahaa Ramdan", achieved_total: "5000" }, // no period
    { month: "2026-08", user_name: "", achieved_total: "7000" }, //      nobody
    { month: "Q3 2026", user_name: "Bahaa Ramdan", achieved_total: "3000" },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].achieved_total, 9000);
}

assert.deepEqual(readSalesReport([]), []);

console.log("sales report tests passed.");
