/**
 * CRM pipeline contract for crm_pipeline_redesign 17.0.1.26.0.
 *
 * Keep lifecycle decisions here instead of inferring them from translated
 * labels in routes or metrics. Odoo exposes `stage_is_lost` / `stage_is_won`
 * from XMLID-backed server helpers, so callers can classify records without
 * hard-coding database ids or English stage names.
 */
export const CRM_CONTRACT_VERSION = "17.0.1.26.0";

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
