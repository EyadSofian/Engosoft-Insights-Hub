/**
 * Which aggregate figures does the agent endpoint fail to expose?
 *
 * For every registered surface: fetch the real payload, walk it, and list every
 * nested object holding finite numbers that `flatSummary` cannot reach. Those
 * are figures on a dashboard tab that Nexus cannot read.
 */
const BASE = process.env.HUB || "http://localhost:3000";
const { INSIGHTS_SURFACES: REG } = await import("../src/lib/agent-insights-registry.ts");

/**
 * Groups keyed by a row identifier rather than by a dashboard figure.
 *
 * `activity.delivery.id:120253741301410712` is one ad's numbers, not a tab's.
 * Declaring those would flatten thousands of per-row keys into the summary and
 * tell the agent nothing a person could ask for by name.
 */
const IGNORED = /(^|\.)id:/;
let gaps = 0;

const reachable = (data, paths) => {
  const out = new Set();
  const take = (src) => {
    if (!src || typeof src !== "object" || Array.isArray(src)) return;
    for (const [k, v] of Object.entries(src)) {
      if (typeof v === "number" && Number.isFinite(v)) out.add(k);
      else if (typeof v === "string" && v.length < 120) out.add(k);
    }
  };
  take(data.totals);
  take(data.summary);
  for (const p of paths) {
    let n = data;
    for (const seg of p.split(".")) n = n && typeof n === "object" ? n[seg] : undefined;
    take(n);
  }
  for (const [k, v] of Object.entries(data))
    if (typeof v === "number" && Number.isFinite(v)) out.add(k);
  return out;
};

// Nested objects carrying numbers, excluding what flatSummary already walks.
const nestedAggregates = (data) => {
  const found = [];
  const walk = (node, path, depth) => {
    if (depth > 3 || !node || typeof node !== "object" || Array.isArray(node)) return;
    const nums = Object.entries(node).filter(
      ([, v]) => typeof v === "number" && Number.isFinite(v),
    );
    if (path && nums.length > 0) found.push({ path, keys: nums.map(([k]) => k) });
    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === "object" && !Array.isArray(v))
        walk(v, path ? `${path}.${k}` : k, depth + 1);
    }
  };
  walk(data, "", 0);
  return found;
};

for (const s of REG) {
  if (s.status !== "CONNECTED") {
    console.log(`\n### ${s.id}  [${s.status}] skipped`);
    continue;
  }
  for (const ep of s.endpoints) {
    let data;
    try {
      const res = await fetch(BASE + ep);
      if (!res.ok) {
        console.log(`\n### ${s.id} ${ep}  HTTP ${res.status}`);
        continue;
      }
      data = await res.json();
    } catch (e) {
      console.log(`\n### ${s.id} ${ep}  FETCH FAILED ${e.message}`);
      continue;
    }
    const seen = reachable(data, s.summaryPaths ?? []);
    const missed = nestedAggregates(data)
      .filter((n) => !IGNORED.test(n.path))
      .filter((n) => !["totals", "summary"].includes(n.path.split(".")[0]))
      .filter((n) => !(s.summaryPaths ?? []).includes(n.path))
      .map((n) => ({ path: n.path, keys: n.keys.filter((k) => !seen.has(k)) }))
      .filter((n) => n.keys.length > 0);
    if (missed.length) {
      gaps += missed.length;
      console.log(`\n### ${s.id} ${ep}  — ${missed.length} unreachable group(s)`);
      for (const m of missed) console.log(`   ${m.path}: ${m.keys.join(", ")}`);
    } else {
      console.log(`\n### ${s.id} ${ep}  OK`);
    }
  }
}

/**
 * A figure on a dashboard tab that the agent cannot read is a coverage gap, and
 * this exits non-zero on one.
 *
 * The failure it prevents: a manager pointed at the target on the Employee
 * Performance tab and the agent said it had no target data. `/api/teams`
 * carried totalTarget 162000 the whole time — nested inside `targets`, which
 * nothing had declared, so the flattener never walked it.
 */
console.log(`\n${gaps === 0 ? "PASS" : "FAIL"} — ${gaps} unreachable aggregate group(s)`);
process.exit(gaps === 0 ? 0 : 1);
