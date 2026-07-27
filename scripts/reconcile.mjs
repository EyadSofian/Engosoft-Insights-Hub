#!/usr/bin/env node
/**
 * Reconciliation gate.
 *
 * Recomputes every headline number straight from the Google Sheet, with code
 * that deliberately shares nothing with the dashboard, then compares the result
 * against a running instance's `/api/overview`. Any disagreement fails.
 *
 * This exists because the failure this project keeps hitting is not a crash —
 * it is a number that is quietly wrong, or a build that never shipped. Both are
 * invisible to a type checker and to every test that mocks its input. Running
 * this against production answers "is the deployed site telling the truth?" in
 * one command.
 *
 *   node scripts/reconcile.mjs                       # against localhost:3000
 *   node scripts/reconcile.mjs --api https://app.tld # against the deployment
 *   node scripts/reconcile.mjs --from 2026-01-01 --to 2026-07-26
 *
 * Exit code 0 = the app agrees with the sheet. 1 = it does not.
 */
import Papa from "papaparse";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
}

const SHEET_ID = args.get("sheet") || process.env.SHEET_ID || "14kv8Xkv8SeFhF9roekDI0OKmpZBU29YQOlMj03LOKT0";
const API = (args.get("api") || process.env.RECONCILE_API || "http://localhost:3000").replace(/\/+$/, "");
/** Largest relative gap treated as agreement. Rounding only — not a slack budget. */
const TOLERANCE = Number(args.get("tolerance") ?? 0.005);

const TABS = {
  meta: "Meta Ads Daily",
  snap: "Snap Ads Daily",
  tiktok: "TikTok Ads Daily",
  crm: "CRM Leads",
  lost: "Lost Analysis",
  sales: "Sales",
  invoiced: "Full Invoiced Orders",
};
/** Tabs that may not exist yet; absent is a gap, not a failure. */
const OPTIONAL = new Set(["tiktok"]);

/* --- fetch ---------------------------------------------------------------- */

async function tab(name) {
  const url =
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq` +
    `?tqx=out:csv&sheet=${encodeURIComponent(name)}&_cb=${Date.now()}`;
  const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const parsed = Papa.parse(await res.text(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  return parsed.data.filter((r) => r && Object.keys(r).length > 0);
}

/* --- primitives (intentionally re-implemented, not imported) -------------- */

const str = (v) => (v == null ? "" : String(v).trim());
const num = (v) => {
  const n = parseFloat(String(v ?? "").replace(/[,\s$%]/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Same contract as the app's parseDate: ISO or US slash, always YYYY-MM-DD. */
function day(v) {
  const s = str(v);
  if (!s) return "";
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const mo = +iso[2];
    const da = +iso[3];
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return "";
    return `${iso[1]}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
  }
  const sl = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (sl) {
    const a = +sl[1];
    const b = +sl[2];
    const y = sl[3].length === 2 ? 2000 + +sl[3] : +sl[3];
    const mo = a > 12 && b <= 12 ? b : a;
    const da = a > 12 && b <= 12 ? a : b;
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return "";
    return `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

const within = (d, from, to) => !!d && (!from || d >= from) && (!to || d <= to);
const pick = (row, ...cols) => {
  for (const c of cols) {
    const v = str(row[c]);
    if (v) return v;
  }
  return "";
};

/* --- recompute ------------------------------------------------------------ */

async function fromSheet(from, to) {
  const names = Object.entries(TABS);
  const loaded = await Promise.all(
    names.map(async ([key, name]) => {
      try {
        return [key, await tab(name)];
      } catch (e) {
        if (OPTIONAL.has(key)) return [key, []];
        throw new Error(`could not read "${name}": ${e.message}`);
      }
    }),
  );
  const D = Object.fromEntries(loaded);

  const adRows = [
    ...D.meta.map((r) => ({
      date: day(r["التاريخ"]),
      spend: num(r["Spend (Cost)"]),
      leads: num(r["Leads (on facebook Leads)"]),
    })),
    ...D.snap.map((r) => ({
      date: day(r["التاريخ"]),
      spend: num(r["Spend (Cost)"]),
      leads: num(pick(r, "Leads (Native)", "Leads", "On-Facebook leads")),
    })),
    ...D.tiktok.map((r) => ({
      date: day(pick(r, "التاريخ", "Date")),
      spend: num(pick(r, "Spend (Cost)", "Cost", "Spend")),
      leads: num(pick(r, "Leads (Native)", "Leads", "On-Facebook leads")),
    })),
  ].filter((r) => within(r.date, from, to));

  // Same approved rule as the app, restated rather than imported: stage Lost
  // belongs to Lost Analysis alone, and Old Auto Dialer rows are not leads.
  const EXCLUDED = new Set(["lost", "old auto dialer"]);
  const EXCLUDED_ARCHIVED = new Set(["old auto dialer"]);

  const crm = D.crm
    .filter((r) => str(r["__odoo_id"]))
    .map((r) => ({
      date: day(r["أنشئ في"]),
      stage: pick(r, "Cleaned Stage", "Stage").toLowerCase(),
    }))
    .filter((r) => within(r.date, from, to) && !EXCLUDED.has(r.stage));

  const seenLost = new Set();
  const lost = D.lost
    .filter((r) => str(r["__odoo_id"]))
    .filter((r) => {
      const id = str(r["__odoo_id"]);
      if (seenLost.has(id)) return false;
      seenLost.add(id);
      return true;
    })
    .map((r) => ({
      date: day(r["أنشئ في"]),
      stage: pick(r, "Cleaned Stage", "المرحلة").toLowerCase(),
    }))
    .filter((r) => within(r.date, from, to) && !EXCLUDED_ARCHIVED.has(r.stage));

  const sales = D.sales
    .filter((r) => str(r["__odoo_id"]))
    .map((r) => ({
      date: day(r["Payment Date"]),
      usd: num(r["$ Sales"]),
      ref: pick(r, "Sales Order #", "حركة"),
    }))
    .filter((r) => within(r.date, from, to));

  const invoiced = D.invoiced
    .filter((r) => str(r["__odoo_id"]))
    .map((r) => ({
      date: day(r["Date"]) || day(r["بنود الطلب /أنشئ في"]) || day(r["Invoice Date"]),
      usd: num(r["$ Sales"]),
    }))
    .filter((r) => within(r.date, from, to));

  const add = (rows, f) => rows.reduce((s, r) => s + f(r), 0);
  const spend = add(adRows, (r) => r.spend);
  const platformLeads = add(adRows, (r) => r.leads);
  const archivedWon = lost.filter((r) => r.stage === "won").length;
  const lostCount = lost.length - archivedWon;
  const totalLeads = crm.length + lost.length;
  const won = crm.filter((r) => r.stage === "won").length;
  const revenue = add(sales, (r) => r.usd);
  const orders = new Set(sales.map((r) => r.ref).filter(Boolean)).size || sales.length;

  return {
    spend,
    platformLeads,
    totalLeads,
    crmLeads: crm.length,
    archivedLeads: lost.length,
    archivedWon,
    lost: lostCount,
    won,
    revenue,
    orderRevenue: add(invoiced, (r) => r.usd),
    orders,
    conversionRate: totalLeads ? (won / totalLeads) * 100 : null,
    lostRate: totalLeads ? (lostCount / totalLeads) * 100 : null,
    cpl: platformLeads ? spend / platformLeads : null,
    cpa: won ? spend / won : null,
    roas: spend ? revenue / spend : null,
    acos: revenue ? (spend / revenue) * 100 : null,
  };
}

/* --- compare -------------------------------------------------------------- */

const FIELDS = [
  "spend",
  "platformLeads",
  "totalLeads",
  "crmLeads",
  "archivedLeads",
  "archivedWon",
  "lost",
  "won",
  "revenue",
  "orderRevenue",
  "orders",
  "conversionRate",
  "lostRate",
  "cpl",
  "cpa",
  "roas",
  "acos",
];

const show = (v) =>
  v === null || v === undefined ? "—" : typeof v === "number" ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(v);

async function main() {
  let from = args.get("from");
  let to = args.get("to");

  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  const url = `${API}/api/overview${qs.size ? `?${qs}` : ""}`;

  process.stdout.write(`sheet : ${SHEET_ID}\napi   : ${url}\n\n`);

  let payload;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    payload = await res.json();
  } catch (e) {
    console.error(`FAIL — could not read ${url}: ${e.message}`);
    console.error("Start the app (npm run dev) or pass --api <deployed-url>.");
    process.exit(1);
  }

  // Whatever window the app actually applied is the window to check against,
  // otherwise the default range makes every row disagree for no real reason.
  from = payload.appliedFilters?.from ?? from;
  to = payload.appliedFilters?.to ?? to;
  process.stdout.write(`window: ${from || "(none)"} → ${to || "(none)"}\n\n`);

  const truth = await fromSheet(from, to);
  const app = payload.totals ?? {};

  const rows = [];
  let failures = 0;
  for (const f of FIELDS) {
    const a = truth[f];
    const b = app[f];
    let ok;
    if (a === null || b === null || a === undefined || b === undefined) {
      ok = (a ?? null) === (b ?? null);
    } else {
      const scale = Math.max(Math.abs(a), Math.abs(b), 1);
      ok = Math.abs(a - b) / scale <= TOLERANCE;
    }
    if (!ok) failures++;
    rows.push([f, show(a), show(b), ok ? "ok" : "DIFFERS"]);
  }

  const w = (i) => Math.max(...rows.map((r) => r[i].length), [ "metric", "sheet", "app", "" ][i].length);
  const pad = (s, n, right = false) => (right ? String(s).padStart(n) : String(s).padEnd(n));
  const head = ["metric", "sheet", "app", ""];
  process.stdout.write(
    `${pad(head[0], w(0))}  ${pad(head[1], w(1), true)}  ${pad(head[2], w(2), true)}  ${head[3]}\n`,
  );
  process.stdout.write(`${"-".repeat(w(0) + w(1) + w(2) + 12)}\n`);
  for (const r of rows) {
    process.stdout.write(`${pad(r[0], w(0))}  ${pad(r[1], w(1), true)}  ${pad(r[2], w(2), true)}  ${r[3]}\n`);
  }

  const gaps = payload.health?.platformsWithoutSpendTab ?? [];
  if (gaps.length) {
    process.stdout.write(
      `\nnote: spend is incomplete — ${gaps
        .map((g) => `${g.platform} (${g.leads} leads, no spend tab)`)
        .join(", ")}\n` +
        "      the two sides agree, but both are missing that platform's cost.\n",
    );
  }

  if (failures) {
    process.stdout.write(`\nFAIL — ${failures} metric(s) disagree with the sheet.\n`);
    process.exit(1);
  }
  process.stdout.write("\nPASS — every metric matches the sheet.\n");
}

main().catch((e) => {
  console.error(`FAIL — ${e.message}`);
  process.exit(1);
});
