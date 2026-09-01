#!/usr/bin/env node
// Load a price workbook into a running deployment, from the command line.
//
// The Manage tab does the same thing with a file picker; this exists for the
// first import, when nobody has opened the tab yet, and for re-importing a
// month from a script.
//
// It never publishes on its own. The default run creates a draft and stops,
// because the whole point of the preview/approve split is that a person looks
// at the row counts before prices start deciding what counts as a breach.
//
// Usage:
//   DASHBOARD_ADMIN_SECRET=… node --experimental-strip-types scripts/import-price-book.mjs \
//     --file "/path/New Price List.xlsx" \
//     --url  https://engosoft-insights-hub-production.up.railway.app \
//     --name "September prices" --from 2026-09-01 --to 2026-09-30 \
//     [--date-reading day_first|month_first] [--publish] [--audit]
import { readFileSync } from "node:fs";

const args = new Map();
for (let index = 2; index < process.argv.length; index++) {
  const token = process.argv[index];
  if (!token.startsWith("--")) continue;
  const key = token.slice(2);
  const next = process.argv[index + 1];
  if (!next || next.startsWith("--")) args.set(key, "true");
  else {
    args.set(key, next);
    index++;
  }
}

const file = args.get("file") ?? "/Users/eyad/Downloads/New Price List.xlsx";
const base = (args.get("url") ?? "http://localhost:3000").replace(/\/+$/, "");
const secret = process.env.DASHBOARD_ADMIN_SECRET?.trim() ?? "";
const name = args.get("name") ?? "Price list";
const from = args.get("from") ?? "";
const to = args.get("to") ?? "";
const dateReading = args.get("date-reading") ?? "unresolved";
const taxInclusive = args.get("tax-exclusive") !== "true";

if (!secret) {
  console.error(
    "DASHBOARD_ADMIN_SECRET is not set. This script cannot write without it, and the\n" +
      "secret is deliberately never read from a file or a command-line flag.",
  );
  process.exit(2);
}

const post = async (path, payload) => {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-secret": secret },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    // Never echo the request: it carries the workbook and the header carries
    // the secret.
    throw new Error(body.error || `${path} failed with ${response.status}`);
  }
  return body;
};

const workbook = readFileSync(file);
console.log(`Reading ${file} (${(workbook.length / 1024).toFixed(0)} KB) into ${base}`);

const request = {
  source: "xlsx",
  fileName: file.split("/").pop(),
  contentBase64: workbook.toString("base64"),
  offerDateReading: dateReading,
  baseCurrency: "SAR",
  localCurrency: "EGP",
};

// 1. Preview. Nothing is written yet.
const preview = await post("/api/pricing/import/preview", request);
const summary = preview.summary;
console.log("\nPreview");
console.log(`  sheets            ${preview.sheets.join(", ")}`);
console.log(`  source rows       ${summary.sourceRows}`);
console.log(`  price rules       ${summary.accepted}`);
console.log(`  rows rejected     ${summary.rejected}`);
console.log(`  duplicate codes   ${summary.duplicateCodes}`);
console.log(`  needs review      ${summary.needsReview}`);
console.log(`  on hold           ${summary.onHold}`);
console.log(`  unlinked to Odoo  ${summary.unmapped}`);
console.log(`  warnings          ${summary.warnings}`);

if (preview.duplicateCodes?.length) {
  console.log("\n  Duplicated codes (all rows are kept):");
  for (const entry of preview.duplicateCodes.slice(0, 20)) {
    const where = entry.occurrences.map((hit) => `${hit.sheet}:${hit.row}`).join(", ");
    console.log(
      `    ${entry.code} x${entry.count}${entry.conflicting ? "  [prices disagree]" : ""}  ${where}`,
    );
  }
}
if (preview.unresolvedDates?.length) {
  console.log("\n  Dates that read two ways — offers stay unpublished until one is chosen:");
  for (const entry of preview.unresolvedDates) {
    console.log(`    ${entry.sheet}: "${entry.raw}" -> ${entry.dayFirst} or ${entry.monthFirst}`);
  }
  if (dateReading === "unresolved") {
    console.log("    Re-run with --date-reading day_first (or month_first) to publish them.");
  }
}

if (args.get("preview-only") === "true") {
  console.log("\nPreview only. Nothing was written.");
  process.exit(0);
}

// 2. Commit as a draft.
const committed = await post("/api/pricing/import/preview", {
  ...request,
  commit: {
    name,
    effectiveFrom: from,
    effectiveTo: to,
    taxInclusive,
    baseCurrency: "SAR",
    notes: "",
  },
});
const book = committed.book;
console.log(`\nDraft created: "${book.name}" v${book.version} (${book.itemCount} rules)`);
console.log(`  id ${book.id}`);
console.log(`  effective ${book.effectiveFrom || "open"} to ${book.effectiveTo || "open"}`);
console.log(`  checksum ${book.sourceChecksum.slice(0, 16)}…`);

if (args.get("publish") !== "true") {
  console.log(
    "\nNot published. Review it in the Manage tab, then publish there or re-run with --publish.",
  );
  process.exit(0);
}

// 3. Publish.
const published = await post("/api/pricing/publish", { bookId: book.id, action: "publish" });
console.log(`\nPublished v${published.book.version} at ${published.book.publishedAt}`);

if (args.get("audit") !== "true") {
  console.log("Prices changed, so the stored verdicts are stale. Re-run the audit when ready.");
  process.exit(0);
}

// 4. Audit. Ninety days by default; `--all-time` is opt-in because that is the
// run that costs real money on a metered plan.
const run = await post("/api/pricing/recalculate", {
  allTime: args.get("all-time") === "true",
  force: true,
});
const result = run.run;
console.log("\nAudit");
console.log(`  window            ${result.windowFrom} to ${result.windowTo}`);
console.log(`  candidate lines   ${result.candidateLines}`);
console.log(`  audited           ${result.auditedLines}`);
console.log(`  skipped unchanged ${result.skippedUnchanged}`);
console.log(`  payments read     ${result.paymentsRead}`);
console.log(`  line facts read   ${result.lineFactsRead}`);
console.log(`  lines w/o qty     ${result.linesMissingQuantity}`);
if (result.lineFactsRejected) {
  console.log(
    `  WARNING: ${result.lineFactsRejected} stored line ids resolved to a different invoice in\n` +
      "  Odoo. Those lines are excluded rather than judged with a borrowed quantity;\n" +
      "  check what the accounting sync writes into __odoo_line_id.",
  );
}
console.log(`  products resolved ${result.productsResolved}`);
console.log(`  Odoo calls        ${result.odooCalls}`);
if (result.unknownPaymentValues?.length) {
  console.log(`  unrecognised payment names: ${result.unknownPaymentValues.join(", ")}`);
  console.log("  Add them as aliases from the Alerts tab so those lines can be judged.");
}
if (result.error) console.log(`  error: ${result.error}`);
