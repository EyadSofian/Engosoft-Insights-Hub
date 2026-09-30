// Read-only reconciliation against the published dashboard's Odoo-backed APIs.
// Keep only ranking fields; never write customer contact data to the audit.
import { mkdir, writeFile } from "node:fs/promises";
import { buildLeadRankings, leadRankingWindow } from "../src/lib/lead-ranking.ts";

const month = process.argv[2] ?? "2026-10";
const origin =
  process.env.LEAD_RANKING_AUDIT_URL ?? "https://engosoft-insights-hub-production.up.railway.app";
const window = leadRankingWindow(month);
async function read(path, from, to) {
  const url = new URL(path, origin);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}
async function complete(path, from, to) {
  let reconciliationRequests = 0;
  const body = await read(path, from, to);
  if (!body.detail || !Array.isArray(body.detail.rows)) throw new Error(`${path}: missing detail`);
  if (!body.detail.truncated) {
    if (body.detail.rows.length !== body.detail.total)
      throw new Error(`${path}: incomplete detail`);
    return { rows: body.detail.rows, health: body.health, requests: 1 };
  }
  if (from === to) throw new Error(`${path}: daily data exceeds API cap; refusing partial audit`);
  const start = Date.parse(from);
  const end = Date.parse(to);
  const middle = Math.floor((end - start) / 86_400_000 / 2);
  const leftEnd = new Date(start + middle * 86_400_000).toISOString().slice(0, 10);
  const rightStart = new Date(start + (middle + 1) * 86_400_000).toISOString().slice(0, 10);
  const [left, right] = await Promise.all([
    complete(path, from, leftEnd),
    complete(path, rightStart, to),
  ]);
  if (left.rows.length + right.rows.length !== body.detail.total) {
    const refreshed = await read(path, from, to);
    reconciliationRequests++;
    if (left.rows.length + right.rows.length !== refreshed.detail.total)
      throw new Error(
        `${path}: source changed during audit (${body.detail.total} then ${refreshed.detail.total} vs ${left.rows.length + right.rows.length} partition rows); refusing an inconsistent audit`,
      );
  }
  return {
    rows: [...left.rows, ...right.rows],
    health: body.health,
    requests: 1 + reconciliationRequests + left.requests + right.requests,
  };
}

const [leads, accounting] = await Promise.all([
  complete("/api/leads", window.from, window.to),
  complete("/api/accounting", window.from, window.to),
]);
const crm = [];
const lost = [];
for (const row of leads.rows) {
  const fact = {
    id: row.id,
    salesperson: row.salesperson,
    salesTeam: row.salesTeam,
    course: row.course,
    courses: row.courses ?? "",
    createdAt: row.createdAt,
  };
  if (row.status === "lost") lost.push(fact);
  else
    crm.push({
      ...fact,
      isWon: row.status === "won",
      wonDate: row.wonDate ?? "",
      closedAt: row.closedAt ?? "",
    });
}
const invoices = accounting.rows.map((row) => ({
  id: row.id,
  salesperson: row.salesperson,
  salesTeam: row.salesTeam,
  course: row.course,
  product: row.product,
  productCategory: row.productCategory,
  company: row.company,
  usdPaid: row.usdPaid,
  movement: row.movement,
  isCreditNote: row.isCreditNote,
  paymentDate: row.paymentDate,
  invoiceDate: row.invoiceDate,
}));
const result = buildLeadRankings({ month, crm, lost, accounting: invoices });
const audit = {
  fetchedAt: new Date().toISOString(),
  source: origin,
  complete: true,
  leadRecords: leads.rows.length,
  accountingLines: invoices.length,
  requestCount: leads.requests + accounting.requests,
  netPaidUsd: invoices.reduce((sum, row) => sum + row.usdPaid, 0),
  // Public Lost detail has no exact product labels. Specialty ranks can be
  // reconciled here; product-level denominators require the native Odoo read.
  caveat:
    "Public Lost detail lacks exact course-product labels. Course rankings need the native Odoo source; audit employee aliases use normalized names only.",
};
await mkdir(".data", { recursive: true });
await writeFile(
  `.data/lead-ranking-${month}.json`,
  JSON.stringify(
    {
      ...result,
      audit,
      health: {
        crm: leads.health.crmAuthority,
        lost: "odoo-direct",
        accounting: accounting.health.accountingAuthority,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      ...audit,
      window,
      specialties: result.groups
        .filter((group) => group.course === null)
        .map((group) => ({
          specialization: group.specialization,
          employees: group.rows.length,
          ranked: group.rows.filter((row) => row.rank !== null).length,
          undatedWon: group.rows.reduce((sum, row) => sum + row.undatedWon, 0),
        })),
      diagnostics: result.diagnostics,
    },
    null,
    2,
  ),
);
