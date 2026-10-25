// Checks every headline dashboard number against the system it comes from and
// prints one table. Run it against a deployment, or locally with the same
// credentials the deployment uses:
//
//   npm run audit:sources                       # month to date
//   npm run audit:sources -- --from 2026-09-01 --to 2026-09-30
//   AUDIT_API=https://<deployment> npm run audit:sources
//
// With AUDIT_API it reads the deployment's /api/source-reconciliation, so the
// dashboard side of every comparison is the figure production actually serves.
// Without it the checks run in-process, which needs the source credentials in
// the environment.
//
// Exit code: 0 when nothing is a MISMATCH, 1 otherwise. A SOURCE_UNAVAILABLE
// does not fail the run -- it is reported, loudly, as unverified.
import { argv, env, exit } from "node:process";

const arg = (name, fallback = "") => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

const today = new Date().toISOString().slice(0, 10);
const from = arg("from", env.AUDIT_FROM || `${today.slice(0, 7)}-01`);
const to = arg("to", env.AUDIT_TO || today);
const api = (arg("api", env.AUDIT_API || "") || "").replace(/\/+$/, "");

async function load() {
  if (api) {
    const url = `${api}/api/source-reconciliation?from=${from}&to=${to}${
      argv.includes("--force") ? "&force=1" : ""
    }`;
    const response = await fetch(url, { signal: AbortSignal.timeout(600_000) });
    if (!response.ok) throw new Error(`${url} responded ${response.status}`);
    return response.json();
  }
  const { sourceReconciliation } = await import("../src/lib/source-reconciliation.server.ts");
  return sourceReconciliation({ from, to }, { force: argv.includes("--force") });
}

const MARK = {
  MATCHED: "ok  ",
  SMALL_DIFFERENCE: "~   ",
  MISMATCH: "FAIL",
  SOURCE_UNAVAILABLE: "??  ",
  STALE: "old ",
  NOT_VALIDATED: "--  ",
};

const money = (value) =>
  value === null || value === undefined
    ? "-"
    : value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const count = (value) =>
  value === null || value === undefined ? "-" : value.toLocaleString("en-US");
const show = (value, unit) => (unit === "usd" ? money(value) : count(value));

const report = await load();

const rows = report.groups.flatMap((group) =>
  group.checks.map((item) => ({
    source: item.sourceSystem,
    metric: item.metricId,
    sourceValue: show(item.sourceValue, item.unit),
    dashboardValue: show(item.dashboardValue, item.unit),
    difference:
      item.difference === null
        ? "-"
        : `${item.difference > 0 ? "+" : ""}${show(item.difference, item.unit)}${
            item.differencePercent === null
              ? ""
              : ` (${item.differencePercent > 0 ? "+" : ""}${item.differencePercent.toFixed(2)}%)`
          }`,
    status: item.status,
    reason: item.unavailableReason,
  })),
);

const width = (key, header) =>
  Math.max(header.length, ...rows.map((row) => String(row[key]).length));
const columns = [
  ["source", "SOURCE"],
  ["metric", "METRIC"],
  ["sourceValue", "SOURCE VALUE"],
  ["dashboardValue", "DASHBOARD VALUE"],
  ["difference", "DIFFERENCE"],
  ["status", "STATUS"],
];
const widths = Object.fromEntries(columns.map(([key, header]) => [key, width(key, header)]));
const line = (cells) =>
  columns.map(([key], index) => String(cells[index]).padEnd(widths[key])).join("  ");

console.log(`\nSource reconciliation  ${report.period.from} .. ${report.period.to}`);
console.log(
  `checked at ${report.generatedAt}  (${report.durationMs} ms)${api ? `  via ${api}` : "  in process"}`,
);
console.log("");
console.log(line(columns.map(([, header]) => header)));
console.log(columns.map(([key]) => "-".repeat(widths[key])).join("  "));
for (const row of rows) {
  console.log(
    `${line([row.source, row.metric, row.sourceValue, row.dashboardValue, row.difference, row.status])}`,
  );
}

console.log("");
for (const [status, total] of Object.entries(report.summary)) {
  if (total > 0) console.log(`  ${MARK[status] ?? status} ${status.padEnd(20)} ${total}`);
}

const unverified = rows.filter((row) => row.status === "SOURCE_UNAVAILABLE");
if (unverified.length) {
  console.log("\nNot verified against its own source:");
  for (const row of unverified) console.log(`  - ${row.metric}: ${row.reason}`);
}

const failures = rows.filter((row) => row.status === "MISMATCH");
if (failures.length) {
  console.log("\nMISMATCH:");
  for (const row of failures) {
    console.log(
      `  - ${row.metric}: source ${row.sourceValue}, dashboard ${row.dashboardValue}, off by ${row.difference}`,
    );
  }
}

console.log(`\nworst status: ${report.worst}\n`);
exit(failures.length ? 1 : 0);
