import {
  m2oName,
  odooCall,
  odooConfig,
  odooConfigured,
  searchCount,
  searchRead,
  type Domain,
  type M2O,
} from "./odoo.server";
import { crmNormalScopeDomain } from "./crm-contract";

interface OdooField {
  type?: string;
}

interface UnregisteredLostRow {
  id: number;
  name?: string | false;
  contact_name?: string | false;
  partner_name?: string | false;
  type?: string | false;
  active?: boolean;
  probability?: number;
  stage_id?: M2O;
  lost_reason_id?: M2O;
  user_id?: M2O;
  team_id?: M2O;
  source_id?: M2O;
  create_date?: string | false;
  date_closed?: string | false;
  date_last_stage_update?: string | false;
  write_date?: string | false;
  won_status?: string | false;
}

export interface LostRegistrationAuditRow {
  id: string;
  name: string;
  contact: string;
  recordType: "lead";
  stage: string;
  salesperson: string;
  salesTeam: string;
  source: string;
  createdAt: string;
  closeDate: string;
  lastStageUpdate: string;
  writeDate: string;
  stateEvidence: "odoo_lost_status" | "archived_zero_probability";
  issue: "missing_structured_lost_reason";
  odooUrl: string;
}

export interface LostRegistrationAudit {
  available: boolean;
  checkedAt: string;
  basis: "odoo_lost_status" | "archived_zero_probability" | "unavailable";
  counts: {
    registeredLostLeads: number | null;
    currentLostOpportunities: number | null;
    historicalLostOpportunities: number | null;
    unregisteredLostLeads: number | null;
    staleReasonOpenOpportunities: number | null;
  };
  rows: LostRegistrationAuditRow[];
  error?: string;
}

const EMPTY_COUNTS: LostRegistrationAudit["counts"] = {
  registeredLostLeads: null,
  currentLostOpportunities: null,
  historicalLostOpportunities: null,
  unregisteredLostLeads: null,
  staleReasonOpenOpportunities: null,
};

const day = (value: unknown): string => String(value || "").slice(0, 10);
const text = (value: unknown): string => (value === false ? "" : String(value ?? "").trim());

let cached: { expiresAt: number; value: LostRegistrationAudit } | null = null;
const CACHE_MS = 5 * 60_000;

export function buildLostRegistrationDomains(options: {
  hasWonStatus: boolean;
  hasStageLost: boolean;
}): {
  unregistered: Domain;
  registeredLostLeads: Domain;
  currentLostOpportunities: Domain;
  historicalLostOpportunities: Domain;
  staleReasonOpenOpportunities: Domain;
} {
  const { hasWonStatus, hasStageLost } = options;
  return {
    unregistered: crmNormalScopeDomain([
      ["type", "=", "lead"],
      ["active", "=", false],
      ["lost_reason_id", "=", false],
      ...(hasWonStatus ? [["won_status", "=", "lost"]] : [["probability", "=", 0]]),
    ]),
    registeredLostLeads: crmNormalScopeDomain([
      ["type", "=", "lead"],
      ["active", "=", false],
      ["lost_reason_id", "!=", false],
    ]),
    currentLostOpportunities: crmNormalScopeDomain(
      hasStageLost
        ? [
            ["type", "=", "opportunity"],
            ["active", "=", true],
            ["stage_is_lost", "=", true],
          ]
        : [["id", "=", -1]],
    ),
    historicalLostOpportunities: crmNormalScopeDomain(
      hasStageLost
        ? [
            ["type", "=", "opportunity"],
            ["active", "=", false],
            "|",
            ["lost_reason_id", "!=", false],
            ["stage_is_lost", "=", true],
          ]
        : [
            ["type", "=", "opportunity"],
            ["active", "=", false],
            ["lost_reason_id", "!=", false],
          ],
    ),
    staleReasonOpenOpportunities: crmNormalScopeDomain(
      hasStageLost
        ? [
            ["type", "=", "opportunity"],
            ["active", "=", true],
            ["lost_reason_id", "!=", false],
            ["stage_is_lost", "=", false],
          ]
        : [["id", "=", -1]],
    ),
  };
}

/**
 * Live, read-only audit of records Odoo considers Lost but which cannot enter
 * the canonical Registered Lost population because `lost_reason_id` is empty.
 *
 * These rows stay outside official Lost totals. Showing them as a separate
 * queue makes the Odoo defect actionable without corrupting the metric.
 */
export async function loadLostRegistrationAudit(): Promise<LostRegistrationAudit> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const checkedAt = new Date().toISOString();
  if (!odooConfigured()) {
    return {
      available: false,
      checkedAt,
      basis: "unavailable",
      counts: EMPTY_COUNTS,
      rows: [],
      error: "Odoo credentials are not configured for the Lost registration audit.",
    };
  }

  try {
    const metadata = await odooCall<Record<string, OdooField>>("crm.lead", "fields_get", [], {
      attributes: ["type"],
      context: { active_test: false },
    });
    const hasWonStatus = Boolean(metadata.won_status);
    const hasStageLost = Boolean(metadata.stage_is_lost);
    const basis: LostRegistrationAudit["basis"] = hasWonStatus
      ? "odoo_lost_status"
      : "archived_zero_probability";

    const domains = buildLostRegistrationDomains({ hasWonStatus, hasStageLost });
    const fields = [
      "id",
      "name",
      "contact_name",
      "partner_name",
      "type",
      "active",
      "probability",
      "stage_id",
      "lost_reason_id",
      "user_id",
      "team_id",
      "source_id",
      "create_date",
      "date_closed",
      "date_last_stage_update",
      "write_date",
      ...(hasWonStatus ? ["won_status"] : []),
    ].filter((field) => Boolean(metadata[field]));

    const [
      rows,
      registeredLostLeads,
      currentLostOpportunities,
      historicalLostOpportunities,
      stale,
    ] = await Promise.all([
      searchRead<UnregisteredLostRow>("crm.lead", domains.unregistered, fields, {
        order: "date_closed desc, id desc",
        context: { active_test: false },
      }),
      searchCount("crm.lead", domains.registeredLostLeads, { active_test: false }),
      searchCount("crm.lead", domains.currentLostOpportunities, { active_test: false }),
      searchCount("crm.lead", domains.historicalLostOpportunities, { active_test: false }),
      searchCount("crm.lead", domains.staleReasonOpenOpportunities, { active_test: false }),
    ]);

    const baseUrl = odooConfig().url;
    const value: LostRegistrationAudit = {
      available: true,
      checkedAt,
      basis,
      counts: {
        registeredLostLeads,
        currentLostOpportunities: hasStageLost ? currentLostOpportunities : null,
        historicalLostOpportunities,
        unregisteredLostLeads: rows.length,
        staleReasonOpenOpportunities: hasStageLost ? stale : null,
      },
      rows: rows.map((row) => ({
        id: String(row.id),
        name: text(row.name) || `CRM #${row.id}`,
        contact: text(row.contact_name) || text(row.partner_name) || text(row.name),
        recordType: "lead",
        stage: m2oName(row.stage_id),
        salesperson: m2oName(row.user_id),
        salesTeam: m2oName(row.team_id),
        source: m2oName(row.source_id),
        createdAt: day(row.create_date),
        closeDate: day(row.date_closed),
        lastStageUpdate: day(row.date_last_stage_update),
        writeDate: day(row.write_date),
        stateEvidence: hasWonStatus ? "odoo_lost_status" : "archived_zero_probability",
        issue: "missing_structured_lost_reason",
        odooUrl: `${baseUrl}/web#id=${row.id}&model=crm.lead&view_type=form`,
      })),
    };
    cached = { expiresAt: Date.now() + CACHE_MS, value };
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      available: false,
      checkedAt,
      basis: "unavailable",
      counts: EMPTY_COUNTS,
      rows: [],
      error: message.slice(0, 240),
    };
  }
}
