#!/usr/bin/env node
/**
 * Number baseline for the dashboard restructure.
 *
 * Captures every number the read endpoints return for one fixed window, then
 * diffs a later run against it. A presentation-only change (moving a panel,
 * merging two pages, renaming a label) must leave this diff empty; a diff means
 * a formula or a population moved and needs an explanation before merging.
 *
 * Rows are summarised rather than stored: each array keeps its length and the
 * sum of every numeric column. Sums do not depend on sort order, so a reordered
 * table compares equal while a changed value does not.
 *
 * Capture, then compare against the same server shortly after (or against a
 * closed historical window, which upstream syncs rarely touch):
 *   node scripts/baseline-metrics.mjs --api http://localhost:5199 \
 *     --from 2026-08-01 --to 2026-08-11 --out baseline.json
 *   node scripts/baseline-metrics.mjs --api http://localhost:5199 --compare baseline.json
 *
 * `--compare` reuses the window stored in the baseline file. Exit code 1 when
 * any number differs or an endpoint that answered before no longer does.
 */
import { readFileSync, writeFileSync } from "node:fs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index].replace(/^--/, ""), process.argv[index + 1]);
}

const API = (args.get("api") || process.env.BASELINE_API || "http://localhost:5199").replace(
  /\/+$/,
  "",
);
const comparePath = args.get("compare");
const outPath = args.get("out") || "baseline-metrics.json";
const previous = comparePath ? JSON.parse(readFileSync(comparePath, "utf8")) : null;
const from = previous?.window.from ?? args.get("from") ?? "";
const to = previous?.window.to ?? args.get("to") ?? "";

if (!from || !to) {
  console.error("A fixed window is required: --from YYYY-MM-DD --to YYYY-MM-DD");
  process.exit(2);
}

/**
 * Every public, unauthenticated read endpoint a page renders from. Write and
 * admin endpoints are out of scope: a baseline must never change state.
 */
const ENDPOINTS = [
  "/api/overview",
  "/api/campaigns?grain=campaign",
  "/api/campaigns?grain=adset",
  "/api/campaigns?grain=ad",
  "/api/ads",
  "/api/courses",
  "/api/course-lead-alerts",
  "/api/leads",
  "/api/lost",
  "/api/accounting",
  "/api/profitability",
  "/api/teams",
  "/api/organic",
  "/api/website",
  "/api/weekend",
  "/api/yoy",
  "/api/media-buyers",
  "/api/media-plan",
  "/api/attribution/summary",
  "/api/uncalled-leads",
];

/**
 * Keys that describe when or how fast something was read rather than what it
 * measured. They change on every request and would bury real differences.
 */
const VOLATILE_KEY =
  /(At|Ms|Seconds|Age|AgeHours|ageHours|ageMs|Timestamp|timestamp|elapsed|duration|latency)$|^(at|age|now|ts|fetched|synced|generated|cache)/;

function summarise(value, path, out) {
  if (typeof value === "number") {
    if (Number.isFinite(value)) out[path] = value;
    return;
  }
  if (Array.isArray(value)) {
    out[`${path}.length`] = value.length;
    const sums = {};
    for (const item of value) {
      if (typeof item === "number") {
        if (Number.isFinite(item)) sums["[]"] = (sums["[]"] ?? 0) + item;
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const leaves = {};
      summarise(item, "", leaves);
      for (const [key, number] of Object.entries(leaves)) {
        sums[key] = (sums[key] ?? 0) + number;
      }
    }
    for (const [key, sum] of Object.entries(sums)) out[`${path}[Σ]${key}`] = sum;
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (VOLATILE_KEY.test(key)) continue;
      summarise(child, path ? `${path}.${key}` : key, out);
    }
  }
}

async function capture(endpoint) {
  const url = new URL(endpoint, `${API}/`);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) return { status: response.status, numbers: {} };
    const numbers = {};
    summarise(await response.json(), "", numbers);
    return { status: response.status, numbers };
  } catch (error) {
    return {
      status: 0,
      error: error instanceof Error ? error.message : String(error),
      numbers: {},
    };
  }
}

// Sequential on purpose: the first request warms the shared snapshot, and a
// burst of twenty cold requests would only queue behind it anyway.
const endpoints = {};
for (const endpoint of ENDPOINTS) {
  endpoints[endpoint] = await capture(endpoint);
  const { status, numbers, error } = endpoints[endpoint];
  console.log(
    `${String(status).padStart(3)}  ${Object.keys(numbers).length.toString().padStart(6)}  ${endpoint}${error ? `  (${error})` : ""}`,
  );
}

const answered = ENDPOINTS.filter((endpoint) => endpoints[endpoint].status === 200);
// A run where nothing answered compares "equal" to anything; it must never
// become a baseline or pass a comparison.
if (answered.length === 0) {
  console.error(`\nNo endpoint answered at ${API}; nothing was written or compared.`);
  process.exit(1);
}

if (!previous) {
  writeFileSync(
    outPath,
    `${JSON.stringify({ capturedAt: new Date().toISOString(), api: API, window: { from, to }, endpoints }, null, 1)}\n`,
  );
  console.log(`\nBaseline written to ${outPath} for ${from} → ${to}.`);
  process.exit(0);
}

/** Relative tolerance covers float summation order, nothing a person could see. */
const same = (a, b) => a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

let differences = 0;
for (const endpoint of ENDPOINTS) {
  const before = previous.endpoints[endpoint];
  const after = endpoints[endpoint];
  if (!before || before.status !== 200) {
    console.log(
      `\n· ${endpoint}: not in the baseline (answered ${before?.status ?? "—"}), skipped`,
    );
    continue;
  }
  if (after.status !== 200) {
    console.log(`\n✗ ${endpoint}: answered ${before.status} in the baseline, now ${after.status}`);
    differences++;
    continue;
  }
  const keys = new Set([...Object.keys(before.numbers), ...Object.keys(after.numbers)]);
  const lines = [];
  for (const key of [...keys].sort()) {
    const a = before.numbers[key];
    const b = after.numbers[key];
    if (a === undefined) lines.push(`  + ${key} = ${b}`);
    else if (b === undefined) lines.push(`  - ${key} (was ${a})`);
    else if (!same(a, b)) lines.push(`  ~ ${key}: ${a} → ${b}`);
  }
  if (lines.length) {
    differences += lines.length;
    console.log(`\n✗ ${endpoint}`);
    for (const line of lines.slice(0, 40)) console.log(line);
    if (lines.length > 40) console.log(`  … ${lines.length - 40} more`);
  }
}

console.log(
  differences
    ? `\n${differences} difference(s) against ${comparePath} (${from} → ${to}).`
    : `\nNo differences against ${comparePath} (${from} → ${to}).`,
);
process.exit(differences ? 1 : 0);
