// Server-only authoritative CRM reader.
//
// CRM and Lost are two disjoint Odoo populations:
//   - CRM: active records assigned to a real user, excluding any Lost/Closed
//     Lost stage and the non-commercial Old Auto Dialer stage.
//   - Lost: archived opportunities (active=false, probability=0) handled by an
//     internal user backed by an Employee record and carrying a Lost Reason.
//
// Credentials stay in environment variables and are consumed by odoo.server.
// This module deliberately returns sheet-shaped rows so the existing campaign,
// course, ad-set and metrics pipeline can keep one normalization path.
import {
  companyContext,
  m2oId,
  m2oName,
  odooCall,
  odooConfig,
  searchRead,
  type Domain,
  type M2O,
} from "./odoo.server";

export type CrmRawRow = Record<string, string>;

interface OdooField {
  string?: string;
  type?: string;
  relation?: string;
}

interface OdooCrmLead {
  id: number;
  name?: string | false;
  active?: boolean;
  type?: string | false;
  partner_name?: string | false;
  contact_name?: string | false;
  priority?: string | false;
  user_id?: M2O;
  team_id?: M2O;
  stage_id?: M2O;
  company_id?: M2O;
  campaign_id?: M2O;
  source_id?: M2O;
  lost_reason_id?: M2O;
  create_date?: string | false;
  write_date?: string | false;
  date_last_stage_update?: string | false;
  date_closed?: string | false;
  probability?: number;
  [key: string]: unknown;
}

interface OdooUser {
  id: number;
  name: string;
  share: boolean;
  active: boolean;
}

interface OdooEmployee {
  id: number;
  user_id: M2O;
  active: boolean;
}

export interface CrmExclusionDiagnostics {
  candidates: number;
  accepted: number;
  unassigned: number;
  technicalIdentity: number;
  nonInternalUser: number;
  noEmployee: number;
  excludedStage: number;
  wrongType: number;
  missingLostReason: number;
}

export interface DirectCrmSnapshot {
  crm: CrmRawRow[];
  lost: CrmRawRow[];
  diagnostics: {
    crm: CrmExclusionDiagnostics;
    lost: CrmExclusionDiagnostics;
  };
}

const emptyDiagnostics = (): CrmExclusionDiagnostics => ({
  candidates: 0,
  accepted: 0,
  unassigned: 0,
  technicalIdentity: 0,
  nonInternalUser: 0,
  noEmployee: 0,
  excludedStage: 0,
  wrongType: 0,
  missingLostReason: 0,
});

const normalize = (value: unknown): string =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[_–—/\\().?:]+/g, " ")
    .replace(/\s+/g, " ");

const PUBLIC_TECHNICAL_USER_NAMES = new Set(["public user for ksa - engosoft"]);

function isTechnicalIdentity(name: string, includeEngosoftDomain: boolean): boolean {
  const normalized = normalize(name);
  if (PUBLIC_TECHNICAL_USER_NAMES.has(normalized)) return true;
  if (includeEngosoftDomain && normalized === "engosoft.com") return true;
  return /\b(public|portal|website|system|technical)\s+user\b|\bbot\b/.test(normalized);
}

function isExcludedCrmStage(stage: string): boolean {
  const normalized = normalize(stage);
  if (normalized === "old auto dialer") return true;
  if (normalized === "lost" || normalized === "closed lost" || normalized === "close lost")
    return true;
  if (/(^|\s)lost($|\s)/.test(normalized)) return true;
  return /مفقود|خاسر|ضائع|خسارة/.test(normalized);
}

function display(value: unknown): string {
  if (value === false || value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    if (value.length === 2 && typeof value[0] === "number" && typeof value[1] === "string") {
      return String(value[1]).trim();
    }
    return value
      .map((part) => String(part ?? "").trim())
      .filter(Boolean)
      .join(", ");
  }
  return String(value).trim();
}

function date(value: unknown): string {
  return dateTime(value).slice(0, 10);
}

function dateTime(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const instant = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(raw) ? raw : `${raw.replace(" ", "T")}Z`);
  if (!Number.isFinite(instant.getTime())) return raw;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

function normalizeFieldLabel(value: unknown): string {
  return normalize(value).replace(/\s/g, "");
}

function resolveField(
  metadata: Record<string, OdooField>,
  candidates: string[],
  labels: string[],
): string {
  for (const candidate of candidates) if (metadata[candidate]) return candidate;
  const wanted = new Set(labels.map(normalizeFieldLabel));
  for (const [name, field] of Object.entries(metadata)) {
    if (wanted.has(normalizeFieldLabel(field.string))) return name;
  }
  return "";
}

interface CustomFields {
  adName: string;
  adId: string;
  adsetName: string;
  adsetId: string;
  campaignName: string;
  campaignId: string;
  courseCategories: string;
  callingReply: string;
}

function customFieldPlan(metadata: Record<string, OdooField>): CustomFields {
  return {
    adName: resolveField(
      metadata,
      ["x_studio_ad_name", "x_ad_name", "ad_name"],
      ["Ad Name", "اسم الإعلان"],
    ),
    adId: resolveField(metadata, ["x_studio_ad_id", "x_ad_id", "ad_id"], ["Ad ID", "معرف الإعلان"]),
    adsetName: resolveField(
      metadata,
      ["x_studio_ad_set_name", "x_ad_set_name", "ad_set_name", "adset_name"],
      ["Ad Set Name", "اسم مجموعة الإعلانات"],
    ),
    adsetId: resolveField(
      metadata,
      ["x_studio_ad_set_id", "x_ad_set_id", "ad_set_id", "adset_id"],
      ["Ad Set ID", "معرف مجموعة الإعلانات"],
    ),
    campaignName: resolveField(
      metadata,
      ["x_studio_campaign_name", "x_campaign_name"],
      ["Campaign Name", "اسم الحملة"],
    ),
    campaignId: resolveField(
      metadata,
      ["x_studio_campaign_id", "x_campaign_id"],
      ["Campaign ID", "معرف الحملة"],
    ),
    courseCategories: resolveField(
      metadata,
      [
        "x_studio_course_categories",
        "x_course_categories",
        "course_categories",
        "course_category_ids",
      ],
      ["Course Categories", "Course Category"],
    ),
    callingReply: resolveField(
      metadata,
      ["x_studio_calling_reply", "x_calling_reply", "calling_reply"],
      ["Calling reply?", "Calling Reply", "Call Reply"],
    ),
  };
}

function custom(lead: OdooCrmLead, field: string): string {
  return field ? display(lead[field]) : "";
}

function toCrmRaw(lead: OdooCrmLead, fields: CustomFields): CrmRawRow {
  const rawStage = m2oName(lead.stage_id);
  const rawSource = m2oName(lead.source_id);
  const rawCourse = custom(lead, fields.courseCategories);
  return {
    __odoo_id: String(lead.id),
    __odoo_write_date: dateTime(lead.write_date),
    "Ad Name": custom(lead, fields.adName),
    "Ad ID": custom(lead, fields.adId),
    "Ad Set Name": custom(lead, fields.adsetName),
    "Ad Set ID": custom(lead, fields.adsetId),
    "Campaign Name": custom(lead, fields.campaignName) || m2oName(lead.campaign_id),
    "Campaign ID": custom(lead, fields.campaignId),
    "اسم جهة الاتصال":
      display(lead.contact_name) || display(lead.partner_name) || display(lead.name),
    Salesperson: m2oName(lead.user_id),
    "فريق المبيعات": m2oName(lead.team_id),
    "Sales Team": m2oName(lead.team_id),
    Stage: rawStage,
    "Cleaned Stage": rawStage,
    "آخر تحديث للمرحلة": dateTime(lead.date_last_stage_update),
    "أنشئ في": dateTime(lead.create_date),
    "التاريخ المقفل": dateTime(lead.date_closed),
    "Closing Date": date(lead.date_closed),
    Source: rawSource,
    "cleaned Source": rawSource.split("[")[0].trim(),
    "Course Categories": rawCourse,
    Course: rawCourse,
    "Main Category": "",
    Priority: display(lead.priority),
    "Calling reply?": custom(lead, fields.callingReply),
    "سبب الضياع": m2oName(lead.lost_reason_id),
    "Date\r": date(lead.create_date),
    نشط: "true",
  };
}

function toLostRaw(lead: OdooCrmLead, fields: CustomFields): CrmRawRow {
  const rawStage = m2oName(lead.stage_id);
  const rawSource = m2oName(lead.source_id);
  const rawCourse = custom(lead, fields.courseCategories);
  return {
    __odoo_id: String(lead.id),
    __odoo_write_date: dateTime(lead.write_date),
    "Ad Name": custom(lead, fields.adName),
    "Ad ID": custom(lead, fields.adId),
    "Ad Set Name": custom(lead, fields.adsetName),
    "Ad Set ID": custom(lead, fields.adsetId),
    "Campaign Name": custom(lead, fields.campaignName) || m2oName(lead.campaign_id),
    "Campaign ID": custom(lead, fields.campaignId),
    "اسم جهة الاتصال":
      display(lead.contact_name) || display(lead.partner_name) || display(lead.name),
    "مندوب المبيعات": m2oName(lead.user_id),
    "فريق المبيعات": m2oName(lead.team_id),
    المرحلة: rawStage,
    "Cleaned Stage": rawStage,
    "أنشئ في": dateTime(lead.create_date),
    "التاريخ المقفل": dateTime(lead.date_closed),
    "Closing Date": date(lead.date_closed),
    "Course Categories": rawCourse,
    Course: rawCourse,
    "Main Category": "",
    "سبب الضياع": m2oName(lead.lost_reason_id),
    المصدر: rawSource,
    "cleaned Source": rawSource.split("[")[0].trim(),
    "Date\r": date(lead.create_date),
    نشط: "false",
  };
}

function validateActiveIdentity(lead: OdooCrmLead, diagnostics: CrmExclusionDiagnostics): boolean {
  const userId = m2oId(lead.user_id);
  if (!userId) {
    diagnostics.unassigned++;
    return false;
  }
  // The accepted CRM reference keeps the normal `engosoft.com` assignee but
  // excludes public/portal/website identities. Historical CRM leads are not
  // required to have a current hr.employee record.
  if (isTechnicalIdentity(m2oName(lead.user_id), false)) {
    diagnostics.technicalIdentity++;
    return false;
  }
  return true;
}

function validateLostIdentity(
  lead: OdooCrmLead,
  users: Map<number, OdooUser>,
  employeeUserIds: Set<number>,
  diagnostics: CrmExclusionDiagnostics,
): boolean {
  const userId = m2oId(lead.user_id);
  if (!userId) {
    diagnostics.unassigned++;
    return false;
  }
  const user = users.get(userId);
  const displayName = user?.name || m2oName(lead.user_id);
  if (isTechnicalIdentity(displayName, true)) {
    diagnostics.technicalIdentity++;
    return false;
  }
  if (!user || user.share) {
    diagnostics.nonInternalUser++;
    return false;
  }
  if (!employeeUserIds.has(userId)) {
    diagnostics.noEmployee++;
    return false;
  }
  return true;
}

/**
 * Reads both authoritative CRM populations in parallel. The caller owns
 * fallback behaviour; an Odoo error is never converted into an empty dataset.
 */
export async function loadDirectCrm(): Promise<DirectCrmSnapshot> {
  const cfg = odooConfig();
  const metadata = await odooCall<Record<string, OdooField>>("crm.lead", "fields_get", [], {
    attributes: ["string", "type", "relation"],
    context: companyContext({ active_test: false }),
  });
  const customFields = customFieldPlan(metadata);
  const standardFields = [
    "id",
    "name",
    "active",
    "type",
    "partner_name",
    "contact_name",
    "priority",
    "user_id",
    "team_id",
    "stage_id",
    "company_id",
    "campaign_id",
    "source_id",
    "lost_reason_id",
    "create_date",
    "write_date",
    "date_last_stage_update",
    "date_closed",
    "probability",
  ];
  const fields = [
    ...new Set([
      ...standardFields.filter((field) => metadata[field]),
      ...Object.values(customFields).filter(Boolean),
    ]),
  ];
  // Pull one extra UTC day, then apply the reporting floor after converting to
  // Cairo. This keeps records created near midnight in the same day as Odoo UI.
  const floorDay = new Date(`${cfg.startDate}T00:00:00Z`);
  floorDay.setUTCDate(floorDay.getUTCDate() - 1);
  const floor = `${floorDay.toISOString().slice(0, 10)} 00:00:00`;
  const activeDomain: Domain = [
    ["active", "=", true],
    ["create_date", ">=", floor],
  ];
  const lostDomain: Domain = [
    ["active", "=", false],
    ["probability", "=", 0],
    // Lost reporting is based on when the opportunity was actually closed,
    // not when the lead was first created. This also keeps an old lead that was
    // closed during the selected reporting period in the correct month.
    ["date_closed", ">=", floor],
  ];

  const [activeCandidates, lostCandidates, rawUsers, employees] = await Promise.all([
    searchRead<OdooCrmLead>("crm.lead", activeDomain, fields, {
      context: { active_test: false },
    }),
    searchRead<OdooCrmLead>("crm.lead", lostDomain, fields, {
      context: { active_test: false },
    }),
    searchRead<OdooUser>("res.users", [["share", "=", false]], ["name", "share", "active"], {
      context: { active_test: false },
    }),
    searchRead<OdooEmployee>("hr.employee", [], ["user_id", "active"], {
      context: { active_test: false },
    }),
  ]);

  const users = new Map(rawUsers.map((user) => [user.id, user]));
  const employeeUserIds = new Set(
    employees.map((employee) => m2oId(employee.user_id)).filter(Boolean),
  );

  const crmDiagnostics = emptyDiagnostics();
  const activeInPeriod = activeCandidates.filter((lead) => date(lead.create_date) >= cfg.startDate);
  crmDiagnostics.candidates = activeInPeriod.length;
  const crm = activeInPeriod
    .filter((lead) => {
      if (!validateActiveIdentity(lead, crmDiagnostics)) return false;
      if (isExcludedCrmStage(m2oName(lead.stage_id))) {
        crmDiagnostics.excludedStage++;
        return false;
      }
      return true;
    })
    .map((lead) => toCrmRaw(lead, customFields));
  crmDiagnostics.accepted = crm.length;

  const lostDiagnostics = emptyDiagnostics();
  const lostInPeriod = lostCandidates.filter((lead) => date(lead.date_closed) >= cfg.startDate);
  lostDiagnostics.candidates = lostInPeriod.length;
  const lost = lostInPeriod
    .filter((lead) => {
      if (!validateLostIdentity(lead, users, employeeUserIds, lostDiagnostics)) return false;
      if (normalize(lead.type) !== "opportunity") {
        lostDiagnostics.wrongType++;
        return false;
      }
      if (!m2oId(lead.lost_reason_id)) {
        lostDiagnostics.missingLostReason++;
        return false;
      }
      return true;
    })
    .map((lead) => toLostRaw(lead, customFields));
  lostDiagnostics.accepted = lost.length;

  return {
    crm,
    lost,
    diagnostics: { crm: crmDiagnostics, lost: lostDiagnostics },
  };
}
