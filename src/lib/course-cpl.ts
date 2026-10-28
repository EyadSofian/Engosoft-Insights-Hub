/**
 * Course CPL shown in the CRM-facing dashboard. The denominator is the
 * counted Odoo CRM cohort (including Lost records), not platform-reported
 * conversion events. Keep this distinct from PerfRow.cpl, whose denominator
 * is platform leads.
 */
export function courseCrmCpl(spend: number, crmLeads: number): number | null {
  if (!Number.isFinite(spend) || !Number.isFinite(crmLeads) || spend <= 0 || crmLeads <= 0)
    return null;
  return spend / crmLeads;
}
