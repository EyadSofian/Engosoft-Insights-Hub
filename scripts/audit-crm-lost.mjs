#!/usr/bin/env node
/**
 * Read-only CRM Lost audit.
 *
 * Produces aggregate evidence only: no names, phone numbers, emails or API
 * credentials are printed. Run with Railway's environment so the same Odoo
 * authority used by production is tested:
 *
 *   railway run npm run audit:crm-lost -- --from=2026-09-01 --to=2026-09-15
 */
import { loadDirectCrm } from "../src/lib/crm-odoo.server.ts";
import { loadLostRegistrationAudit } from "../src/lib/crm-lost-registration-audit.server.ts";
import { groupByCanonicalReason } from "../src/lib/loss-reason-taxonomy.ts";
import { auditDuplicateReasons } from "../src/lib/lost-duplicate-audit.ts";

const arg = (name, fallback) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const from = arg("from", "2026-09-01");
const to = arg("to", new Date().toISOString().slice(0, 10));
if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
  throw new Error("Use a valid --from=YYYY-MM-DD and --to=YYYY-MM-DD range.");
}

const day = (value) => String(value ?? "").slice(0, 10);
const inRange = (value) => {
  const date = day(value);
  return Boolean(date && date >= from && date <= to);
};
const text = (row, key) => String(row[key] ?? "").trim();
const subject = (row, reason = "") => ({
  id: text(row, "__odoo_id"),
  phone: text(row, "Phone") || text(row, "رقم الهاتف"),
  mobile: text(row, "Mobile") || text(row, "الهاتف المحمول"),
  facebookLeadId: text(row, "Facebook Lead ID"),
  lossReason: reason || text(row, "سبب الضياع"),
});

const [snapshot, registrationAudit] = await Promise.all([
  loadDirectCrm(),
  loadLostRegistrationAudit(),
]);
const cohortLost = snapshot.lost.filter((row) => inRange(text(row, "أنشئ في")));
const closedLost = snapshot.lost.filter((row) => inRange(text(row, "Lost Date")));
const closingDateLost = snapshot.lost.filter((row) => inRange(text(row, "Closing Date")));
const reasons = groupByCanonicalReason(cohortLost, (row) => text(row, "سبب الضياع"));
const universe = [...snapshot.crm, ...snapshot.lost].map((row) => subject(row));
const duplicateAudit = auditDuplicateReasons(
  cohortLost.map((row) => subject(row)),
  universe,
);
const dateBasis = Object.fromEntries(
  [...new Set(closedLost.map((row) => text(row, "Lost Date Basis") || "unknown"))]
    .map((basis) => [
      basis,
      closedLost.filter((row) => (text(row, "Lost Date Basis") || "unknown") === basis).length,
    ])
    .sort((a, b) => b[1] - a[1]),
);
const reasonTotal = reasons.reduce((sum, reason) => sum + reason.count, 0);
const fallbackDateCount = Object.entries(dateBasis)
  .filter(([basis]) => basis.includes("fallback") || basis === "unknown" || basis === "missing")
  .reduce((sum, [, count]) => sum + count, 0);

const report = {
  auditVersion: "crm-lost-audit/1",
  checkedAt: new Date().toISOString(),
  period: { from, to },
  authority: "Odoo live read-only",
  populations: {
    activeCrmSinceConfiguredFloor: snapshot.crm.length,
    canonicalLostSinceConfiguredFloor: snapshot.lost.length,
    cohortLost: cohortLost.length,
    closedLostInPeriod: closedLost.length,
    closingDateLostInPeriod: closingDateLost.length,
  },
  invariants: {
    reasonBreakdownEqualsCohort: reasonTotal === cohortLost.length,
    reasonBreakdownTotal: reasonTotal,
    lostDateEqualsClosingDate: snapshot.lost.every(
      (row) => day(text(row, "Lost Date")) === day(text(row, "Closing Date")),
    ),
    duplicatePartitionEqualsDeclared:
      duplicateAudit.supportedCount + duplicateAudit.unsupportedCount ===
      duplicateAudit.declaredCount,
  },
  reasons: reasons.map((reason) => ({
    key: reason.canonicalReasonKey,
    count: reason.count,
    share: Number(reason.share.toFixed(4)),
    rawSpellings: reason.rawReasons.length,
  })),
  duplicateAudit: {
    declaredCount: duplicateAudit.declaredCount,
    declaredShare: duplicateAudit.declaredShare,
    identitySupportedCount: duplicateAudit.supportedCount,
    needsReviewCount: duplicateAudit.unsupportedCount,
    supportRate: duplicateAudit.supportRate,
    identityGroups: duplicateAudit.identityGroups,
    universeRecords: duplicateAudit.universeRecords,
  },
  lostDateAudit: {
    basisCounts: dateBasis,
    fallbackOrUnknownCount: fallbackDateCount,
    fallbackOrUnknownShare: closedLost.length
      ? (fallbackDateCount / closedLost.length) * 100
      : null,
  },
  registrationAudit: {
    available: registrationAudit.available,
    basis: registrationAudit.basis,
    counts: registrationAudit.counts,
    unregisteredRecordIds: registrationAudit.rows.map((row) => row.id),
  },
  loaderDiagnostics: snapshot.diagnostics,
};

if (arg("repeat-direct", "0") === "1") {
  const repeated = await loadDirectCrm();
  report.repeatedDirectRead = {
    rows: repeated.lost.length,
    cohortLost: repeated.lost.filter((row) => inRange(text(row, "أنشئ في"))).length,
    closedLostInPeriod: repeated.lost.filter((row) => inRange(text(row, "Lost Date"))).length,
    dateBasisCounts: Object.fromEntries(
      [...new Set(repeated.lost.map((row) => text(row, "Lost Date Basis") || "unknown"))].map(
        (basis) => [
          basis,
          repeated.lost.filter((row) => (text(row, "Lost Date Basis") || "unknown") === basis)
            .length,
        ],
      ),
    ),
  };
}

if (arg("enrichment", "0") === "1") {
  const { readDashboardDataset } = await import("../src/lib/dashboard-db.server.ts");
  const stored = await readDashboardDataset("lost");
  const priorById = new Map(stored.rows.map((row) => [text(row, "__odoo_id"), row]));
  const directById = new Map(snapshot.lost.map((row) => [text(row, "__odoo_id"), row]));
  const enriched = snapshot.lost.map((row) => ({
    ...(priorById.get(text(row, "__odoo_id")) ?? {}),
    ...row,
  }));
  report.enrichmentAudit = {
    storedRows: stored.rows.length,
    enrichedRows: enriched.length,
    directClosingDateInPeriod: snapshot.lost.filter((row) => inRange(text(row, "Closing Date")))
      .length,
    enrichedClosingDateInPeriod: enriched.filter((row) => inRange(text(row, "Closing Date")))
      .length,
    enrichedLostDateInPeriod: enriched.filter((row) => inRange(text(row, "Lost Date"))).length,
    dateFieldsPreserved: enriched.every((row) => {
      const direct = directById.get(text(row, "__odoo_id"));
      return (
        text(row, "Closing Date") === text(direct ?? {}, "Closing Date") &&
        text(row, "Lost Date") === text(direct ?? {}, "Lost Date")
      );
    }),
  };
}

if (arg("app-projection", "0") === "1") {
  const { getFiltered } = await import("../src/lib/metrics.server.ts");
  const [cohortProjection, closedProjection] = await Promise.all([
    getFiltered({ from, to }),
    getFiltered({ from, to, lostDateBasis: "closed" }),
  ]);
  report.appProjection = {
    authority: cohortProjection.snapshot.health.lostAuthority,
    snapshotRows: cohortProjection.snapshot.lost.length,
    cohortLost: cohortProjection.lost.length,
    closedLostInPeriod: closedProjection.lost.length,
    dateBasisCounts: Object.fromEntries(
      [...new Set(closedProjection.lost.map((row) => row.lostDateBasis || "unknown"))].map(
        (basis) => [
          basis,
          closedProjection.lost.filter((row) => (row.lostDateBasis || "unknown") === basis).length,
        ],
      ),
    ),
  };
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
