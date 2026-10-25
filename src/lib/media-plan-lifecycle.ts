import type { CrmLeadRow, LostRow } from "./types";

export interface MediaPlanLifecycle {
  leadActive: number;
  leadLost: number;
  leadOther: number;
  opportunities: number;
  opportunityLost: number;
}

export type MediaPlanLifecycleBucket = "lead_active" | "lead_lost" | "lead_other" | "opportunity";

export function emptyMediaPlanLifecycle(): MediaPlanLifecycle {
  return { leadActive: 0, leadLost: 0, leadOther: 0, opportunities: 0, opportunityLost: 0 };
}

/** A Lost opportunity stays inside the opportunity total; it is never another lead. */
export function addMediaPlanLifecycle(
  total: MediaPlanLifecycle,
  row: Pick<CrmLeadRow | LostRow, "recordType" | "businessStatus">,
): void {
  if (row.recordType === "opportunity") {
    total.opportunities++;
    if (row.businessStatus === "lost") total.opportunityLost++;
  } else if (row.businessStatus === "lost") {
    total.leadLost++;
  } else {
    total.leadActive++;
  }
}

export function mediaPlanLifecycleTotal(value: MediaPlanLifecycle): number {
  return value.leadActive + value.leadLost + value.leadOther + value.opportunities;
}

/** Only current opportunities count toward opportunity-based media-plan attainment. */
export function mediaPlanOpportunityActual(value: MediaPlanLifecycle): number {
  return value.opportunities;
}
