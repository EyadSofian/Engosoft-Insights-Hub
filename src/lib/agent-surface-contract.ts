/**
 * THE AGENT SURFACE CONTRACT — what every analytical surface promises an agent.
 *
 * WHY THIS FILE EXISTS. `agent-insights-registry.ts` listed the endpoints a
 * surface is built from, and `/api/agent-insights` then read `endpoints[0]` and
 * threw the rest away. Five surfaces are built from more than one source, so
 * five surfaces were reporting CONNECTED while serving a fraction of what the
 * page shows: `campaigns` never carried risk, `leads` never carried call or
 * uncalled-lead evidence, `accounting` could not reach profitability,
 * `media_plan` had no activity, `social_media` was ads-only. The agent was not
 * wrong about the numbers it had. It was wrong about which numbers existed.
 *
 * WHAT A CONTRACT DECLARES. Routes, views, allowed operations, supported
 * filters, selectable entities, the required data sources IN MERGE ORDER, the
 * summary paths each source contributes, the row collections that may be
 * projected, where freshness lives, the standing caveats a reader must be told,
 * and a sensitivity classification. Everything the gateway needs to answer, and
 * everything the contract audit needs to prove it answered.
 *
 * WHAT IT IS NOT. No figures, no computation, no business data. The endpoints
 * named here are the dashboard's own, so the agent and the screen cannot
 * disagree.
 *
 * REQUIRED ARGUMENTS ARE DECLARED, NOT DISCOVERED. `/api/agent-course-
 * intelligence` answers HTTP 400 without `course`. The coverage audit used to
 * call it bare, receive the 400, print a line and carry on to report PASS. A
 * source that needs an argument says so here and carries a fixture argument the
 * audit must use, so "we never actually exercised it" is not a passing state.
 */

/** Bumped when the shape of AgentSurfaceResult changes in a breaking way. */
export const AGENT_CONTRACT_VERSION = "1.0.0";

export type SurfaceStatus =
  | "CONNECTED"
  | "PARTIAL"
  | "MISSING"
  | "NOT_AGENT_SAFE"
  | "NOT_APPLICABLE";

export type SurfaceOperation = "summary" | "list" | "detail" | "compare" | "trend" | "search";

/**
 * How careful the gateway must be with a surface's payload.
 *
 * `personal` is the one that changes behaviour: row collections are dropped
 * unless the contract explicitly projects them, and then only the fields it
 * names travel.
 */
export type Sensitivity = "public" | "internal" | "personal";

export interface Bilingual {
  ar: string;
  en: string;
}

/**
 * One dashboard endpoint a surface is built from.
 *
 * `as` is the namespace the payload occupies in the merged evidence. Two
 * sources that both carry `totals` would otherwise silently overwrite each
 * other, which is the defect class that made the agent read lost-lead counts as
 * CRM counts.
 */
export interface SurfaceSource {
  /** The served path — matched against the route files by a test. */
  endpoint: string;
  /** Namespace in the merged evidence. The first source may claim the root. */
  as: string;
  /**
   * A required source that fails makes the whole answer UPSTREAM_ERROR. An
   * optional one that fails degrades the result to PARTIAL and is named in
   * `coverage.degraded`, because a missing enrichment is not a missing answer.
   */
  required: boolean;
  /** Query parameters the endpoint refuses to work without. */
  requiredArgs?: readonly string[];
  /** Valid values the contract audit must call it with. Required whenever `requiredArgs` is set. */
  auditArgs?: Readonly<Record<string, string>>;
  /** Dot paths inside THIS source whose scalars belong in the flat summary. */
  summaryPaths?: readonly string[];
  /** Fetched only for these operations. Absent means every operation. */
  operations?: readonly SurfaceOperation[];
  /** Fetched only for these views. Absent means every view. */
  views?: readonly string[];
  /** Why this source is part of the surface — read by humans, not by code. */
  why: string;
}

/** One analytical view a page switches between without changing its pathname. */
export interface SurfaceView {
  id: string;
  title: Bilingual;
  /** Narrows the surface's operations when a view supports fewer. */
  operations?: readonly SurfaceOperation[];
  caveats?: readonly Bilingual[];
}

/**
 * A row collection the agent may see, and the only fields of it that travel.
 *
 * An ALLOW-list on purpose. A deny-list rots dangerously: a phone-number column
 * added upstream tomorrow would ship to a chat transcript by default.
 */
export interface RowProjection {
  /** Key of the array in the merged payload, e.g. "agents" or "rows". */
  collection: string;
  /** What one row is, for the reader: "salesperson", "campaign", "course". */
  kind: string;
  fields: readonly string[];
  /** Hard cap on rows returned. Ranking answers need names, not a database. */
  limit: number;
}

export interface SurfaceContract {
  id: string;
  /** Routes that resolve here, including legacy aliases. */
  routes: readonly string[];
  section: string;
  title: Bilingual;
  status: SurfaceStatus;
  sensitivity: Sensitivity;
  views: readonly SurfaceView[];
  /**
   * Which views apply when the caller names none.
   *
   * "No view" means "the whole surface", and without this a view-gated source
   * was silently dropped: asking for `social_media` with no view returned the
   * team aggregates and neither paid nor organic, because both are gated. It
   * must never be possible for an unspecified view to produce LESS evidence
   * than a specified one by accident.
   *
   * Accounting is the case that shows why it cannot just be "all views": its
   * profitability source is REQUIRED for the profitability tab, so including it
   * by default would let a profitability outage sink a plain revenue question.
   */
  defaultViews?: readonly string[];
  operations: readonly SurfaceOperation[];
  /** Global filter keys this surface honours. Anything else is ignored, not forwarded. */
  filters: readonly string[];
  /** Entity kinds a user can select on this surface. */
  entities: readonly string[];
  /** In merge order. The first is the spine; the rest enrich it. */
  sources: readonly SurfaceSource[];
  /** Summary paths applied to the merged payload, on top of each source's own. */
  summaryPaths?: readonly string[];
  rows?: readonly RowProjection[];
  /** Dot paths carrying "as of" / "generated at" style freshness markers. */
  freshnessPaths?: readonly string[];
  /** Standing limitations a reader must be told, every time. */
  caveats?: readonly Bilingual[];
  /** Why, when the status is not CONNECTED. */
  note?: string;
}

const t = (ar: string, en: string): Bilingual => ({ ar, en });

/** Filters nearly every reporting endpoint accepts. */
const PERIOD_FILTERS = ["from", "to", "range", "month", "company"] as const;

/**
 * The attribution caveat that applies wherever paid spend meets collected
 * revenue. Stated once here rather than retyped per surface, because a caveat
 * that drifts between two surfaces is worse than no caveat at all.
 */
const ATTRIBUTION_CAVEAT = t(
  "جزء من الإيراد المحصّل مش منسوب لأي حملة، فالـROAS بيقلل الحقيقة مش بيزودها.",
  "Some collected revenue is not attributed to any campaign, so ROAS understates rather than overstates return.",
);

/**
 * The data-health block every reporting endpoint publishes.
 *
 * Declared per SOURCE, not per surface. When these lived on the surface only,
 * the secondary sources' health counters were unreachable — and "is this figure
 * trustworthy?" is exactly the question a health counter answers.
 */
const HEALTH_PATHS = [
  "health",
  "health.accountingDirect",
  "health.crmExclusions",
  "health.lostExclusions",
] as const;

/** The best/worst performer block campaign-shaped payloads carry. */
const ACTIVITY_PATHS = ["activity", "activity.best", "activity.worst"] as const;

const COLLECTION_BASIS_CAVEAT = t(
  "الإيراد هنا بالتحصيل الفعلي من Odoo بتاريخ الدفع، مش الفواتير المفتوحة.",
  "Revenue here is collected cash from Odoo by payment date, not open invoices.",
);

export const SURFACE_CONTRACTS: readonly SurfaceContract[] = [
  {
    id: "overview",
    routes: ["/"],
    section: "business",
    title: t("تحليلات البيزنس", "Business analytics"),
    status: "CONNECTED",
    sensitivity: "internal",
    views: [],
    operations: ["summary", "trend"],
    filters: [...PERIOD_FILTERS, "platform", "account", "course", "source"],
    entities: [],
    /**
     * The target block is on this page and lives in /api/teams, not
     * /api/overview. Reading only the first endpoint is why a manager pointing
     * at "إجمالي التارجت $162,000" was told there was no target data.
     */
    sources: [
      {
        endpoint: "/api/overview",
        as: "root",
        required: true,
        why: "Company-wide KPIs, deltas, best/worst performers and the funnel.",
        summaryPaths: [
          "activity.best",
          "activity.worst",
          "best",
          "bestCPL",
          "deltas",
          "health",
          "health.accountingDirect",
          "health.crmExclusions",
          "health.lostExclusions",
          "leak",
          "coverage",
        ],
      },
      {
        endpoint: "/api/teams",
        as: "teamAggregates",
        required: false,
        why: "The monthly target and achievement block the overview renders but does not serve.",
        summaryPaths: ["targets", "chatwoot", "summary", ...HEALTH_PATHS],
      },
    ],
    freshnessPaths: ["syncedAt", "health"],
    caveats: [ATTRIBUTION_CAVEAT, COLLECTION_BASIS_CAVEAT],
  },
  {
    id: "campaigns",
    routes: ["/campaigns"],
    section: "campaigns",
    title: t("الحملات", "Campaigns"),
    status: "CONNECTED",
    sensitivity: "internal",
    views: [],
    operations: ["summary", "list", "detail", "compare"],
    filters: [...PERIOD_FILTERS, "platform", "account", "campaign", "campaignKey", "course"],
    entities: ["campaign"],
    sources: [
      {
        endpoint: "/api/campaigns",
        as: "root",
        required: true,
        why: "Per-campaign spend, leads, sales and return.",
        summaryPaths: [
          "activity.best",
          "activity.worst",
          "health",
          "health.accountingDirect",
          "health.crmExclusions",
          "health.lostExclusions",
        ],
      },
      {
        /**
         * Risk is a judgement about a campaign, not a figure on it, so it is
         * fetched only when the question is one risk can answer. On `summary`
         * it would double the payload to enrich a total nobody asked about.
         */
        endpoint: "/api/campaign-risk",
        as: "risk",
        required: false,
        operations: ["detail", "compare", "list"],
        why: "Delivery and return risk per campaign — the reason to act, not just the number.",
        summaryPaths: [...ACTIVITY_PATHS],
      },
    ],
    rows: [
      {
        collection: "rows",
        kind: "campaign",
        fields: [
          "name",
          "platform",
          "account",
          "spend",
          "impressions",
          "clicks",
          "leads",
          "crmLeads",
          "cpl",
          "won",
          "revenue",
          "roas",
          "conversionRate",
          "status",
        ],
        limit: 40,
      },
    ],
    freshnessPaths: ["health"],
    caveats: [ATTRIBUTION_CAVEAT],
  },
  {
    id: "ads",
    routes: ["/ads"],
    section: "campaigns",
    title: t("الإعلانات", "Ads"),
    status: "CONNECTED",
    sensitivity: "internal",
    views: [],
    operations: ["summary", "list", "detail"],
    filters: [...PERIOD_FILTERS, "platform", "account", "campaign", "adset", "ad"],
    entities: ["campaign", "adset", "ad"],
    sources: [
      {
        endpoint: "/api/ads",
        as: "root",
        required: true,
        why: "Ad and ad-set delivery: impressions, clicks, leads and spend.",
        summaryPaths: [
          "health",
          "health.accountingDirect",
          "health.crmExclusions",
          "health.lostExclusions",
          "platformCoverageAll",
        ],
      },
    ],
    rows: [
      {
        collection: "byAdset",
        kind: "adset",
        fields: ["name", "platform", "spend", "impressions", "clicks", "leads", "cpl", "ctr"],
        limit: 25,
      },
    ],
    freshnessPaths: ["health"],
    caveats: [
      t(
        "الليدز هنا من المنصة، والمبيعات من الـCRM — التطابق بينهم مش كامل.",
        "Leads here come from the ad platform and sales from the CRM; the two do not match one-for-one.",
      ),
    ],
  },
  {
    id: "website",
    routes: ["/website"],
    section: "campaigns",
    title: t("أداء الموقع", "Website performance"),
    status: "CONNECTED",
    sensitivity: "internal",
    views: [
      { id: "owner", title: t("ملخص المالك", "Owner summary") },
      { id: "campaigns", title: t("حملات الموقع", "Website campaigns") },
      { id: "operations", title: t("الليدز والمبيعات", "Leads and sales") },
    ],
    defaultViews: ["owner"],
    operations: ["summary", "list", "detail"],
    filters: [...PERIOD_FILTERS, "course", "campaign", "source"],
    entities: ["campaign", "course", "owner"],
    sources: [
      {
        endpoint: "/api/website",
        as: "root",
        required: true,
        why: "Website orders, revenue, attribution and Odoo reconciliation.",
        summaryPaths: [
          "detail",
          "health",
          "insights",
          "insights.bestSellingCourse",
          "insights.highestDemandUnsoldCourse",
          "leadSources",
          "reconciliation",
          "salesDetail",
          "sheetSalesAnalysis",
          "websiteCampaignAttribution",
        ],
      },
    ],
    rows: [
      {
        collection: "websiteCampaigns",
        kind: "campaign",
        fields: ["name", "platform", "spend", "leads", "orders", "revenue", "roas"],
        limit: 25,
      },
      {
        collection: "soldCourses",
        kind: "course",
        fields: ["name", "label", "orders", "revenue", "leads"],
        limit: 25,
      },
    ],
    freshnessPaths: ["asOf", "health"],
    caveats: [
      t(
        "مبيعات الموقع متطابقة بين Odoo وشيت المبيعات بعد منع تكرار رقم الأوردر.",
        "Website sales are reconciled between Odoo and the sales sheet, de-duplicated by order id.",
      ),
    ],
  },
  {
    id: "accounting",
    routes: ["/accounting", "/full-invoiced", "/products", "/sales"],
    section: "sales",
    title: t("المبيعات والمحاسبة", "Sales and accounting"),
    status: "CONNECTED",
    // Invoice rows carry customer names.
    sensitivity: "personal",
    views: [
      { id: "summary", title: t("الملخص", "Summary") },
      { id: "months", title: t("الشهور", "Months"), operations: ["summary", "trend"] },
      {
        id: "profitability",
        title: t("الربحية", "Profitability"),
        caveats: [
          t(
            "الربحية بتعتمد على تكاليف مسجلة يدويًا؛ الكورس اللي متكلفش بيبان هامشه أعلى من الحقيقة.",
            "Profitability depends on manually recorded costs; a course with no costs entered looks more profitable than it is.",
          ),
        ],
      },
    ],
    defaultViews: ["summary"],
    operations: ["summary", "list", "trend"],
    filters: [...PERIOD_FILTERS, "course", "mainCategory", "salesTeam", "salesperson", "dateBasis"],
    entities: ["course", "product", "salesperson"],
    sources: [
      {
        endpoint: "/api/accounting",
        as: "root",
        required: true,
        why: "Collected revenue, invoices and the course revenue summary.",
        summaryPaths: [
          "courses.summary",
          "detail",
          "fxRates",
          "health",
          "health.accountingDirect",
          "health.crmExclusions",
          "health.lostExclusions",
          "source",
        ],
      },
      {
        /**
         * The profitability tab reads a different service. With endpoints[0]
         * this view returned the summary payload and no margin at all.
         */
        endpoint: "/api/profitability",
        as: "profitability",
        required: true,
        views: ["profitability"],
        why: "Margin after cost — the whole content of the profitability view.",
        summaryPaths: ["snapshot", "source"],
      },
      {
        endpoint: "/api/sales",
        as: "salesFunnel",
        required: false,
        operations: ["summary", "list"],
        why: "The funnel and best-converting source/campaign the summary tab shows beside revenue.",
        summaryPaths: [
          "funnel",
          "insights.bestConvertingCampaign",
          "insights.bestConvertingSource",
          "insights.bestSellingCampaign",
          "insights.bestSellingSource",
          ...HEALTH_PATHS,
        ],
      },
    ],
    rows: [
      {
        collection: "byProduct",
        kind: "product",
        fields: ["name", "label", "productCode", "invoices", "salesOrders", "revenue", "share"],
        limit: 30,
      },
      {
        collection: "byMainCategory",
        kind: "category",
        fields: ["name", "label", "revenue", "invoices", "share"],
        limit: 15,
      },
    ],
    freshnessPaths: ["health", "source"],
    caveats: [COLLECTION_BASIS_CAVEAT],
  },
  {
    id: "courses",
    routes: ["/courses"],
    section: "sales",
    title: t("الدورات", "Courses"),
    status: "CONNECTED",
    sensitivity: "internal",
    views: [
      { id: "campaigns", title: t("الحملات", "Campaigns") },
      { id: "alerts", title: t("التنبيهات", "Alerts") },
      { id: "all", title: t("كل الكورسات", "All courses") },
    ],
    defaultViews: ["campaigns"],
    operations: ["summary", "list", "detail", "compare", "trend"],
    filters: [...PERIOD_FILTERS, "course", "mainCategory", "campaign", "platform"],
    entities: ["course", "campaign", "product"],
    sources: [
      {
        endpoint: "/api/courses",
        as: "root",
        required: true,
        why: "Every course's spend, leads, sales and revenue for the period.",
        summaryPaths: [
          "comparisonPeriod",
          "freshness",
          "health",
          "health.accountingDirect",
          "health.crmExclusions",
          "health.lostExclusions",
          "prevRange",
        ],
      },
      {
        /**
         * HTTP 400 without `course`. Declared required-arg so the gateway only
         * calls it when a course is actually in play, and so the audit calls it
         * with a real one instead of scoring a 400 as a pass.
         */
        endpoint: "/api/agent-course-intelligence",
        as: "courseIntelligence",
        required: false,
        requiredArgs: ["course"],
        auditArgs: { course: "CFM" },
        operations: ["detail", "compare"],
        why: "One named course in depth: its campaigns, sold variants and per-campaign product mix.",
        summaryPaths: [
          "summary",
          "attributed",
          "dataQuality",
          "period",
          // Attribution quality is the caveat this surface must always carry.
          "dataQuality.attribution",
          "dataQuality.attribution.spendBySource",
          "dataQuality.health",
          "dataQuality.health.accountingDirect",
          "dataQuality.health.crmExclusions",
          "dataQuality.health.lostExclusions",
        ],
      },
      {
        endpoint: "/api/course-lead-alerts",
        as: "alerts",
        required: true,
        views: ["alerts"],
        why: "Which courses have moved enough against baseline to need attention.",
        summaryPaths: ["summary", "comparisonPeriod", "freshness"],
      },
    ],
    rows: [
      {
        collection: "courses",
        kind: "course",
        fields: [
          "name",
          "label",
          "key",
          "mainCategory",
          "spend",
          "leads",
          "crmLeads",
          "cpl",
          "won",
          "revenue",
          "roas",
          "conversionRate",
        ],
        limit: 30,
      },
    ],
    freshnessPaths: ["freshness", "health"],
    caveats: [ATTRIBUTION_CAVEAT],
  },
  {
    id: "pricing",
    routes: ["/pricing"],
    section: "sales",
    title: t("الأسعار", "Pricing"),
    status: "PARTIAL",
    sensitivity: "internal",
    views: [],
    operations: ["summary", "search"],
    filters: ["company", "course", "mainCategory"],
    entities: ["product"],
    sources: [
      {
        // The file is pricing.catalog.ts; TanStack serves it at /api/pricing/catalog.
        endpoint: "/api/pricing/catalog",
        as: "root",
        required: true,
        why: "The internal catalogue view only. It is not the sell-price authority.",
        summaryPaths: ["book", "demandPeriod"],
      },
    ],
    note: "Current sell price is PriceEngo's, not this page's. The agent quotes PriceEngo; this surface exposes the internal catalogue view only.",
    caveats: [
      t(
        "ده الكتالوج الداخلي. السعر الحالي المعتمد بييجي من PriceEngo لوحده.",
        "This is the internal catalogue. The authoritative current price comes from PriceEngo alone.",
      ),
    ],
  },
  {
    id: "leads",
    routes: ["/leads"],
    section: "leads",
    title: t("الليدز", "Leads"),
    status: "CONNECTED",
    // Lead rows carry phone and email.
    sensitivity: "personal",
    views: [],
    operations: ["summary", "list", "trend"],
    filters: [...PERIOD_FILTERS, "source", "course", "salesTeam", "salesperson", "campaign"],
    entities: ["source", "course", "salesperson"],
    sources: [
      {
        endpoint: "/api/leads",
        as: "root",
        required: true,
        why: "The CRM funnel: leads by stage, source, course, team and campaign.",
        summaryPaths: [
          "detail",
          "health",
          "health.accountingDirect",
          "health.crmExclusions",
          "health.lostExclusions",
          "pipeline",
          "origin",
          "salesFunnel.funnel",
          "salesFunnel.insights.bestConvertingCampaign",
          "salesFunnel.insights.bestConvertingSource",
          "salesFunnel.insights.bestSellingCampaign",
          "salesFunnel.insights.bestSellingSource",
          "salesFunnel.totals",
        ],
      },
      {
        /**
         * "Are we calling our leads?" is a lead question and was unreachable:
         * both of these sit behind endpoints[0].
         */
        endpoint: "/api/crm-calls",
        as: "calls",
        required: false,
        why: "Call volume and answer rates against the leads in the same window.",
        summaryPaths: ["totals"],
      },
      {
        endpoint: "/api/uncalled-leads",
        as: "uncalled",
        required: false,
        why: "Leads distributed but never called — the follow-up gap behind a conversion drop.",
        summaryPaths: ["summary", "range", "leads"],
      },
    ],
    rows: [
      {
        collection: "bySource",
        kind: "source",
        fields: ["name", "label", "leads", "won", "lost", "conversionRate", "revenue"],
        limit: 25,
      },
      {
        collection: "byCourse",
        kind: "course",
        fields: ["name", "label", "leads", "won", "lost", "conversionRate", "revenue"],
        limit: 25,
      },
    ],
    freshnessPaths: ["health"],
    caveats: [
      t(
        "أرقام الليدز مجمّعة. بيانات التواصل الشخصية مش بتوصل للمساعد أصلًا.",
        "Lead figures are aggregates. Personal contact details never reach the assistant at all.",
      ),
    ],
  },
  {
    id: "lost",
    routes: ["/lost"],
    section: "leads",
    title: t("الصفقات الضائعة", "Lost deals"),
    status: "CONNECTED",
    sensitivity: "personal",
    views: [
      { id: "team", title: t("بالفريق", "By team") },
      { id: "course", title: t("بالكورس", "By course") },
    ],
    defaultViews: ["team"],
    operations: ["summary", "list"],
    filters: [...PERIOD_FILTERS, "course", "salesTeam", "salesperson", "source"],
    entities: ["course", "team", "salesperson"],
    sources: [
      {
        endpoint: "/api/lost",
        as: "root",
        required: true,
        why: "Lost reasons by team and by course, and closure movement.",
        summaryPaths: [
          "breakdown",
          "breakdown.reasonByCourse",
          "breakdown.reasonByTeam",
          "closureMovement",
          "detail",
          "health",
          "health.accountingDirect",
          "health.crmExclusions",
          "health.lostExclusions",
        ],
      },
    ],
    rows: [
      {
        collection: "teamLostRates",
        kind: "team",
        fields: ["name", "team", "lost", "leads", "lostRate", "topReason"],
        limit: 20,
      },
    ],
    freshnessPaths: ["health"],
    caveats: [
      t(
        "سبب الخسارة بيتكتب يدوي من المندوب، فهو رأي مش قياس.",
        "The loss reason is typed by the rep — it is an opinion, not a measurement.",
      ),
    ],
  },
  {
    id: "teams",
    routes: ["/teams"],
    section: "leads",
    title: t("أداء الموظفين", "Employee performance"),
    status: "CONNECTED",
    sensitivity: "personal",
    views: [
      { id: "targets", title: t("أداء الوحدات والتيمات", "Units and team performance") },
      { id: "agents", title: t("أداء كل موظف", "Per-employee performance") },
    ],
    defaultViews: ["targets"],
    operations: ["summary", "list", "detail", "compare"],
    filters: [...PERIOD_FILTERS, "salesTeam", "salesperson", "course"],
    entities: ["team", "salesperson"],
    sources: [
      {
        endpoint: "/api/teams",
        as: "root",
        required: true,
        why: "Targets, achievement, per-rep conversion and each person's course mix.",
        summaryPaths: [
          "chatwoot",
          "health",
          "health.accountingDirect",
          "health.crmExclusions",
          "health.lostExclusions",
          "targets",
          "sla",
          "callsHub",
        ],
      },
    ],
    /**
     * `people` is the field name. The agent looked for `salespeople`, found
     * nothing, and reported insufficient data with the evidence in hand — so
     * the real name is declared here and asserted by a contract test.
     *
     * THE PER-COURSE RANKING IS NOT A SEPARATE ENDPOINT. It was, briefly, and
     * that made the agent depend on a dashboard deploy to answer "مين أنسب موظف
     * يبيع CFM؟" — the contract declared a route production did not serve, and
     * the coverage audit correctly went red. The ranking is arithmetic over
     * THIS payload's `agents[].courseProfile`, so it belongs in the agent,
     * beside its own tests, with one implementation rather than two that drift.
     */
    rows: [
      {
        collection: "agents",
        kind: "salesperson",
        fields: [
          "name",
          "displayName",
          "team",
          "target",
          "paidRevenue",
          "achievementPaid",
          "cleanLeads",
          "won",
          "lost",
          "conversionRate",
          "decidedConversionRate",
          "invoices",
          "outboundCalls",
          "answeredCalls",
          "answerRate",
          "courses",
        ],
        limit: 60,
      },
      {
        collection: "teams",
        kind: "team",
        fields: [
          "name",
          "key",
          "crmLeads",
          "won",
          "lost",
          "conversionRate",
          "revenue",
          "orders",
          "avgOrder",
          "people",
        ],
        limit: 20,
      },
      {
        collection: "leaderboard",
        kind: "salesperson",
        fields: ["name", "displayName", "team", "conversionRate", "won", "cleanLeads"],
        limit: 15,
      },
      {
        collection: "needsAttention",
        kind: "salesperson",
        fields: ["name", "displayName", "team", "conversionRate", "won", "cleanLeads"],
        limit: 15,
      },
    ],
    freshnessPaths: ["sla", "callsHub", "chatwoot", "health"],
    caveats: [
      COLLECTION_BASIS_CAVEAT,
      t(
        "دي أرقام أداء، مش تقييم موظف. مينفعش تتاخد كقرار توظيف أو فصل أو حافز.",
        "These are performance figures, not an employee evaluation. They are not a hiring, firing or compensation decision.",
      ),
    ],
  },
  {
    id: "weekend",
    routes: ["/weekend"],
    section: "comparisons",
    title: t("الويك إند", "Weekend"),
    status: "CONNECTED",
    sensitivity: "internal",
    views: [],
    operations: ["summary", "compare"],
    filters: [...PERIOD_FILTERS, "platform", "course"],
    entities: [],
    sources: [
      {
        endpoint: "/api/weekend",
        as: "root",
        required: true,
        why: "Weekend against weekday across spend, leads and sales.",
        summaryPaths: [
          "health",
          "health.accountingDirect",
          "health.crmExclusions",
          "health.lostExclusions",
          "portfolio",
          "portfolio.comparison",
          "portfolio.weekend",
          "window",
          "budgetPlan",
        ],
      },
    ],
    freshnessPaths: ["window", "health"],
    caveats: [
      t(
        "المقارنة بتتأثر بعدد أيام الويك إند في الفترة، مش بالأداء لوحده.",
        "The comparison is affected by how many weekend days fall in the period, not by performance alone.",
      ),
    ],
  },
  {
    id: "yoy",
    routes: ["/yoy"],
    section: "comparisons",
    title: t("سنة بسنة", "Year on year"),
    status: "CONNECTED",
    sensitivity: "internal",
    views: [],
    operations: ["summary", "compare", "trend"],
    filters: [...PERIOD_FILTERS, "course", "mainCategory"],
    entities: ["course"],
    sources: [
      {
        endpoint: "/api/yoy",
        as: "root",
        required: true,
        why: "This year against last over the same window.",
        summaryPaths: [
          "health",
          "health.accountingDirect",
          "health.crmExclusions",
          "health.lostExclusions",
          "metricAvailability",
        ],
      },
    ],
    freshnessPaths: ["health"],
    caveats: [
      t(
        "مش كل مقياس متاح للسنتين؛ اللي ناقص بيبان في metricAvailability.",
        "Not every metric exists for both years; what is missing is listed in metricAvailability.",
      ),
    ],
  },
  {
    id: "media_buyers",
    routes: ["/media-buyers"],
    section: "media-buyers",
    title: t("الميديا بايرز", "Media buyers"),
    status: "CONNECTED",
    sensitivity: "personal",
    views: [],
    operations: ["summary", "list", "compare"],
    filters: [...PERIOD_FILTERS, "platform", "account", "campaign"],
    entities: ["media_buyer", "campaign"],
    sources: [
      {
        endpoint: "/api/media-buyers",
        as: "root",
        required: true,
        why: "Spend and outcomes per buyer, plus how much spend is assigned at all.",
        summaryPaths: [
          "coverage",
          "health",
          "health.accountingDirect",
          "health.crmExclusions",
          "health.lostExclusions",
          "mapping",
        ],
      },
    ],
    rows: [
      {
        collection: "buyers",
        kind: "media_buyer",
        fields: ["name", "spend", "leads", "cpl", "campaigns", "revenue", "roas"],
        limit: 20,
      },
    ],
    freshnessPaths: ["health"],
    caveats: [
      t(
        "جزء من الإنفاق مش متعيّن لأي ميديا باير؛ نسبة التغطية في coverage.",
        "Some spend is assigned to no buyer at all; the assigned share is in coverage.",
      ),
    ],
  },
  {
    id: "media_plan",
    routes: ["/media-plan"],
    section: "media-buyers",
    title: t("خطة الميديا", "Media plan"),
    status: "CONNECTED",
    sensitivity: "internal",
    views: [],
    operations: ["summary", "list"],
    filters: ["month", "company", "course", "platform"],
    entities: ["campaign", "media_buyer", "course"],
    sources: [
      {
        endpoint: "/api/media-plan",
        as: "root",
        required: true,
        why: "The plan itself: lead, paid-lead, budget, CPL and sales targets, against actuals.",
        summaryPaths: [
          "actual",
          "health",
          "health.accountingDirect",
          "health.crmExclusions",
          "health.lostExclusions",
          "plan",
          "window",
        ],
      },
      {
        /**
         * "Are the planned campaigns actually running?" is a plan question, and
         * the answer is in a second endpoint that endpoints[0] never reached.
         */
        endpoint: "/api/media-plan-activity",
        as: "activity",
        required: false,
        why: "Whether the planned campaigns are live on the platform right now.",
        summaryPaths: ["window", "linkedCount", "unlinkedCount"],
      },
    ],
    rows: [
      {
        collection: "courses",
        kind: "course",
        fields: [
          "key",
          "label",
          "targetLeads",
          "targetCpl",
          "targetBudgetUsd",
          "owners",
          "actual",
          "periodSpend",
          "periodLeads",
          "activeCampaigns",
        ],
        limit: 20,
      },
      {
        collection: "unplanned",
        kind: "course",
        fields: ["course", "spend", "platformLeads", "crmLeads"],
        limit: 15,
      },
    ],
    freshnessPaths: ["window", "generatedAt", "health"],
    caveats: [
      t(
        "الخطة ممكن تكون لسه draft، والنِسَب بتتقارن بجزء الشهر اللي عدّى مش بالشهر كله.",
        "The plan may still be a draft, and achievement must be read against the elapsed part of the month, not the whole month.",
      ),
    ],
  },
  {
    id: "social_media",
    routes: ["/social-media"],
    section: "social",
    title: t("السوشيال ميديا", "Social media"),
    status: "CONNECTED",
    sensitivity: "internal",
    views: [
      { id: "paid", title: t("المدفوع", "Paid") },
      { id: "organic", title: t("الأورجانيك", "Organic") },
    ],
    defaultViews: ["paid", "organic"],
    operations: ["summary", "list", "compare"],
    filters: [...PERIOD_FILTERS, "platform", "source", "course"],
    entities: ["campaign", "source"],
    /**
     * Paid and organic are DIFFERENT EVIDENCE and are namespaced apart. Merged
     * flat, `totals` from one silently replaced `totals` from the other and the
     * agent quoted paid spend against organic leads.
     */
    sources: [
      {
        endpoint: "/api/ads",
        as: "paid",
        required: true,
        views: ["paid"],
        why: "Paid social delivery and spend.",
        summaryPaths: ["totals", "platformCoverageAll", ...HEALTH_PATHS],
      },
      {
        endpoint: "/api/organic",
        as: "organic",
        required: true,
        views: ["organic"],
        why: "Unpaid social: sources, courses and the leads they produced.",
        summaryPaths: [
          "totals",
          "counts",
          "insights.bestConversionCourse",
          "insights.topLeadSource",
          "insights.topRevenueCourse",
          "insights.topRevenueSource",
          ...HEALTH_PATHS,
        ],
      },
      {
        endpoint: "/api/teams",
        as: "teamAggregates",
        required: false,
        operations: ["summary", "compare"],
        why: "Who handled the social leads, and against which target.",
        summaryPaths: ["targets", "chatwoot", ...HEALTH_PATHS],
      },
    ],
    freshnessPaths: ["health"],
    caveats: [
      t(
        "المدفوع والأورجانيك مصدرين مختلفين — متجمعش أرقامهم في رقم واحد من غير ما تقول.",
        "Paid and organic are two different sources — never add their figures into one without saying so.",
      ),
    ],
  },
  {
    id: "organic",
    routes: ["/organic"],
    section: "social",
    title: t("الأورجانيك", "Organic"),
    status: "CONNECTED",
    sensitivity: "internal",
    views: [],
    operations: ["summary", "list"],
    filters: [...PERIOD_FILTERS, "source", "course", "salesTeam"],
    entities: ["source", "course"],
    sources: [
      {
        endpoint: "/api/organic",
        as: "root",
        required: true,
        why: "Leads and sales that arrived with no ad spend behind them.",
        summaryPaths: [
          "counts",
          "health",
          "health.accountingDirect",
          "health.crmExclusions",
          "health.lostExclusions",
          "insights.bestConversionCourse",
          "insights.topLeadSource",
          "insights.topRevenueCourse",
          "insights.topRevenueSource",
          "insights.topSalesperson",
          "insights.topTeam",
        ],
      },
    ],
    rows: [
      {
        collection: "sources",
        kind: "source",
        fields: ["name", "label", "leads", "won", "revenue", "conversionRate"],
        limit: 25,
      },
      {
        collection: "courses",
        kind: "course",
        fields: ["name", "label", "leads", "won", "revenue", "conversionRate"],
        limit: 25,
      },
    ],
    freshnessPaths: ["health"],
    caveats: [
      t(
        "الأورجانيك مالوش إنفاق، فمينفعش يتقاس بـROAS.",
        "Organic has no spend, so it cannot be measured with ROAS.",
      ),
    ],
  },
  {
    id: "guide",
    routes: ["/guide"],
    section: "support",
    title: t("الدليل", "Guide"),
    status: "NOT_APPLICABLE",
    sensitivity: "public",
    views: [],
    operations: [],
    filters: [],
    entities: [],
    sources: [],
    note: "Documentation page. No analytics to retrieve.",
  },
];

// --- Lookups -----------------------------------------------------------------

const BY_ID = new Map(SURFACE_CONTRACTS.map((surface) => [surface.id, surface]));
const BY_ROUTE = new Map<string, SurfaceContract>();
for (const surface of SURFACE_CONTRACTS) {
  for (const route of surface.routes) BY_ROUTE.set(route, surface);
}

export const contractById = (id: string): SurfaceContract | null => BY_ID.get(id) ?? null;

export function contractForRoute(pathname: string): SurfaceContract | null {
  const normalized = (pathname || "/").toLowerCase().replace(/\/+$/, "") || "/";
  return (
    BY_ROUTE.get(normalized) ??
    SURFACE_CONTRACTS.find((surface) =>
      surface.routes.some((route) => route !== "/" && normalized.startsWith(`${route}/`)),
    ) ??
    null
  );
}

/**
 * The sources that actually apply to one request.
 *
 * This is the whole fix for `endpoints[0]`: a view or an operation narrows the
 * set, and everything that survives is fetched and merged. A source gated to a
 * view the caller did not ask for is skipped, not silently substituted.
 */
export function sourcesFor(
  surface: SurfaceContract,
  options: { view?: string | null; operation?: SurfaceOperation; args?: Record<string, string> } = {},
): SurfaceSource[] {
  const { view = null, operation = "summary", args = {} } = options;
  /**
   * An unnamed view means the surface's default set, never "no views at all".
   */
  const activeViews: readonly string[] = view
    ? [view]
    : (surface.defaultViews ?? surface.views.map((entry) => entry.id));
  return surface.sources.filter((source) => {
    if (source.views && !source.views.some((declared) => activeViews.includes(declared))) {
      return false;
    }
    if (source.operations && !source.operations.includes(operation)) return false;
    // A source that needs an argument nobody supplied is skipped rather than
    // called into a 400 — but only when it is optional. A required one that is
    // missing its argument is a caller error and must surface as one.
    if (source.requiredArgs?.length && !source.required) {
      return source.requiredArgs.every((key) => Boolean(args[key]));
    }
    return true;
  });
}

/** Every view id a surface declares, plus the implicit default. */
export const viewIds = (surface: SurfaceContract): string[] => surface.views.map((v) => v.id);

/** The operations a view supports — its own, or the surface's. */
export function operationsFor(surface: SurfaceContract, view?: string | null): SurfaceOperation[] {
  const found = view ? surface.views.find((v) => v.id === view) : null;
  return [...(found?.operations ?? surface.operations)];
}

/** Standing caveats for a surface, plus anything the chosen view adds. */
export function caveatsFor(surface: SurfaceContract, view?: string | null): Bilingual[] {
  const found = view ? surface.views.find((v) => v.id === view) : null;
  return [...(surface.caveats ?? []), ...(found?.caveats ?? [])];
}

/**
 * Endpoints an agent must never call.
 *
 * Everything that publishes, imports, recalculates, refreshes, ingests or
 * sends. Read intelligence is the whole of this phase; a mutation reached by a
 * misread sentence is not a risk worth carrying.
 */
export const AGENT_FORBIDDEN_ENDPOINTS = [
  "/api/pricing.publish",
  "/api/pricing.recalculate",
  "/api/pricing.import.preview",
  "/api/refresh",
  "/api/ingest.dataset",
  "/api/telegram.send-daily",
  "/api/telegram.send-course-alerts",
  "/api/telegram.setup",
  "/api/telegram.preview",
  "/api/telegram.webhook",
  "/api/chatwoot.webhook",
  "/api/auth.sso",
  "/api/accounting-export",
  "/api/employee-call-recording",
  "/api/employee-call-detail",
] as const;
