/**
 * Manual lead QA: a person's verified verdict about one CRM lead.
 *
 * This is NOT the AI call-quality score. Call quality grades how a recorded
 * call was handled; lead QA records whether a reviewer, having opened the lead
 * with its Yeastar and Chatwoot evidence, confirms it was contacted and whether
 * the lead itself is valid. The two never share a column or a number.
 *
 * Verdicts live in their own table (`lead_quality_verifications`), which no
 * sync job truncates or rebuilds, and never change the Odoo stage.
 */

export const LEAD_QA_STATUSES = [
  "unverified",
  "verified_contacted",
  "verified_uncontacted",
  "verified_valid_lead",
  "verified_bad_lead",
  "disputed",
  "needs_review",
] as const;
export type LeadQaStatus = (typeof LEAD_QA_STATUSES)[number];

export const LEAD_QA_CONTACT_VERDICTS = ["", "contacted", "not_contacted", "unclear"] as const;
export type LeadQaContactVerdict = (typeof LEAD_QA_CONTACT_VERDICTS)[number];

export const LEAD_QA_QUALITY_VERDICTS = ["", "valid", "invalid", "unclear"] as const;
export type LeadQaQualityVerdict = (typeof LEAD_QA_QUALITY_VERDICTS)[number];

export const LEAD_QA_LIMITS = {
  reason: 200,
  notes: 2_000,
  salesperson: 160,
  evidenceSnapshotBytes: 16_000,
} as const;

export interface LeadQaVerification {
  crmLeadId: string;
  verificationStatus: LeadQaStatus;
  contactVerdict: LeadQaContactVerdict;
  leadQualityVerdict: LeadQaQualityVerdict;
  reason: string;
  notes: string;
  /** Owner of the lead when it was verified, so employee rollups survive reassignment. */
  salesperson: string;
  verifiedBy: string;
  verifiedAt: string | null;
  updatedAt: string | null;
  evidenceSnapshot: Record<string, unknown>;
  evidenceVersion: string;
}

export type LeadQaInput = Pick<
  LeadQaVerification,
  | "crmLeadId"
  | "verificationStatus"
  | "contactVerdict"
  | "leadQualityVerdict"
  | "reason"
  | "notes"
  | "salesperson"
  | "evidenceSnapshot"
  | "evidenceVersion"
>;

export const isLeadQaStatus = (value: unknown): value is LeadQaStatus =>
  typeof value === "string" && (LEAD_QA_STATUSES as readonly string[]).includes(value);

export const isVerifiedStatus = (status: LeadQaStatus): boolean => status.startsWith("verified_");

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** The verdict a status implies; a conflicting explicit verdict is rejected, a blank one is filled. */
const IMPLIED: Partial<
  Record<LeadQaStatus, { contact?: LeadQaContactVerdict; quality?: LeadQaQualityVerdict }>
> = {
  verified_contacted: { contact: "contacted" },
  verified_uncontacted: { contact: "not_contacted" },
  verified_valid_lead: { quality: "valid" },
  verified_bad_lead: { quality: "invalid" },
};

export function validateLeadQaInput(
  raw: unknown,
): { ok: true; value: LeadQaInput } | { ok: false; errors: string[] } {
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const errors: string[] = [];
  const crmLeadId = text(body.crmLeadId);
  if (!/^\d{1,12}$/.test(crmLeadId)) errors.push("crmLeadId must be an Odoo numeric id");
  const verificationStatus = body.verificationStatus;
  if (!isLeadQaStatus(verificationStatus)) errors.push("verificationStatus is not a known status");
  let contactVerdict = text(body.contactVerdict) as LeadQaContactVerdict;
  if (!(LEAD_QA_CONTACT_VERDICTS as readonly string[]).includes(contactVerdict))
    errors.push("contactVerdict is not a known verdict");
  let leadQualityVerdict = text(body.leadQualityVerdict) as LeadQaQualityVerdict;
  if (!(LEAD_QA_QUALITY_VERDICTS as readonly string[]).includes(leadQualityVerdict))
    errors.push("leadQualityVerdict is not a known verdict");
  const reason = text(body.reason);
  const notes = text(body.notes);
  const salesperson = text(body.salesperson);
  if (reason.length > LEAD_QA_LIMITS.reason) errors.push("reason is too long");
  if (notes.length > LEAD_QA_LIMITS.notes) errors.push("notes are too long");
  if (salesperson.length > LEAD_QA_LIMITS.salesperson) errors.push("salesperson is too long");

  const snapshot =
    body.evidenceSnapshot && typeof body.evidenceSnapshot === "object" && !Array.isArray(body.evidenceSnapshot)
      ? (body.evidenceSnapshot as Record<string, unknown>)
      : {};
  if (JSON.stringify(snapshot).length > LEAD_QA_LIMITS.evidenceSnapshotBytes)
    errors.push("evidenceSnapshot is too large");
  const evidenceVersion = text(body.evidenceVersion).slice(0, 64);

  if (isLeadQaStatus(verificationStatus)) {
    const implied = IMPLIED[verificationStatus];
    if (implied?.contact) {
      if (contactVerdict && contactVerdict !== implied.contact)
        errors.push(`${verificationStatus} requires contactVerdict "${implied.contact}"`);
      contactVerdict = implied.contact;
    }
    if (implied?.quality) {
      if (leadQualityVerdict && leadQualityVerdict !== implied.quality)
        errors.push(`${verificationStatus} requires leadQualityVerdict "${implied.quality}"`);
      leadQualityVerdict = implied.quality;
    }
    if ((verificationStatus === "verified_bad_lead" || verificationStatus === "disputed") && !reason && !notes)
      errors.push(`${verificationStatus} needs a reason or notes`);
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      crmLeadId,
      verificationStatus: verificationStatus as LeadQaStatus,
      contactVerdict,
      leadQualityVerdict,
      reason,
      notes,
      salesperson,
      evidenceSnapshot: snapshot,
      evidenceVersion,
    },
  };
}

export interface LeadQaSummary {
  assignedLeads: number;
  verified: number;
  unverified: number;
  needsReview: number;
  disputed: number;
  verifiedContacted: number;
  verifiedUncontacted: number;
  /** Leads verified as valid, from either the status or the quality verdict. */
  verifiedValid: number;
  verifiedInvalid: number;
  /** Verified ÷ assigned leads, 0–100; null with no assigned leads. */
  verificationRate: number | null;
}

/**
 * Rolls verdicts up over the leads an employee was assigned. Leads with no row
 * are `unverified`; rows for leads outside the population are ignored so the
 * rate never exceeds 100%.
 */
export function summarizeLeadQa(
  leadIds: readonly string[],
  verifications: ReadonlyMap<string, Pick<LeadQaVerification, "verificationStatus" | "leadQualityVerdict">>,
): LeadQaSummary {
  const ids = [...new Set(leadIds.filter(Boolean))];
  const summary: LeadQaSummary = {
    assignedLeads: ids.length,
    verified: 0,
    unverified: 0,
    needsReview: 0,
    disputed: 0,
    verifiedContacted: 0,
    verifiedUncontacted: 0,
    verifiedValid: 0,
    verifiedInvalid: 0,
    verificationRate: null,
  };
  for (const id of ids) {
    const row = verifications.get(id);
    const status = row?.verificationStatus ?? "unverified";
    if (isVerifiedStatus(status)) summary.verified += 1;
    if (status === "unverified") summary.unverified += 1;
    if (status === "needs_review") summary.needsReview += 1;
    if (status === "disputed") summary.disputed += 1;
    if (status === "verified_contacted") summary.verifiedContacted += 1;
    if (status === "verified_uncontacted") summary.verifiedUncontacted += 1;
    if (isVerifiedStatus(status) && (status === "verified_valid_lead" || row?.leadQualityVerdict === "valid"))
      summary.verifiedValid += 1;
    if (isVerifiedStatus(status) && (status === "verified_bad_lead" || row?.leadQualityVerdict === "invalid"))
      summary.verifiedInvalid += 1;
  }
  summary.verificationRate = ids.length ? (summary.verified / ids.length) * 100 : null;
  return summary;
}
