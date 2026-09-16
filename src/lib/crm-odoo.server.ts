// Server-only authoritative CRM reader.
//
// CRM and Lost are two disjoint Odoo populations under the 1.26 contract:
//   - CRM: active Leads plus active open/Won Opportunities.
//   - Lost: archived Leads with a reason, active Lost-stage Opportunities, and
//     historical archived Lost Opportunities.
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
import {
  crmBusinessStatus,
  crmStageKeyForExternalId,
  isCanonicalLost,
  isCrmRecordType,
  type CrmContractRecord,
  type CrmStageKey,
} from "./crm-contract";

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
  phone?: string | false;
  mobile?: string | false;
  email_from?: string | false;
  user_id?: M2O;
  team_id?: M2O;
  stage_id?: M2O;
  company_id?: M2O;
  campaign_id?: M2O;
  source_id?: M2O;
  medium_id?: M2O;
  lang_id?: M2O;
  lost_reason_id?: M2O;
  lost_category_id?: M2O;
  stage_is_lost?: boolean;
  stage_is_won?: boolean;
  create_date?: string | false;
  write_date?: string | false;
  date_last_stage_update?: string | false;
  date_closed?: string | false;
  lost_verification_date?: string | false;
  won_date?: string | false;
  date_conversion?: string | false;
  probability?: number;
  automated_probability?: number;
  closing_duration_days?: number;
  product_ids?: number[];
  tag_ids?: number[];
  [key: string]: unknown;
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

export function dateTime(value: unknown): string {
  // Odoo serialises an empty date/datetime as the boolean `false`. Turning it
  // into the literal string "false" makes it truthy and prevents every
  // documented fallback (`lost_verification_date` -> stage date -> close date).
  if (value === false || value === null || value === undefined) return "";
  const raw = String(value ?? "").trim();
  if (!raw || raw.toLowerCase() === "false") return "";
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
      ["campaign_name", "x_studio_campaign_name", "x_campaign_name"],
      ["Campaign Name", "اسم الحملة"],
    ),
    campaignId: resolveField(
      metadata,
      ["campaign_id2", "x_studio_campaign_id", "x_campaign_id"],
      ["Campaign ID", "معرف الحملة"],
    ),
    courseCategories: resolveField(
      metadata,
      ["x_studio_course_categories"],
      ["Course Categories", "Course Category"],
    ),
    callingReply: resolveField(
      metadata,
      ["x_studio_answered", "x_studio_calling_reply", "x_calling_reply", "calling_reply"],
      ["Calling reply?", "Calling Reply", "Call Reply"],
    ),
  };
}

function custom(lead: OdooCrmLead, field: string): string {
  return field ? display(lead[field]) : "";
}

function contractRecord(
  lead: OdooCrmLead,
  stageKeys?: Map<number, CrmStageKey>,
): CrmContractRecord {
  // The redesigned module publishes stable XMLIDs for every lifecycle stage.
  // Some Odoo installations do not expose the optional computed
  // `stage_is_lost`/`stage_is_won` fields on crm.lead, so the XMLID mapping is
  // the durable authority rather than letting those records fall into `other`.
  const mappedStage = stageKeys?.get(m2oId(lead.stage_id));
  return {
    type: normalize(lead.type),
    active: lead.active !== false,
    stageIsLost: lead.stage_is_lost === true || mappedStage === "lost",
    stageIsWon: lead.stage_is_won === true || mappedStage === "won",
    hasLostReason: m2oId(lead.lost_reason_id) > 0,
  };
}

/**
 * Resolve stable stage XMLIDs through the stage model itself.
 *
 * `ir.model.data` is intentionally restricted for the reporting service
 * account in production, even though the same account can read crm.stage.
 * Odoo's model-level `get_external_id` exposes a stable XMLID without widening
 * that account's access to system metadata. The mapping includes documented
 * legacy aliases where a stage has more than one XMLID.
 */
async function loadStageKeys(): Promise<Map<number, CrmStageKey>> {
  const stages = await searchRead<{ id: number }>("crm.stage", [], ["id"], {
    context: { active_test: false },
  });
  if (!stages.length) return new Map();

  const externalIds = await odooCall<Record<string, string | false>>(
    "crm.stage",
    "get_external_id",
    [stages.map((stage) => stage.id)],
    { context: { active_test: false } },
  );
  return new Map(
    stages.map((stage) => [stage.id, crmStageKeyForExternalId(externalIds[String(stage.id)])]),
  );
}

function actualStageKey(lead: OdooCrmLead, stageKeys: Map<number, CrmStageKey>): CrmStageKey {
  const mappedStage = stageKeys.get(m2oId(lead.stage_id));
  if (lead.stage_is_lost || mappedStage === "lost") return "lost";
  if (lead.stage_is_won || mappedStage === "won") return "won";
  return mappedStage ?? "other";
}

/**
 * Build an Odoo OR domain using only fields that the live model publishes.
 * `lost_verification_date` belongs to the redesigned module and is optional
 * during a rollout; mentioning an absent field makes the whole search_read
 * fail, which had silently forced production back onto its old snapshot.
 */
function dateSinceDomain(
  metadata: Record<string, OdooField>,
  candidates: string[],
  floor: string,
): Domain {
  const clauses = candidates
    .filter((field) => Boolean(metadata[field]))
    .map((field) => [field, ">=", floor]);
  if (clauses.length <= 1) return clauses;
  return [...Array(clauses.length - 1).fill("|"), ...clauses];
}

function lossDate(lead: OdooCrmLead): string {
  return normalize(lead.type) === "opportunity"
    ? dateTime(lead.lost_verification_date) ||
        dateTime(lead.date_last_stage_update) ||
        dateTime(lead.date_closed)
    : dateTime(lead.date_closed) || dateTime(lead.write_date);
}

function lossDateBasis(lead: OdooCrmLead): string {
  if (normalize(lead.type) === "opportunity") {
    if (dateTime(lead.lost_verification_date)) return "lost_verification_date";
    if (dateTime(lead.date_last_stage_update)) return "date_last_stage_update_fallback";
    if (dateTime(lead.date_closed)) return "date_closed_fallback";
    return "missing";
  }
  if (dateTime(lead.date_closed)) return "date_closed";
  if (dateTime(lead.write_date)) return "write_date_fallback";
  return "missing";
}

function priorityLabel(lead: OdooCrmLead): string {
  const business = display(lead.priority2);
  if (business) return { "0": "Cold", "1": "Intermediate", "2": "Hot" }[business] ?? business;
  const core = display(lead.priority);
  return { "0": "Low", "1": "Medium", "2": "High", "3": "Very High" }[core] ?? core;
}

function commonRaw(
  lead: OdooCrmLead,
  fields: CustomFields,
  stageKeys: Map<number, CrmStageKey>,
  productNames: Map<number, string>,
  tagNames: Map<number, string>,
): CrmRawRow {
  const rawStage = m2oName(lead.stage_id);
  const rawSource = m2oName(lead.source_id);
  const rawCourse = custom(lead, fields.courseCategories);
  const contract = contractRecord(lead, stageKeys);
  const status = crmBusinessStatus(contract);
  return {
    __odoo_id: String(lead.id),
    __odoo_write_date: dateTime(lead.write_date),
    "Record Type": contract.type,
    "Record Active": String(contract.active),
    "Business Status": status ?? "archived",
    "Stage Key": actualStageKey(lead, stageKeys),
    "Ad Name": custom(lead, fields.adName),
    "Ad ID": custom(lead, fields.adId),
    "Ad Set Name": custom(lead, fields.adsetName),
    "Ad Set ID": custom(lead, fields.adsetId),
    // Odoo's visible Campaign field (`utm.campaign`) is the authority. The
    // legacy custom text remains a fallback for older imported records only.
    "Campaign Name": m2oName(lead.campaign_id) || custom(lead, fields.campaignName),
    "Campaign ID": custom(lead, fields.campaignId),
    "اسم جهة الاتصال":
      display(lead.contact_name) || display(lead.partner_name) || display(lead.name),
    Phone: display(lead.phone),
    Mobile: display(lead.mobile),
    Email: display(lead.email_from),
    Salesperson: m2oName(lead.user_id),
    "فريق المبيعات": m2oName(lead.team_id),
    "Sales Team": m2oName(lead.team_id),
    Stage: rawStage,
    "Cleaned Stage": rawStage,
    "آخر تحديث للمرحلة": dateTime(lead.date_last_stage_update),
    "أنشئ في": dateTime(lead.create_date),
    "التاريخ المقفل": dateTime(lead.date_closed),
    "Closing Date": date(lead.date_closed),
    "Lost Date": lossDate(lead),
    "Lost Date Basis": lossDateBasis(lead),
    "Won Date": dateTime(lead.won_date),
    "Conversion Date": dateTime(lead.date_conversion),
    Source: rawSource,
    "cleaned Source": rawSource.split("[")[0].trim(),
    Medium: m2oName(lead.medium_id as M2O),
    "Communication Language": m2oName(lead.lang_id as M2O),
    "Course Categories": rawCourse,
    Course: rawCourse,
    Courses: (lead.product_ids ?? [])
      .map((id) => productNames.get(Number(id)) ?? "")
      .filter(Boolean)
      .join(", "),
    "Main Category": "",
    Priority: priorityLabel(lead),
    Probability: String(lead.probability ?? 0),
    "Automated Probability": String(lead.automated_probability ?? 0),
    "Closing Duration Days": String(lead.closing_duration_days ?? 0),
    "Ready to Convert": display(lead.x_studio_ready_to_convert_1),
    "Lead Segment": m2oName(lead.lead_segment_id as M2O),
    "Open Status": m2oName(lead.open_status_id as M2O),
    "Closing Won Channel": m2oName(lead.closing_channel_id as M2O),
    "Lost Category": m2oName(lead.lost_category_id),
    "Inventory Bucket": display(lead.inventory_bucket),
    "Course Language": display(lead.course_languages),
    "Course Type": display(lead.course_type),
    "Customer Type": display(lead.customer_type),
    "Job Type": display(lead.x_studio_customer_type_1),
    "How Found Us": display(lead.x_studio_how_found_us),
    Company: m2oName(lead.company_id),
    Tags: (lead.tag_ids ?? [])
      .map((id) => tagNames.get(Number(id)) ?? "")
      .filter(Boolean)
      .join(", "),
    "Target Name": display(lead.target_name),
    "Resign Target": display(lead.resign_target),
    "Facebook Lead ID": display(lead.fb_lead_id),
    "Validate Closed Lost Reason": display(lead.x_studio_validate_closed_reason),
    "Calling reply?": custom(lead, fields.callingReply),
    "سبب الضياع": m2oName(lead.lost_reason_id),
    "Date\r": date(lead.create_date),
    نشط: String(contract.active),
  };
}

function toCrmRaw(
  lead: OdooCrmLead,
  fields: CustomFields,
  stageKeys: Map<number, CrmStageKey>,
  productNames: Map<number, string>,
  tagNames: Map<number, string>,
): CrmRawRow {
  return commonRaw(lead, fields, stageKeys, productNames, tagNames);
}

function toLostRaw(
  lead: OdooCrmLead,
  fields: CustomFields,
  stageKeys: Map<number, CrmStageKey>,
  productNames: Map<number, string>,
  tagNames: Map<number, string>,
): CrmRawRow {
  const raw = commonRaw(lead, fields, stageKeys, productNames, tagNames);
  const canonicalLostDate = lossDate(lead);
  return {
    ...raw,
    // Private authority fields are deliberately outside the legacy Sheet
    // schema. Stored/enrichment rows have historically reused the visible
    // `Closing Date`/`Lost Date` columns with different meanings; keeping the
    // canonical Odoo values under dedicated keys prevents that old payload
    // from changing an operational closure count during a merge.
    __canonical_lost_date: canonicalLostDate,
    __canonical_lost_date_basis: lossDateBasis(lead),
    "مندوب المبيعات": raw.Salesperson,
    المرحلة: raw.Stage,
    المصدر: raw.Source,
    // `date_closed` is empty for active Lost-stage Opportunities in 1.26.
    // Keep the raw value above for audit, but use the canonical per-type date
    // for movement reporting and the Lost workspace.
    "Closing Date": canonicalLostDate.slice(0, 10),
    "Lost Date": canonicalLostDate,
  };
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
    "phone",
    "mobile",
    "email_from",
    "user_id",
    "team_id",
    "stage_id",
    "company_id",
    "campaign_id",
    "source_id",
    "medium_id",
    "lang_id",
    "lost_reason_id",
    "lost_category_id",
    "stage_is_lost",
    "stage_is_won",
    "create_date",
    "write_date",
    "date_last_stage_update",
    "date_closed",
    "lost_verification_date",
    "won_date",
    "date_conversion",
    "probability",
    "automated_probability",
    "closing_duration_days",
    "product_ids",
    "tag_ids",
    "priority2",
    "x_studio_ready_to_convert_1",
    "lead_segment_id",
    "open_status_id",
    "closing_channel_id",
    "inventory_bucket",
    "course_languages",
    "course_type",
    "customer_type",
    "x_studio_customer_type_1",
    "x_studio_how_found_us",
    "target_name",
    "resign_target",
    "fb_lead_id",
    "x_studio_validate_closed_reason",
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
    ...dateSinceDomain(
      metadata,
      ["create_date", "lost_verification_date", "date_last_stage_update"],
      floor,
    ),
  ];
  const inactiveDomain: Domain = [
    ["active", "=", false],
    ...dateSinceDomain(
      metadata,
      ["create_date", "date_closed", "lost_verification_date", "date_last_stage_update"],
      floor,
    ),
  ];

  const [activeCandidates, inactiveCandidates, stageKeys] = await Promise.all([
    searchRead<OdooCrmLead>("crm.lead", activeDomain, fields, {
      context: { active_test: false },
    }),
    searchRead<OdooCrmLead>("crm.lead", inactiveDomain, fields, {
      context: { active_test: false },
    }),
    loadStageKeys(),
  ]);
  const productIds = [
    ...new Set(
      [...activeCandidates, ...inactiveCandidates]
        .flatMap((lead) => lead.product_ids ?? [])
        .map(Number)
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ];
  const tagIds = [
    ...new Set(
      [...activeCandidates, ...inactiveCandidates]
        .flatMap((lead) => lead.tag_ids ?? [])
        .map(Number)
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ];
  const [products, tags] = await Promise.all([
    productIds.length
      ? searchRead<{ id: number; display_name?: string }>(
          "product.product",
          [["id", "in", productIds]],
          ["display_name"],
          { context: { active_test: false } },
        )
      : [],
    tagIds.length
      ? searchRead<{ id: number; display_name?: string }>(
          "crm.tag",
          [["id", "in", tagIds]],
          ["display_name"],
          { context: { active_test: false } },
        )
      : [],
  ]);
  const productNames = new Map(products.map((product) => [product.id, product.display_name ?? ""]));
  const tagNames = new Map(tags.map((tag) => [tag.id, tag.display_name ?? ""]));

  const crmDiagnostics = emptyDiagnostics();
  const activeInPeriod = activeCandidates.filter((lead) => date(lead.create_date) >= cfg.startDate);
  crmDiagnostics.candidates = activeInPeriod.length;
  const crm = activeInPeriod
    .filter((lead) => {
      const contract = contractRecord(lead, stageKeys);
      if (!isCrmRecordType(contract.type)) {
        crmDiagnostics.wrongType++;
        return false;
      }
      // Operational dashboard scope mirrors the Leads/Pipeline actions.
      if (display(lead.inventory_bucket)) {
        crmDiagnostics.excludedStage++;
        return false;
      }
      // The Lost population owns active Lost-stage Opportunities so the two
      // arrays stay disjoint and all downstream denominators remain exact.
      if (isCanonicalLost(contract)) return false;
      return true;
    })
    .map((lead) => toCrmRaw(lead, customFields, stageKeys, productNames, tagNames));
  crmDiagnostics.accepted = crm.length;

  const lostDiagnostics = emptyDiagnostics();
  const lostInPeriod = [...activeCandidates, ...inactiveCandidates].filter(
    (lead) =>
      date(lead.create_date) >= cfg.startDate ||
      date(lead.date_closed) >= cfg.startDate ||
      date(lead.lost_verification_date) >= cfg.startDate ||
      date(lead.date_last_stage_update) >= cfg.startDate,
  );
  lostDiagnostics.candidates = lostInPeriod.length;
  const lost = lostInPeriod
    .filter((lead) => {
      const contract = contractRecord(lead, stageKeys);
      if (!isCrmRecordType(contract.type)) {
        lostDiagnostics.wrongType++;
        return false;
      }
      if (display(lead.inventory_bucket)) {
        lostDiagnostics.excludedStage++;
        return false;
      }
      return isCanonicalLost(contract);
    })
    .map((lead) => toLostRaw(lead, customFields, stageKeys, productNames, tagNames));
  lostDiagnostics.accepted = lost.length;

  return {
    crm,
    lost,
    diagnostics: { crm: crmDiagnostics, lost: lostDiagnostics },
  };
}
