import { loadCrmRawByDomain } from "./crm-odoo.server";
import { crmNormalScopeDomain } from "./crm-contract";
import { cairoDate, lostEventWindow } from "./crm-lost-events";
import { matchesLostMovementDimensions } from "./crm-lost-movement.server";
import { odooConfig } from "./odoo.server";
import type { Snapshot } from "./sheet-cache.server";
import type { GlobalFilters } from "./types";

export interface FreshLostPipelineRecord {
  id: string;
  recordType: "lead" | "opportunity";
  active: boolean;
  contact: string;
  createdAt: string;
  stage: string;
  source: string;
  salesperson: string;
  salesTeam: string;
  company: string;
  course: string;
  lossReason: string;
  lostCategory: string;
  odooUrl: string;
}
export interface FreshLostPipelineResult {
  availability: "available" | "unavailable";
  total: number | null;
  error?: string;
  integrationLogin: string;
  companyIds: number[];
  bounds: { start?: string; end?: string };
  domain: unknown[];
  fetchedAt: string;
  records: FreshLostPipelineRecord[];
}

/** Matches Odoo Pipeline: Creation Date + Stage Is Lost, not event timing.
 * Archived Leads and historical archived Opportunities are not this population.
 */
export function freshLostPipelineDomain(filters: GlobalFilters): unknown[] {
  const bounds = lostEventWindow(filters.from, filters.to);
  const domain: unknown[] = [
    ["type", "=", "opportunity"],
    ["active", "=", true],
    ["stage_is_lost", "=", true],
  ];
  if (bounds.start) domain.push(["create_date", ">=", bounds.start]);
  if (bounds.end) domain.push(["create_date", "<", bounds.end]);
  return domain;
}

export function archivedLostLeadsDomain(filters: GlobalFilters): unknown[] {
  const bounds = lostEventWindow(filters.from, filters.to);
  const domain: unknown[] = [
    ["type", "=", "lead"],
    ["active", "=", false],
    ["lost_reason_id", "!=", false],
  ];
  if (bounds.start) domain.push(["create_date", ">=", bounds.start]);
  if (bounds.end) domain.push(["create_date", "<", bounds.end]);
  return domain;
}

async function readFreshLostPipeline(
  filters: GlobalFilters,
  snapshot: Snapshot,
  kind: "pipeline" | "archived" = "pipeline",
): Promise<FreshLostPipelineResult> {
  const cfg = odooConfig();
  const businessDomain =
    kind === "pipeline" ? freshLostPipelineDomain(filters) : archivedLostLeadsDomain(filters);
  const base = {
    integrationLogin: cfg.login,
    companyIds: cfg.companyIds,
    bounds: lostEventWindow(filters.from, filters.to),
    domain: crmNormalScopeDomain(businessDomain),
    fetchedAt: new Date().toISOString(),
  };
  try {
    const rows = await loadCrmRawByDomain(businessDomain, {
      attempts: 1,
      timeoutMs: 30_000,
      signal: AbortSignal.timeout(45_000),
    });
    const records = new Map<string, FreshLostPipelineRecord>();
    for (const row of rows) {
      // Defense in depth: don't borrow the broader archived-Lost population.
      if (
        row["Inventory Bucket"] ||
        (kind === "pipeline"
          ? row["Record Type"] !== "opportunity" ||
            row["Record Active"] !== "true" ||
            row["Stage Key"] !== "lost"
          : row["Record Type"] !== "lead" ||
            row["Record Active"] !== "false" ||
            !row["سبب الضياع"]) ||
        !matchesLostMovementDimensions(row, filters, snapshot)
      )
        continue;
      const createdUtc = row.__odoo_create_date_utc || "";
      if (base.bounds.start && createdUtc < base.bounds.start) continue;
      if (base.bounds.end && createdUtc >= base.bounds.end) continue;
      const id = row.__odoo_id;
      if (!id) continue;
      records.set(id, {
        id,
        recordType: row["Record Type"] === "lead" ? "lead" : "opportunity",
        active: row["Record Active"] === "true",
        contact: row["اسم جهة الاتصال"] || "",
        createdAt: cairoDate(createdUtc),
        stage: row.Stage || "",
        source: row.Source || "",
        salesperson: row.Salesperson || "",
        salesTeam: row["Sales Team"] || "",
        company: row.Company || "",
        course: row.Course || "",
        lossReason: row["سبب الضياع"] || "",
        lostCategory: row["فئة الضياع"] || row["Lost Category"] || "",
        odooUrl: `${cfg.url}/web#id=${encodeURIComponent(id)}&model=crm.lead&view_type=form`,
      });
    }
    return {
      ...base,
      fetchedAt: new Date().toISOString(),
      availability: "available",
      total: records.size,
      records: [...records.values()],
    };
  } catch (error) {
    return {
      ...base,
      availability: "unavailable",
      total: null,
      records: [],
      error: error instanceof Error ? error.message : "Current Lost pipeline read failed",
    };
  }
}

const cache = new Map<
  string,
  { snapshot: Snapshot; expiresAt: number; promise: Promise<FreshLostPipelineResult> }
>();
export function loadFreshLostPipeline(
  filters: GlobalFilters,
  snapshot: Snapshot,
): Promise<FreshLostPipelineResult> {
  return loadCurrentLostCohort(filters, snapshot, "pipeline");
}
export function loadArchivedLostLeads(
  filters: GlobalFilters,
  snapshot: Snapshot,
): Promise<FreshLostPipelineResult> {
  return loadCurrentLostCohort(filters, snapshot, "archived");
}
function loadCurrentLostCohort(
  filters: GlobalFilters,
  snapshot: Snapshot,
  kind: "pipeline" | "archived",
): Promise<FreshLostPipelineResult> {
  const cfg = odooConfig();
  const key = JSON.stringify([kind, cfg.url, cfg.db, cfg.login, cfg.companyIds, filters]);
  const current = cache.get(key);
  if (current && current.snapshot === snapshot && current.expiresAt > Date.now())
    return current.promise;
  if (cache.size >= 20) cache.delete(cache.keys().next().value!);
  const promise = readFreshLostPipeline(filters, snapshot, kind);
  const entry = { snapshot, expiresAt: Number.POSITIVE_INFINITY, promise };
  cache.set(key, entry);
  void promise.then(
    () => {
      entry.expiresAt = Date.now() + 15_000;
    },
    () => {
      cache.delete(key);
    },
  );
  return promise;
}
