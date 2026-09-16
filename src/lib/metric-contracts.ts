/**
 * The reporting contract of every management KPI.
 *
 * One entry per displayed figure, stating where it comes from and exactly what
 * it counts. A KPI whose contract is missing here is not allowed on a
 * management screen (tests/unit/metric-contracts.test.ts enforces it for the
 * Marketing Overview). Descriptive only: the numbers are computed by the engine
 * each entry names.
 *
 * Vocabulary
 *   engine            which code path computes it; one engine per KPI
 *   grain             what one counted unit is
 *   dateBasis         which date places a unit inside the window
 *   attributionScope  what link a unit needs before it is counted
 *   platformScope     how the global platform/channel filter narrows it
 */

export type MetricEngine =
  | "metrics.server"
  | "closed-loop"
  | "accounting"
  | "lost-classification"
  | "lead-contact-evidence"
  | "lead-qa"
  | "revenue-cohort";

export type DateBasis =
  | "ad_spend_date"
  | "acquisition_event_date"
  | "crm_created_date"
  | "payment_date"
  | "lost_close_date"
  | "lead_created_cohort_all_payment_dates"
  | "call_and_chat_within_window_after_creation"
  | "verdict_on_leads_created_in_window";

export type AttributionScope =
  | "none"
  | "exact_meta_provider_ids"
  | "exact_sale_order_opportunity_link"
  | "campaign_or_source_match"
  | "phone_match";

export type PlatformScope =
  /** Narrowed by the selected platform/channel; All = every platform with a source. */
  | "selected_scope"
  /** Meta only by construction; unavailable when another platform is selected. */
  | "meta_only_exact"
  /** Not narrowed by platform (a CRM, finance or people population). */
  | "not_platform_scoped";

export interface MetricPart {
  description: string;
  source: string;
}

export interface MetricContract {
  key: string;
  label: { en: string; ar: string };
  engine: MetricEngine;
  source: string[];
  grain: string;
  numerator: MetricPart;
  /** Present only for ratios. */
  denominator?: MetricPart;
  dateBasis: DateBasis;
  /** Set when numerator and denominator use different date bases, stated explicitly. */
  denominatorDateBasis?: DateBasis;
  attributionScope: AttributionScope;
  platformScope: PlatformScope;
  /** When the value is null instead of a number. */
  nullWhen: string[];
}

const SPEND: MetricPart = {
  description: "Sum of `Spend (Cost)` over daily ad rows in the window for platforms in scope",
  source: "dashboard_rows meta_ads + snap_ads; TikTok, Google Ads and ChatGPT Ads APIs",
};
const META_SPEND: MetricPart = {
  description: "Sum of `Spend (Cost)` over Meta daily ad rows carrying an ad ID in the window",
  source: "dashboard_rows dataset meta_ads",
};
const TRACKED_SPEND: MetricPart = {
  description:
    "Meta spend of campaigns that produced at least one exactly attributed acquisition in the window",
  source: "dashboard_rows meta_ads ⨝ meta_entity_graph",
};
const EXACT_EVENTS: MetricPart = {
  description: "Acquisition events whose ad is resolved by Meta provider IDs (confidence exact)",
  source: "acquisition_events (meta_lead) ⨝ meta_entity_graph",
};
const EXACT_COHORT_REVENUE: MetricPart = {
  description:
    "Accounting USD paid (FX authority), any payment date to date, on sale orders linked to the CRM records of exactly attributed acquisitions in the window",
  source:
    "Accounting paid invoices ⨝ crm_sale_order_links ⨝ acquisition_crm_links (primary, exact)",
};

const c = (contract: MetricContract) => contract;

export const METRIC_CONTRACTS = {
  adSpend: c({
    key: "adSpend",
    label: { en: "Ad spend (selected scope)", ar: "صرف الإعلانات (النطاق المختار)" },
    engine: "metrics.server",
    source: [SPEND.source],
    grain: "platform daily ad row",
    numerator: SPEND,
    dateBasis: "ad_spend_date",
    attributionScope: "none",
    platformScope: "selected_scope",
    nullWhen: [
      "Organic is selected (organic carries no paid spend)",
      "the selected platform produced leads but its spend source returned no rows or failed",
    ],
  }),
  metaSpend: c({
    key: "metaSpend",
    label: { en: "Meta ad spend", ar: "صرف إعلانات Meta" },
    engine: "closed-loop",
    source: [META_SPEND.source],
    grain: "Meta daily ad row",
    numerator: META_SPEND,
    dateBasis: "ad_spend_date",
    attributionScope: "none",
    platformScope: "meta_only_exact",
    nullWhen: [
      "a non-Meta platform or Organic is selected",
      "Meta spend is not synced through the window",
    ],
  }),
  trackedSpend: c({
    key: "trackedSpend",
    label: { en: "Spend on tracked Meta campaigns", ar: "صرف حملات Meta المتتبَّعة" },
    engine: "closed-loop",
    source: [TRACKED_SPEND.source],
    grain: "Meta campaign",
    numerator: TRACKED_SPEND,
    dateBasis: "ad_spend_date",
    attributionScope: "exact_meta_provider_ids",
    platformScope: "meta_only_exact",
    nullWhen: [
      "a non-Meta platform or Organic is selected",
      "Meta spend is not synced through the window",
    ],
  }),
  leads: c({
    key: "leads",
    label: { en: "Acquisition events", ar: "أحداث الاستحواذ" },
    engine: "closed-loop",
    source: ["acquisition_events: meta leads, Chatwoot conversations, landing submissions"],
    grain: "acquisition event (not a unique person)",
    numerator: {
      description:
        "Count of acquisition events whose occurred_at falls in the window and whose source platform is in scope",
      source: "acquisition_events",
    },
    dateBasis: "acquisition_event_date",
    attributionScope: "none",
    platformScope: "selected_scope",
    nullWhen: ["the acquisition database is not configured"],
  }),
  uniqueCrmLeads: c({
    key: "uniqueCrmLeads",
    label: { en: "Unique CRM leads created", ar: "ليدز CRM فريدة أُنشئت" },
    engine: "metrics.server",
    source: ["dashboard_rows crm + lost (disjoint by Odoo id)"],
    grain: "unique CRM record (crm.lead id)",
    numerator: {
      description:
        "Active CRM records plus canonical Lost records created in the window, narrowed by platform campaign/source",
      source: "Odoo CRM via dashboard_rows crm, lost",
    },
    dateBasis: "crm_created_date",
    attributionScope: "campaign_or_source_match",
    platformScope: "selected_scope",
    nullWhen: ["the CRM snapshot is unavailable"],
  }),
  trackedLeads: c({
    key: "trackedLeads",
    label: { en: "Exactly attributed acquisitions", ar: "استحواذات بإسناد دقيق" },
    engine: "closed-loop",
    source: [EXACT_EVENTS.source],
    grain: "acquisition event",
    numerator: EXACT_EVENTS,
    dateBasis: "acquisition_event_date",
    attributionScope: "exact_meta_provider_ids",
    platformScope: "meta_only_exact",
    nullWhen: ["a non-Meta platform or Organic is selected"],
  }),
  exactAttributedLeads: c({
    key: "exactAttributedLeads",
    label: { en: "Unique exact-attributed CRM leads", ar: "ليدز CRM فريدة بإسناد دقيق" },
    engine: "closed-loop",
    source: ["acquisition_crm_links (primary, exact) ⨝ crm_lead_outcomes"],
    grain: "unique CRM record",
    numerator: {
      description:
        "Distinct CRM ids behind exactly attributed acquisitions matched to CRM by provider lead ID",
      source: "acquisition_crm_links",
    },
    dateBasis: "acquisition_event_date",
    attributionScope: "exact_meta_provider_ids",
    platformScope: "meta_only_exact",
    nullWhen: [
      "a non-Meta platform or Organic is selected",
      "the CRM link graph has never been built",
    ],
  }),
  crmMatched: c({
    key: "crmMatched",
    label: { en: "Exact CRM matches", ar: "مطابقات CRM دقيقة" },
    engine: "closed-loop",
    source: ["acquisition_crm_links (primary, exact)"],
    grain: "acquisition event",
    numerator: {
      description: "Exactly attributed acquisitions with a primary exact CRM link",
      source: "acquisition_crm_links",
    },
    dateBasis: "acquisition_event_date",
    attributionScope: "exact_meta_provider_ids",
    platformScope: "meta_only_exact",
    nullWhen: [
      "a non-Meta platform or Organic is selected",
      "the CRM link graph has never been built",
    ],
  }),
  qualified: c({
    key: "qualified",
    label: { en: "Qualified (exact-attributed)", ar: "مؤهلون (إسناد دقيق)" },
    engine: "closed-loop",
    source: ["crm_lead_outcomes.qualified"],
    grain: "acquisition event with exact CRM link",
    numerator: {
      description:
        "Exact CRM matches whose record is past Open or has Intermediate/Hot priority (current state)",
      source: "crm_lead_outcomes",
    },
    dateBasis: "acquisition_event_date",
    attributionScope: "exact_meta_provider_ids",
    platformScope: "meta_only_exact",
    nullWhen: [
      "a non-Meta platform or Organic is selected",
      "the CRM link graph has never been built",
    ],
  }),
  won: c({
    key: "won",
    label: { en: "Won (exact-attributed)", ar: "مكسوب (إسناد دقيق)" },
    engine: "closed-loop",
    source: ["crm_lead_outcomes.won"],
    grain: "acquisition event with exact CRM link",
    numerator: {
      description: "Exact CRM matches whose CRM business status is won (current state)",
      source: "crm_lead_outcomes",
    },
    dateBasis: "acquisition_event_date",
    attributionScope: "exact_meta_provider_ids",
    platformScope: "meta_only_exact",
    nullWhen: [
      "a non-Meta platform or Organic is selected",
      "the CRM link graph has never been built",
    ],
  }),
  uniqueWonCustomers: c({
    key: "uniqueWonCustomers",
    label: { en: "Unique won customers (CRM cohort)", ar: "عملاء مكسوبون فريدون (كوهورت CRM)" },
    engine: "metrics.server",
    source: ["dashboard_rows crm"],
    grain: "unique CRM record",
    numerator: {
      description:
        "Active CRM records created in the window that are Won, narrowed by platform campaign/source",
      source: "Odoo CRM via dashboard_rows crm",
    },
    dateBasis: "crm_created_date",
    attributionScope: "campaign_or_source_match",
    platformScope: "selected_scope",
    nullWhen: ["the CRM snapshot is unavailable"],
  }),
  revenue: c({
    key: "revenue",
    label: {
      en: "Paid revenue from exact-attributed leads (cohort)",
      ar: "الإيراد المدفوع من العملاء بإسناد دقيق (كوهورت)",
    },
    engine: "closed-loop",
    source: [EXACT_COHORT_REVENUE.source],
    grain: "Accounting invoice product line",
    numerator: EXACT_COHORT_REVENUE,
    dateBasis: "lead_created_cohort_all_payment_dates",
    attributionScope: "exact_sale_order_opportunity_link",
    platformScope: "meta_only_exact",
    nullWhen: [
      "a non-Meta platform or Organic is selected",
      "the CRM link graph has never been built",
    ],
  }),
  collectedRevenue: c({
    key: "collectedRevenue",
    label: { en: "Paid collections (payment date)", ar: "التحصيل المدفوع (تاريخ الدفع)" },
    engine: "accounting",
    source: ["dashboard_rows accounting (Odoo paid invoices), USD with dashboard FX rates"],
    grain: "Accounting invoice product line",
    numerator: {
      description:
        "USD paid on invoice lines whose Payment Date (credit notes: invoice date) is in the window; with a platform selected, only lines linked to that platform's campaigns or sources",
      source: "Accounting",
    },
    dateBasis: "payment_date",
    attributionScope: "campaign_or_source_match",
    platformScope: "selected_scope",
    nullWhen: ["the Accounting snapshot is unavailable"],
  }),
  roasAllSpend: c({
    key: "roasAllSpend",
    label: { en: "Cohort ROAS on all Meta spend", ar: "العائد (كوهورت) على كل صرف Meta" },
    engine: "closed-loop",
    source: [EXACT_COHORT_REVENUE.source, META_SPEND.source],
    grain: "ratio",
    numerator: EXACT_COHORT_REVENUE,
    denominator: META_SPEND,
    dateBasis: "lead_created_cohort_all_payment_dates",
    denominatorDateBasis: "ad_spend_date",
    attributionScope: "exact_sale_order_opportunity_link",
    platformScope: "meta_only_exact",
    nullWhen: ["a non-Meta platform or Organic is selected", "Meta spend is zero or not synced"],
  }),
  roasTracked: c({
    key: "roasTracked",
    label: {
      en: "Cohort ROAS on tracked Meta campaigns",
      ar: "العائد (كوهورت) على حملات Meta المتتبَّعة",
    },
    engine: "closed-loop",
    source: [EXACT_COHORT_REVENUE.source, TRACKED_SPEND.source],
    grain: "ratio",
    numerator: EXACT_COHORT_REVENUE,
    denominator: TRACKED_SPEND,
    dateBasis: "lead_created_cohort_all_payment_dates",
    denominatorDateBasis: "ad_spend_date",
    attributionScope: "exact_sale_order_opportunity_link",
    platformScope: "meta_only_exact",
    nullWhen: ["a non-Meta platform or Organic is selected", "tracked spend is zero or not synced"],
  }),
  collectionsToSpend: c({
    key: "collectionsToSpend",
    label: {
      en: "Collections-to-spend ratio (not attributed, not ROAS)",
      ar: "نسبة التحصيل إلى الصرف (بدون إسناد، ليست ROAS)",
    },
    engine: "metrics.server",
    source: ["Accounting paid invoices", SPEND.source],
    grain: "ratio",
    numerator: {
      description: "Paid collections in the window (payment date) in scope",
      source: "Accounting",
    },
    denominator: SPEND,
    dateBasis: "payment_date",
    denominatorDateBasis: "ad_spend_date",
    attributionScope: "campaign_or_source_match",
    platformScope: "selected_scope",
    nullWhen: ["spend is unavailable, partial or zero", "Organic is selected"],
  }),
  costPerCrmLead: c({
    key: "costPerCrmLead",
    label: { en: "Spend per unique CRM lead", ar: "الصرف لكل ليد CRM فريد" },
    engine: "metrics.server",
    source: [SPEND.source, "dashboard_rows crm + lost"],
    grain: "ratio",
    numerator: SPEND,
    denominator: {
      description: "Unique CRM leads created in the window in scope",
      source: "Odoo CRM",
    },
    dateBasis: "ad_spend_date",
    denominatorDateBasis: "crm_created_date",
    attributionScope: "campaign_or_source_match",
    platformScope: "selected_scope",
    nullWhen: ["spend is unavailable or partial", "no CRM leads in scope", "Organic is selected"],
  }),
  cplAll: c({
    key: "cplAll",
    label: { en: "Meta spend per Meta acquisition event", ar: "صرف Meta لكل حدث استحواذ من Meta" },
    engine: "closed-loop",
    source: [META_SPEND.source, "acquisition_events in Meta scope"],
    grain: "ratio",
    numerator: META_SPEND,
    denominator: {
      description: "Acquisition events in the Meta scope in the window",
      source: "acquisition_events",
    },
    dateBasis: "ad_spend_date",
    denominatorDateBasis: "acquisition_event_date",
    attributionScope: "none",
    platformScope: "meta_only_exact",
    nullWhen: ["a non-Meta platform or Organic is selected", "no Meta acquisition events"],
  }),
  cplTracked: c({
    key: "cplTracked",
    label: { en: "Cost per tracked lead", ar: "تكلفة العميل المتتبَّع" },
    engine: "closed-loop",
    source: [TRACKED_SPEND.source, EXACT_EVENTS.source],
    grain: "ratio",
    numerator: TRACKED_SPEND,
    denominator: EXACT_EVENTS,
    dateBasis: "ad_spend_date",
    denominatorDateBasis: "acquisition_event_date",
    attributionScope: "exact_meta_provider_ids",
    platformScope: "meta_only_exact",
    nullWhen: ["a non-Meta platform or Organic is selected", "no tracked leads"],
  }),
  costPerCustomerAll: c({
    key: "costPerCustomerAll",
    label: { en: "CAC on all Meta spend (exact won)", ar: "تكلفة العميل المكسوب على كل صرف Meta" },
    engine: "closed-loop",
    source: [META_SPEND.source, "crm_lead_outcomes.won"],
    grain: "ratio",
    numerator: META_SPEND,
    denominator: {
      description: "Exact-attributed acquisitions whose CRM record is won",
      source: "crm_lead_outcomes",
    },
    dateBasis: "ad_spend_date",
    denominatorDateBasis: "acquisition_event_date",
    attributionScope: "exact_meta_provider_ids",
    platformScope: "meta_only_exact",
    nullWhen: ["a non-Meta platform or Organic is selected", "no exact won"],
  }),
  crmMatchRate: c({
    key: "crmMatchRate",
    label: { en: "Exact CRM match rate", ar: "نسبة المطابقة الدقيقة في CRM" },
    engine: "closed-loop",
    source: ["acquisition_crm_links", "acquisition_events"],
    grain: "ratio",
    numerator: {
      description: "Acquisition events in scope with a primary exact CRM link",
      source: "acquisition_crm_links",
    },
    denominator: { description: "All acquisition events in scope", source: "acquisition_events" },
    dateBasis: "acquisition_event_date",
    attributionScope: "exact_meta_provider_ids",
    platformScope: "selected_scope",
    nullWhen: ["no acquisition events in scope", "the CRM link graph has never been built"],
  }),
  winRate: c({
    key: "winRate",
    label: { en: "Win rate (exact CRM matches)", ar: "معدل الفوز (مطابقات دقيقة)" },
    engine: "closed-loop",
    source: ["crm_lead_outcomes"],
    grain: "ratio",
    numerator: { description: "Exact CRM matches that are won", source: "crm_lead_outcomes" },
    denominator: { description: "Exact CRM matches", source: "acquisition_crm_links" },
    dateBasis: "acquisition_event_date",
    attributionScope: "exact_meta_provider_ids",
    platformScope: "meta_only_exact",
    nullWhen: ["a non-Meta platform or Organic is selected", "no exact CRM matches"],
  }),
  qualificationRate: c({
    key: "qualificationRate",
    label: { en: "Qualification rate (exact CRM matches)", ar: "معدل التأهيل (مطابقات دقيقة)" },
    engine: "closed-loop",
    source: ["crm_lead_outcomes"],
    grain: "ratio",
    numerator: { description: "Exact CRM matches that are qualified", source: "crm_lead_outcomes" },
    denominator: { description: "Exact CRM matches", source: "acquisition_crm_links" },
    dateBasis: "acquisition_event_date",
    attributionScope: "exact_meta_provider_ids",
    platformScope: "meta_only_exact",
    nullWhen: ["a non-Meta platform or Organic is selected", "no exact CRM matches"],
  }),
  revenuePerLead: c({
    key: "revenuePerLead",
    label: { en: "Cohort revenue per tracked lead", ar: "إيراد الكوهورت لكل عميل متتبَّع" },
    engine: "closed-loop",
    source: [EXACT_COHORT_REVENUE.source, EXACT_EVENTS.source],
    grain: "ratio",
    numerator: EXACT_COHORT_REVENUE,
    denominator: EXACT_EVENTS,
    dateBasis: "lead_created_cohort_all_payment_dates",
    denominatorDateBasis: "acquisition_event_date",
    attributionScope: "exact_sale_order_opportunity_link",
    platformScope: "meta_only_exact",
    nullWhen: ["a non-Meta platform or Organic is selected", "no tracked leads"],
  }),

  exactUniqueWon: c({
    key: "exactUniqueWon",
    label: { en: "Unique won customers (exact)", ar: "عملاء مكسوبون فريدون (دقيق)" },
    engine: "closed-loop",
    source: ["acquisition_crm_links (primary, exact) ⨝ crm_lead_outcomes.won"],
    grain: "unique CRM record",
    numerator: {
      description:
        "Distinct won CRM ids behind exactly attributed acquisitions with an exact CRM link",
      source: "acquisition_crm_links, crm_lead_outcomes",
    },
    dateBasis: "acquisition_event_date",
    attributionScope: "exact_meta_provider_ids",
    platformScope: "meta_only_exact",
    nullWhen: [
      "a non-Meta platform or Organic is selected",
      "the CRM link graph has never been built",
    ],
  }),
  costPerInterested: c({
    key: "costPerInterested",
    label: { en: "Cost per interested lead", ar: "تكلفة العميل المهتم" },
    engine: "closed-loop",
    source: [TRACKED_SPEND.source, "crm_lead_outcomes.interested"],
    grain: "ratio",
    numerator: TRACKED_SPEND,
    denominator: {
      description: "Exact CRM matches that are interested (current state)",
      source: "crm_lead_outcomes",
    },
    dateBasis: "ad_spend_date",
    denominatorDateBasis: "acquisition_event_date",
    attributionScope: "exact_meta_provider_ids",
    platformScope: "meta_only_exact",
    nullWhen: ["a non-Meta platform or Organic is selected", "no interested exact matches"],
  }),
  costPerQualified: c({
    key: "costPerQualified",
    label: { en: "Cost per qualified lead", ar: "تكلفة العميل المؤهل" },
    engine: "closed-loop",
    source: [TRACKED_SPEND.source, "crm_lead_outcomes.qualified"],
    grain: "ratio",
    numerator: TRACKED_SPEND,
    denominator: {
      description: "Exact CRM matches that are qualified (current state)",
      source: "crm_lead_outcomes",
    },
    dateBasis: "ad_spend_date",
    denominatorDateBasis: "acquisition_event_date",
    attributionScope: "exact_meta_provider_ids",
    platformScope: "meta_only_exact",
    nullWhen: ["a non-Meta platform or Organic is selected", "no qualified exact matches"],
  }),
  costPerQuotation: c({
    key: "costPerQuotation",
    label: { en: "Cost per quotation", ar: "تكلفة عرض السعر" },
    engine: "closed-loop",
    source: [TRACKED_SPEND.source, "crm_lead_outcomes.quotation"],
    grain: "ratio",
    numerator: TRACKED_SPEND,
    denominator: {
      description: "Exact CRM matches that reached a quotation or a confirmed sale order",
      source: "crm_lead_outcomes, crm_sale_order_links",
    },
    dateBasis: "ad_spend_date",
    denominatorDateBasis: "acquisition_event_date",
    attributionScope: "exact_meta_provider_ids",
    platformScope: "meta_only_exact",
    nullWhen: ["a non-Meta platform or Organic is selected", "no quotations among exact matches"],
  }),
  costPerCustomerTracked: c({
    key: "costPerCustomerTracked",
    label: { en: "CAC on tracked Meta campaigns", ar: "تكلفة العميل المكسوب (الحملات المتتبَّعة)" },
    engine: "closed-loop",
    source: [TRACKED_SPEND.source, "crm_lead_outcomes.won"],
    grain: "ratio",
    numerator: TRACKED_SPEND,
    denominator: {
      description: "Exact-attributed acquisitions whose CRM record is won",
      source: "crm_lead_outcomes",
    },
    dateBasis: "ad_spend_date",
    denominatorDateBasis: "acquisition_event_date",
    attributionScope: "exact_meta_provider_ids",
    platformScope: "meta_only_exact",
    nullWhen: ["a non-Meta platform or Organic is selected", "no exact won"],
  }),

  /* --- Lost -------------------------------------------------------------- */
  cohortLost: c({
    key: "cohortLost",
    label: { en: "Cohort Lost", ar: "خسارة الكوهورت" },
    engine: "lost-classification",
    source: ["dashboard_rows lost (Odoo 1.26 canonical Lost)"],
    grain: "unique CRM record",
    numerator: {
      description: "Canonical Lost records created in the window",
      source: "Odoo CRM Lost",
    },
    dateBasis: "crm_created_date",
    attributionScope: "campaign_or_source_match",
    platformScope: "selected_scope",
    nullWhen: ["the Lost authority is unavailable"],
  }),
  closedLostInPeriod: c({
    key: "closedLostInPeriod",
    label: { en: "Closed Lost during period", ar: "اتقفل Lost خلال الفترة" },
    engine: "lost-classification",
    source: ["dashboard_rows lost (Odoo 1.26 canonical Lost)"],
    grain: "unique CRM record",
    numerator: {
      description:
        "Canonical Lost records whose Lost/Close Date is in the window = created-and-lost + older-cohort + undated-cohort",
      source: "Odoo CRM Lost",
    },
    dateBasis: "lost_close_date",
    attributionScope: "campaign_or_source_match",
    platformScope: "selected_scope",
    nullWhen: ["the Lost authority is unavailable"],
  }),
  olderCohortClosedLostInPeriod: c({
    key: "olderCohortClosedLostInPeriod",
    label: {
      en: "Older-cohort Closed Lost during period",
      ar: "Lost اتقفل في الفترة من كوهورت أقدم",
    },
    engine: "lost-classification",
    source: ["dashboard_rows lost"],
    grain: "unique CRM record",
    numerator: {
      description: "Closed Lost in the window whose CRM record was created before the window",
      source: "Odoo CRM Lost",
    },
    dateBasis: "lost_close_date",
    attributionScope: "campaign_or_source_match",
    platformScope: "selected_scope",
    nullWhen: ["the Lost authority is unavailable"],
  }),

  /* --- Contact evidence & QA --------------------------------------------- */
  leadContactEvidence: c({
    key: "leadContactEvidence",
    label: { en: "Lead contact evidence", ar: "دليل التواصل مع الليد" },
    engine: "lead-contact-evidence",
    source: [
      "Calls Hub lead-calls (Yeastar)",
      "Chatwoot phone evidence (dataset chatwoot_phone_evidence + API)",
    ],
    grain: "CRM lead",
    numerator: {
      description:
        "Calls on phone or mobile on/after creation; employee Chatwoot replies inside the window after creation",
      source: "Yeastar, Chatwoot",
    },
    dateBasis: "call_and_chat_within_window_after_creation",
    attributionScope: "phone_match",
    platformScope: "not_platform_scoped",
    nullWhen: [
      "contact status is `unknown` when Yeastar or Chatwoot evidence is incomplete for the lead's numbers",
    ],
  }),
  leadQaVerificationRate: c({
    key: "leadQaVerificationRate",
    label: { en: "Lead QA verification rate", ar: "نسبة التحقق اليدوي من الليدز" },
    engine: "lead-qa",
    source: ["lead_quality_verifications"],
    grain: "ratio",
    numerator: {
      description: "Assigned leads with a verified_* verdict",
      source: "lead_quality_verifications",
    },
    denominator: {
      description: "Leads assigned to the employee and created in the window",
      source: "Odoo CRM",
    },
    dateBasis: "verdict_on_leads_created_in_window",
    attributionScope: "none",
    platformScope: "not_platform_scoped",
    nullWhen: ["no assigned leads", "the QA table is unavailable"],
  }),

  /* --- Revenue cohorts ----------------------------------------------------- */
  entryMonthCohortRevenue: c({
    key: "entryMonthCohortRevenue",
    label: {
      en: "Revenue generated by customers who entered in this month",
      ar: "الإيراد الناتج من العملاء الذين دخلوا في هذا الشهر",
    },
    engine: "revenue-cohort",
    source: ["Accounting paid invoices", "crm_sale_order_links", "dashboard_rows crm + lost"],
    grain: "Accounting invoice product line credited to a CRM creation month",
    numerator: {
      description:
        "USD paid (FX authority), any payment date up to today, on sale orders whose opportunity was created in the entry month",
      source: "Accounting ⨝ crm_sale_order_links ⨝ CRM",
    },
    dateBasis: "lead_created_cohort_all_payment_dates",
    attributionScope: "exact_sale_order_opportunity_link",
    platformScope: "not_platform_scoped",
    nullWhen: ["crm_sale_order_links has never been built"],
  }),
} as const satisfies Record<string, MetricContract>;

export type MetricContractKey = keyof typeof METRIC_CONTRACTS;

export function metricContract(key: string): MetricContract | undefined {
  return (METRIC_CONTRACTS as Record<string, MetricContract>)[key];
}
