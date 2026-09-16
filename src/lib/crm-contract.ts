/**
 * CRM pipeline contract for crm_pipeline_redesign 17.0.1.26.0.
 *
 * Keep lifecycle decisions here instead of inferring them from translated
 * labels in routes or metrics. Odoo exposes `stage_is_lost` / `stage_is_won`
 * from XMLID-backed server helpers, so callers can classify records without
 * hard-coding database ids or English stage names.
 */
export const CRM_CONTRACT_VERSION = "17.0.1.26.0";

/**
 * Serialization/classification revision for persisted CRM snapshots.
 *
 * The Odoo module version alone is not enough to invalidate last-good rows:
 * dashboard-only authority fields can change without a module upgrade. Bump
 * this value whenever the persisted raw-row shape, date semantics, or source
 * scope changes so a deploy cannot keep serving a stale snapshot.
 */
export const CRM_SNAPSHOT_SCHEMA_REVISION = "normal-crm-inventory-scope-v3";

/**
 * Stable business scope for every normal CRM dashboard population.
 *
 * This condition must travel with the Odoo query. Relying on the integration
 * user's record rules would make dashboard totals change when that user's
 * groups change. Preparation is deliberately absent: it is a normal CRM stage,
 * not a synonym for Data Inventory.
 */
export const CRM_NORMAL_SCOPE_FILTER = ["inventory_bucket", "=", false] as const;

export function crmNormalScopeDomain(domain: readonly unknown[] = []): unknown[] {
  return [[...CRM_NORMAL_SCOPE_FILTER], ...domain];
}

export type CrmRecordType = "lead" | "opportunity";
export type CrmBusinessStatus = "lead" | "open" | "won" | "lost";
export type CrmStageKey = "preparation" | "new" | "open" | "quotation" | "won" | "lost" | "other";

export interface CrmContractRecord {
  type: string;
  active: boolean;
  stageIsLost: boolean;
  stageIsWon: boolean;
  hasLostReason: boolean;
}

/**
 * Lifecycle stages by stable XMLID. Odoo's `get_external_id` returns one XMLID
 * per stage, and Preparation / Quotation Sent predate the redesign, so their
 * documented core aliases must resolve to the same lane. Never map stage names:
 * they are translated and were historically reused.
 */
export const CRM_STAGE_EXTERNAL_IDS: ReadonlyMap<string, CrmStageKey> = new Map<
  string,
  Exclude<CrmStageKey, "other">
>([
  ["crm_pipeline_redesign.stage_preparation", "preparation"],
  ["crm.stage_lead1", "preparation"],
  ["crm_pipeline_redesign.stage_new", "new"],
  ["crm_pipeline_redesign.stage_open", "open"],
  ["crm_pipeline_redesign.stage_quotation_sent", "quotation"],
  ["crm.stage_lead4", "quotation"],
  ["crm_pipeline_redesign.stage_won", "won"],
  ["crm_pipeline_redesign.stage_lost", "lost"],
]);

export function crmStageKeyForExternalId(externalId: unknown): CrmStageKey {
  return (typeof externalId === "string" && CRM_STAGE_EXTERNAL_IDS.get(externalId)) || "other";
}

/**
 * Identity of the classification baked into stored CRM/Lost snapshots. The
 * stage table is part of it, so a deploy that changes how stages resolve
 * re-reads Odoo instead of serving lanes classified by the previous build for
 * the whole direct-refresh window.
 */
export function crmSnapshotRevision(
  stageExternalIds: ReadonlyMap<string, CrmStageKey> = CRM_STAGE_EXTERNAL_IDS,
): string {
  const stages = [...stageExternalIds].map(([xmlid, key]) => `${xmlid}=${key}`).sort();
  return [CRM_CONTRACT_VERSION, `schema=${CRM_SNAPSHOT_SCHEMA_REVISION}`, ...stages].join("|");
}

export const CRM_SNAPSHOT_REVISION = crmSnapshotRevision();

export function isCrmRecordType(type: string): type is CrmRecordType {
  return type === "lead" || type === "opportunity";
}

/** Lost Lead = archived + reason. Its stage is deliberately preserved. */
export function isLostLead(record: CrmContractRecord): boolean {
  return record.type === "lead" && !record.active && record.hasLostReason;
}

/** Current Lost Opportunity = active + XMLID-resolved Lost stage. */
export function isCurrentLostOpportunity(record: CrmContractRecord): boolean {
  return record.type === "opportunity" && record.active && record.stageIsLost;
}

/** Historical core-Odoo loss, retained for all-history reporting. */
export function isHistoricalLostOpportunity(record: CrmContractRecord): boolean {
  return (
    record.type === "opportunity" && !record.active && (record.hasLostReason || record.stageIsLost)
  );
}

export function isCanonicalLost(record: CrmContractRecord): boolean {
  return (
    isLostLead(record) || isCurrentLostOpportunity(record) || isHistoricalLostOpportunity(record)
  );
}

/** Won is stage-based; probability and `won_status` are not authorities. */
export function isCanonicalWon(record: CrmContractRecord): boolean {
  return record.type === "opportunity" && record.active && record.stageIsWon;
}

export function crmBusinessStatus(record: CrmContractRecord): CrmBusinessStatus | null {
  if (!isCrmRecordType(record.type)) return null;
  if (isCanonicalLost(record)) return "lost";
  if (isCanonicalWon(record)) return "won";
  if (!record.active) return null;
  return record.type === "lead" ? "lead" : "open";
}
