/**
 * Does every declared surface actually answer, and can the agent read what the
 * page shows?
 *
 * TWO FAILURES THIS EXISTS TO CATCH.
 *
 * 1. A figure on a dashboard tab the agent cannot reach. A manager pointed at
 *    "إجمالي التارجت $162,000" on the Employee Performance tab and the agent
 *    said it had no target data. /api/teams carried `targets.totalTarget` the
 *    whole time, nested one level down, declared nowhere.
 *
 * 2. AN ENDPOINT THAT DOES NOT ANSWER AT ALL. The previous version printed
 *    "HTTP 400" and then `continue`d without counting anything, so
 *    /api/agent-course-intelligence — which is HTTP 400 unless you pass
 *    `course` — was never exercised and the audit reported PASS. A source that
 *    was never successfully called is not covered, and this now says so.
 *
 * Every source is called with the arguments its contract declares it needs, and
 * any non-2xx is a hard failure. `--self-test` proves the failure path by
 * pointing one source at a route that does not exist.
 *
 *   node --experimental-strip-types scripts/audit-agent-coverage.mjs
 *   HUB=https://... node --experimental-strip-types scripts/audit-agent-coverage.mjs
 *   ... --self-test        # exits 0 only when the injected 404 is observed as a failure
 */
const BASE = process.env.HUB || "http://localhost:3000";
const SELF_TEST = process.argv.includes("--self-test");

const { SURFACE_CONTRACTS, sourcesFor, operationsFor, AGENT_CONTRACT_VERSION } = await import(
  "../src/lib/agent-surface-contract.ts"
);

/** A window every reporting endpoint understands. */
const WINDOW = {
  from: process.env.AUDIT_FROM || "2026-08-01",
  to: process.env.AUDIT_TO || "2026-08-31",
};

/**
 * Groups keyed by a row identifier rather than by a dashboard figure.
 *
 * `activity.delivery.id:120253741301410712` is one ad's numbers, not a tab's.
 * Declaring those would flatten thousands of per-row keys into the summary and
 * tell the agent nothing a person could ask for by name.
 */
const IGNORED = /(^|\.)id:/;

let failures = 0;
let gaps = 0;
let checks = 0;
let forcedSelfTestFailure = false;
let forced404Observed = false;
const fail = (message) => {
  failures += 1;
  console.log(`   FAIL  ${message}`);
};

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

// Nested objects carrying numbers, excluding what the summary walk already reaches.
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

/**
 * Every (surface, view, operation) the contract promises, expanded.
 *
 * A surface with no views is still one case — the default view. A surface with
 * views is every view, because a view is where the multi-endpoint bug lived:
 * accounting/profitability reads a service the summary tab never touches.
 */
function cases(contract) {
  const views = contract.views.length > 0 ? contract.views.map((v) => v.id) : [null];
  const out = [];
  for (const view of views) {
    for (const operation of operationsFor(contract, view)) out.push({ view, operation });
  }
  return out;
}

console.log(`ENGO Nexus surface contract audit — schema ${AGENT_CONTRACT_VERSION}`);
console.log(`against ${BASE}${SELF_TEST ? "  [SELF-TEST: one source is forced to 404]" : ""}\n`);

for (const contract of SURFACE_CONTRACTS) {
  if (contract.status === "NOT_APPLICABLE") {
    console.log(`### ${contract.id}  [NOT_APPLICABLE] — ${contract.note ?? "declared"}`);
    // An explicitly not-applicable surface must say why, or it is just missing.
    if (!contract.note) fail(`${contract.id} is NOT_APPLICABLE without a note`);
    continue;
  }
  if (contract.status !== "CONNECTED" && contract.status !== "PARTIAL") {
    console.log(`### ${contract.id}  [${contract.status}] skipped`);
    continue;
  }

  const seenSources = new Set();

  for (const { view, operation } of cases(contract)) {
    /**
     * The arguments a source needs, supplied. This is the whole of fix #2:
     * `sourcesFor` skips an optional source whose argument is absent, so
     * without the fixture arguments the course-intelligence source would be
     * silently skipped and reported as covered.
     */
    const args = { ...WINDOW };
    for (const source of contract.sources) {
      for (const [key, value] of Object.entries(source.auditArgs ?? {})) args[key] = value;
    }

    const sources = sourcesFor(contract, { view, operation, args });
    const label = `${contract.id}${view ? `/${view}` : ""} [${operation}]`;

    if (sources.length === 0) {
      fail(`${label} resolves to no data source at all`);
      continue;
    }

    for (const source of sources) {
      const missing = (source.requiredArgs ?? []).filter((key) => !args[key]);
      if (missing.length > 0) {
        fail(`${label} → ${source.endpoint} needs ${missing.join(", ")} and the audit has none`);
        continue;
      }

      const query = new URLSearchParams();
      for (const key of contract.filters) if (args[key]) query.set(key, args[key]);
      for (const key of source.requiredArgs ?? []) if (args[key]) query.set(key, args[key]);

      // Break exactly one call. The previous self-test rewrote every source
      // aliased as `root`, so dozens of 404s proved only that the whole Hub was
      // unavailable. One forced endpoint is a sharper regression test: the
      // remaining contract must still be exercised successfully.
      const forceThisCall = SELF_TEST && !forcedSelfTestFailure;
      if (forceThisCall) forcedSelfTestFailure = true;
      const endpoint = forceThisCall ? "/api/__does_not_exist" : source.endpoint;
      const url = `${BASE}${endpoint}?${query.toString()}`;

      checks += 1;
      let res;
      try {
        res = await fetch(url);
      } catch (error) {
        fail(`${label} → ${endpoint} could not be reached: ${error.message}`);
        continue;
      }

      /**
       * THE BUG THIS LINE FIXES. The old script printed the status and moved
       * on, so a 404 or a 400 counted as nothing at all and the run exited 0.
       */
      if (!res.ok) {
        if (forceThisCall && res.status === 404) forced404Observed = true;
        fail(`${label} → ${endpoint} returned HTTP ${res.status}`);
        continue;
      }

      let data;
      try {
        data = await res.json();
      } catch (error) {
        fail(`${label} → ${endpoint} did not return JSON: ${error.message}`);
        continue;
      }

      // The unreachable-aggregate walk is per endpoint, not per case.
      if (seenSources.has(source.endpoint)) continue;
      seenSources.add(source.endpoint);

      const declared = source.summaryPaths ?? [];
      const seen = reachable(data, declared);
      const missed = nestedAggregates(data)
        .filter((n) => !IGNORED.test(n.path))
        .filter((n) => !["totals", "summary"].includes(n.path.split(".")[0]))
        .filter((n) => !declared.includes(n.path))
        .map((n) => ({ path: n.path, keys: n.keys.filter((k) => !seen.has(k)) }))
        .filter((n) => n.keys.length > 0);

      if (missed.length > 0) {
        gaps += missed.length;
        console.log(`### ${contract.id} ${source.endpoint}  — ${missed.length} unreachable group(s)`);
        for (const m of missed) console.log(`   ${m.path}: ${m.keys.join(", ")}`);
      } else {
        console.log(`### ${contract.id} ${source.endpoint} [${source.as}]  OK`);
      }
    }
  }

  /**
   * Every source the contract declares must have been exercised at least once
   * across the surface's cases. A source no case reaches is dead weight that
   * would silently stay broken.
   */
  for (const source of contract.sources) {
    if (!seenSources.has(source.endpoint)) {
      fail(`${contract.id} declares ${source.endpoint} but no case exercises it`);
    }
  }
}

const ok = failures === 0 && gaps === 0;
console.log(
  `\n${ok ? "PASS" : "FAIL"} — ${checks} endpoint call(s), ${failures} failure(s), ${gaps} unreachable aggregate group(s)`,
);
if (SELF_TEST) {
  // Do not let an unrelated transient failure prove the 404 assertion for us:
  // the exact injected request must itself return 404 and increment failures.
  console.log(
    forced404Observed && failures > 0
      ? "SELF-TEST OK — a forced 404 fails the audit, as it must."
      : "SELF-TEST BROKEN — a forced 404 did not fail the audit.",
  );
  process.exit(forced404Observed && failures > 0 ? 0 : 1);
}
process.exit(ok ? 0 : 1);
