#!/usr/bin/env node
/**
 * Cross-endpoint production validation.
 *
 * This does not trust a headline card. It rechecks every public formula from
 * the detailed endpoint that supplies its numerator and denominator, then
 * optionally pins an approved accounting benchmark.
 *
 * Examples:
 *   node scripts/validate-dashboard.mjs --api https://app.example.com
 *   node scripts/validate-dashboard.mjs --api https://app.example.com \
 *     --from 2026-07-01 --to 2026-07-27 \
 *     --expect-revenue 88150.1942908 --expect-invoices 265 --expect-lines 776
 */

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index].replace(/^--/, ""), process.argv[index + 1]);
}

const API = (args.get("api") || process.env.VALIDATE_API || "http://localhost:3000").replace(
  /\/+$/,
  "",
);
const from = args.get("from") || "";
const to = args.get("to") || "";
const expected = {
  revenue: args.has("expect-revenue") ? Number(args.get("expect-revenue")) : null,
  invoices: args.has("expect-invoices") ? Number(args.get("expect-invoices")) : null,
  lines: args.has("expect-lines") ? Number(args.get("expect-lines")) : null,
};
const verbose = args.get("verbose") === "true";

const query = new URLSearchParams();
if (from) query.set("from", from);
if (to) query.set("to", to);
async function get(path, extraParams = {}) {
  const url = new URL(path, `${API}/`);
  for (const [key, value] of query) url.searchParams.set(key, value);
  for (const [key, value] of Object.entries(extraParams)) {
    url.searchParams.set(key, String(value));
  }
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
      return response.json();
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_500));
    }
  }
  throw lastError;
}

const [overview, accounting, ads, campaigns, adsets, adRows, lost, website, filters] = await Promise.all([
  get("/api/overview"),
  get("/api/accounting"),
  get("/api/ads"),
  get("/api/campaigns"),
  get("/api/campaigns", { grain: "adset" }),
  get("/api/campaigns", { grain: "ad" }),
  get("/api/lost"),
  get("/api/website"),
  get("/api/filters"),
]);

const checks = [];
const tolerance = 1e-8;
const relativeDifference = (actual, wanted) =>
  Math.abs(actual - wanted) / Math.max(Math.abs(actual), Math.abs(wanted), 1);
const same = (actual, wanted, slack = tolerance) =>
  Number.isFinite(actual) && Number.isFinite(wanted) && relativeDifference(actual, wanted) <= slack;

function check(label, ok, actual, wanted) {
  checks.push({ label, ok: Boolean(ok), actual, wanted });
}

const totals = overview.totals;
const platformSpend = ads.byPlatform.reduce((sum, row) => sum + row.spend, 0);
const reportedLeadPlatforms = ads.byPlatform.filter((row) => row.platformLeads !== null);
const platformLeads = reportedLeadPlatforms.length
  ? reportedLeadPlatforms.reduce((sum, row) => sum + row.platformLeads, 0)
  : null;

check(
  "Revenue = Accounting paid USD",
  same(totals.revenue, accounting.summary.paidUsd),
  totals.revenue,
  accounting.summary.paidUsd,
);
check(
  "Invoices = distinct accounting moves",
  totals.orders === accounting.summary.invoices,
  totals.orders,
  accounting.summary.invoices,
);
check(
  "Accounting lines = detail total",
  accounting.summary.productLines === accounting.detail.total,
  accounting.summary.productLines,
  accounting.detail.total,
);
check(
  "Payment Date is the accounting date",
  accounting.source.dateBasis === "Payment Date",
  accounting.source.dateBasis,
  "Payment Date",
);
check(
  "Healthy canonical fallbacks are not reported as excluded sources",
  !(filters.fetchErrors ?? []).some((entry) =>
    /accounting reconciliation|retaining .* accounting authority|using (sales|google sheets) fallback/i.test(entry),
  ),
  filters.fetchErrors ?? [],
  [],
);
check(
  "Spend = sum of platform spend",
  same(totals.spend, platformSpend),
  totals.spend,
  platformSpend,
);
check(
  "Platform leads = sum of reported platform leads",
  totals.platformLeads === platformLeads,
  totals.platformLeads,
  platformLeads,
);
check(
  "Lost = Lost Analysis total",
  totals.lost === lost.breakdown.total,
  totals.lost,
  lost.breakdown.total,
);
check(
  "CPL = spend / platform leads",
  same(totals.cpl, totals.spend / totals.platformLeads),
  totals.cpl,
  totals.spend / totals.platformLeads,
);
check(
  "CPA (won) = spend / won",
  same(totals.cpaWon, totals.spend / totals.won),
  totals.cpaWon,
  totals.spend / totals.won,
);
check(
  "CPA (invoices) = spend / invoices",
  same(totals.cpaInvoices, totals.spend / totals.orders),
  totals.cpaInvoices,
  totals.spend / totals.orders,
);
check(
  "ROAS = revenue / spend",
  same(totals.roas, totals.revenue / totals.spend),
  totals.roas,
  totals.revenue / totals.spend,
);
check(
  "ACOS = spend / revenue",
  same(totals.acos, (totals.spend / totals.revenue) * 100),
  totals.acos,
  (totals.spend / totals.revenue) * 100,
);
check(
  "Conversion = won / all CRM leads",
  same(totals.conversionRate, (totals.won / totals.totalLeads) * 100),
  totals.conversionRate,
  (totals.won / totals.totalLeads) * 100,
);
check(
  "Lost rate = archived lost / all CRM leads",
  same(totals.lostRate, (totals.lost / totals.totalLeads) * 100),
  totals.lostRate,
  (totals.lost / totals.totalLeads) * 100,
);
check(
  "CTR (all) is weighted",
  same(totals.ctrAll, (totals.clicksAll / totals.impressions) * 100),
  totals.ctrAll,
  (totals.clicksAll / totals.impressions) * 100,
);
const returnedCreditNotes = accounting.detail.rows.filter((row) =>
  /^RINV/i.test(String(row.movement || "")),
);
check(
  "No customer credit notes remain in Accounting",
  returnedCreditNotes.length === 0,
  returnedCreditNotes.length,
  0,
);
check(
  "Campaign keys are unique",
  new Set(campaigns.rows.map((row) => row.key)).size === campaigns.rows.length,
  campaigns.rows.length,
  "unique",
);
check(
  "Ad-set keys are unique",
  new Set(adsets.rows.map((row) => row.key)).size === adsets.rows.length,
  adsets.rows.length,
  "unique",
);
check(
  "Ad keys are unique",
  new Set(adRows.rows.map((row) => row.key)).size === adRows.rows.length,
  adRows.rows.length,
  "unique",
);
check(
  "Website endpoint produced a reconciliation result",
  Number.isFinite(website.reconciliation?.totalOrders),
  website.reconciliation?.totalOrders,
  "number",
);

for (const [metric, wanted] of Object.entries(expected)) {
  if (wanted === null) continue;
  const actual =
    metric === "revenue"
      ? accounting.summary.paidUsd
      : metric === "invoices"
        ? accounting.summary.invoices
        : accounting.summary.productLines;
  check(`Approved ${metric} benchmark`, same(actual, wanted, 1e-10), actual, wanted);
}

for (const row of campaigns.rows) {
  if (row.impressions > 0) {
    check(
      `Weighted CTR — ${row.name}`,
      same(row.ctrAll, (row.clicksAll / row.impressions) * 100),
      row.ctrAll,
      (row.clicksAll / row.impressions) * 100,
    );
  }
  if (row.platformLeads > 0) {
    check(
      `CPL — ${row.name}`,
      same(row.cpl, row.spend / row.platformLeads),
      row.cpl,
      row.spend / row.platformLeads,
    );
  }
  if (row.revenue > 0) {
    check(
      `ACOS — ${row.name}`,
      same(row.acos, (row.spend / row.revenue) * 100),
      row.acos,
      (row.spend / row.revenue) * 100,
    );
  }
}

const failures = checks.filter((item) => !item.ok);
for (const item of checks) {
  if (!verbose && item.ok && /^(Weighted CTR|CPL|ACOS) —/.test(item.label)) continue;
  const status = item.ok ? "PASS" : "FAIL";
  console.log(
    `${status.padEnd(4)}  ${item.label}  [${String(item.actual)} / ${String(item.wanted)}]`,
  );
}

console.log(`\n${checks.length - failures.length}/${checks.length} checks passed.`);
if (failures.length) process.exit(1);
