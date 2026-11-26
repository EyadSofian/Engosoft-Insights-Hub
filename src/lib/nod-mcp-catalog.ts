/**
 * Every dashboard GET endpoint an outside agent (Nod) may read in full over MCP.
 *
 * `insights_read` answers through the curated surface gateway, which keeps row
 * collections short on purpose. This catalog is the other half: the exact JSON
 * each page renders, ad set by ad set and creative by creative, so nothing the
 * dashboard shows is out of reach. `insights_get` only calls endpoints listed
 * here, always with GET, so it cannot publish, refresh, ingest or send.
 *
 * A test checks that every GET route is either here or in NOD_EXCLUDED_ENDPOINTS
 * with a reason, so a new page cannot be silently missing from the agent.
 */

export interface NodEndpoint {
  path: string;
  page: string;
  what: string;
  /** Query parameters beyond the standard period filters, when the route reads them. */
  params?: readonly string[];
  /** True when the route accepts the standard filters (from, to, range, month, company, …). */
  filters?: boolean;
}

/** Standard filters every `filters: true` endpoint accepts through parseFilters. */
export const STANDARD_FILTERS = {
  from: "Start date, YYYY-MM-DD",
  to: "End date, YYYY-MM-DD",
  range: "Preset: 7d, 30d, mtd, ytd, …",
  month: "A month, YYYY-MM",
  company: "Odoo company: 2 Egypt, 3 KSA, 4 UAE",
  platform: "meta, tiktok, snap, google",
  account: "Ad account id",
  campaign: "Campaign name or id",
  course: "Course name",
  source: "Lead source",
  salesTeam: "Sales team",
  salesperson: "Salesperson",
} as const;

export const NOD_ENDPOINTS: readonly NodEndpoint[] = [
  // Business overview
  { path: "/api/overview", page: "Overview", what: "Headline spend, leads, won, revenue, ROAS and per-platform totals.", filters: true },
  { path: "/api/overview-revenue-source", page: "Overview", what: "Revenue broken down by source, with the invoices behind one source.", params: ["sourceKey", "offset"], filters: true },
  { path: "/api/filters", page: "Top bar", what: "Valid values for every filter: companies, platforms, accounts, campaigns, courses, teams." },
  { path: "/api/search", page: "Top bar", what: "Search across campaigns, courses, leads and people.", params: ["q"] },
  { path: "/api/health", page: "System", what: "Data source health and last sync times.", params: ["details"] },

  // Paid media
  { path: "/api/campaigns", page: "Campaigns", what: "Every campaign with spend, impressions, clicks, leads, won, revenue and ROAS.", params: ["grain"], filters: true },
  { path: "/api/campaign-risk", page: "Campaigns", what: "Campaigns at risk (overspend, no leads, low quality)." },
  { path: "/api/ads", page: "Ads", what: "Every ad set and ad: delivery, spend, CTR, CPM, CPC, leads and cost per lead.", params: ["grain"], filters: true },
  { path: "/api/ads-creatives", page: "Creatives", what: "Every creative with its media, copy, spend and results.", filters: true },
  { path: "/api/acquisition/creative-detail", page: "Creatives", what: "Full detail of one creative.", params: ["creativeId"] },
  { path: "/api/media-buyers", page: "Media buyers", what: "Results per media buyer.", filters: true },
  { path: "/api/media-plan", page: "Media plan", what: "The monthly media plan and budget per course and platform.", params: ["month"], filters: true },
  { path: "/api/media-plan-activity", page: "Media plan", what: "Plan versus actual delivery for a month.", params: ["month"], filters: true },
  { path: "/api/media-plan-leads", page: "Media plan", what: "The leads behind one media-plan line.", params: ["month", "key", "company", "bucket", "stage", "opportunityLost", "page"] },
  { path: "/api/marketing-costs", page: "Accounting", what: "Advertising and WhatsApp messaging costs.", params: ["compact"], filters: true },
  { path: "/api/meta-destination-mix", page: "Social media", what: "Meta ads by destination (form, WhatsApp, website).", params: ["from", "to"] },

  // Acquisition and attribution
  { path: "/api/acquisition/summary", page: "Acquisition", what: "Acquisition funnel summary by campaign, ad set, ad or form.", params: ["from", "to", "campaignId", "adsetId", "adId", "formId", "entityType", "sourceType", "destination"] },
  { path: "/api/acquisition/performance", page: "Acquisition", what: "Acquisition performance: ads, leads, sales and coverage." },
  { path: "/api/acquisition/events", page: "Acquisition", what: "Latest acquisition events.", params: ["limit"] },
  { path: "/api/acquisition/closed-loop", page: "Acquisition", what: "Closed loop from ad to collected revenue.", params: ["channel", "platform", "fxEgp", "fxSar"] },
  { path: "/api/acquisition/inferred-links", page: "Acquisition", what: "Leads linked to ads by inference, with confidence." },
  { path: "/api/acquisition/closed-loop-refresh", page: "Acquisition", what: "State of the last closed-loop rebuild (read only)." },
  { path: "/api/attribution/summary", page: "Attribution", what: "Conversation attribution summary.", params: ["from", "to", "platform", "channel", "campaignId", "adsetId", "adId", "source", "medium", "method", "confidence", "crmStatus", "agentId", "inboxId", "branchId", "unknownReason"] },
  { path: "/api/attribution/conversations", page: "Attribution", what: "Each attributed conversation.", params: ["from", "to", "platform", "channel", "campaignId", "adsetId", "adId", "source", "medium", "method", "confidence", "crmStatus", "agentId", "inboxId", "branchId", "unknownReason", "limit", "offset"] },
  { path: "/api/attribution/health", page: "Attribution", what: "Attribution pipeline health." },
  { path: "/api/attribution/meta-health", page: "Attribution", what: "Meta attribution health." },
  { path: "/api/attribution/chatwoot-reconcile", page: "Attribution", what: "Chatwoot reconciliation status (read only)." },
  { path: "/api/landing-attribution/summary", page: "Landing pages", what: "Landing page visits and conversions by source and campaign.", params: ["from", "to", "source", "medium", "campaign", "content", "landingPageId", "touch"] },
  { path: "/api/website", page: "Website", what: "Website performance, website campaigns, leads and sales.", filters: true },
  { path: "/api/organic", page: "Organic", what: "Organic social results.", filters: true },
  { path: "/api/source-reconciliation", page: "Number review", what: "Lead counts reconciled between platforms and CRM.", filters: true },
  { path: "/api/meta/credential-health", page: "Messaging readiness", what: "Meta credential checks (no secrets)." },
  { path: "/api/meta/messaging-readiness", page: "Messaging readiness", what: "WhatsApp/Meta messaging readiness checklist." },
  { path: "/api/meta/catalog-reconcile", page: "Messaging readiness", what: "Meta catalog reconciliation progress (read only)." },
  { path: "/api/meta/lead-ads/operations", page: "Lead ads", what: "Meta lead ads worker health." },

  // CRM and leads
  { path: "/api/leads", page: "Leads", what: "CRM counts plus ownershipAudit: current owner missing, recorded-duplicate Lost, other Lost and active unowned. Current owner is not assignment/contact history.", filters: true },
  { path: "/api/lead-intelligence", page: "Leads", what: "Lead intelligence per course and owner.", params: ["focusCourse", "focusOwner", "page"], filters: true },
  { path: "/api/lead-performance", page: "Leads", what: "Entry-month cohort performance, identity-duplicate candidates, recorded duplicate reasons and ownershipAudit. Read ownershipAudit before interpreting a blank salesperson.", params: ["course", "month"] },
  { path: "/api/weekly-lead-followup", page: "Leads", what: "Weekly lead follow-up.", params: ["week", "page"] },
  { path: "/api/lead-course-distribution", page: "Lead distribution", what: "Leads by course, stage and bucket, with the leads behind each cell.", params: ["dimension", "label", "bucket", "stage", "opportunityLost", "page"], filters: true },
  { path: "/api/lead-source-matrix", page: "Lead sources", what: "Lead source by course matrix, with the leads behind each cell.", params: ["matrixCourse", "matrixSource", "page"], filters: true },
  { path: "/api/lead-qa", page: "Leads", what: "Lead QA verdicts (ids=1,2,3) or one lead's history (history=id).", params: ["ids", "history"] },
  { path: "/api/uncalled-leads", page: "Leads", what: "Explicit contact-evidence report with coverage: unknown is not uncontacted; a blank owner or Lost reason does not prove nobody called.", params: ["employee", "scope", "status", "sort", "page", "pageSize"], filters: true },
  { path: "/api/quarter-leads-review", page: "Quarter leads review", what: "Quarterly native-lead and course-cohort review.", filters: true },
  { path: "/api/course-lead-alerts", page: "Courses", what: "Course lead alerts.", filters: true },
  { path: "/api/lost", page: "Lost", what: "Lost leads by reason, team, course and salesperson.", filters: true },
  { path: "/api/lost-chatter", page: "Lost", what: "The Odoo chatter of one lost lead.", params: ["id"], filters: true },
  { path: "/api/lost-archive-audit", page: "Lost", what: "Audit of archived lost leads.", params: ["month", "course", "salesperson"] },
  { path: "/api/crm-calls", page: "Teams", what: "CRM call activity per salesperson.", filters: true },
  { path: "/api/employee-calls", page: "Teams", what: "Phone calls per employee and extension.", params: ["extension", "page", "page_size"], filters: true },
  { path: "/api/employee-call-detail", page: "Teams", what: "Detail of one call.", params: ["id"] },
  { path: "/api/employee-evidence", page: "Teams", what: "Calls and chats evidence per employee.", params: ["employee", "extension", "chatwoot_agent_id"], filters: true },

  // Sales, accounting, courses
  { path: "/api/sales", page: "Sales", what: "Sales orders and collections.", filters: true },
  { path: "/api/accounting", page: "Accounting", what: "Collected revenue, invoices and payments from Odoo.", filters: true },
  { path: "/api/accounting-net-sales", page: "Accounting", what: "Net sales after refunds.", params: ["scope"], filters: true },
  { path: "/api/full-invoiced", page: "Full invoiced", what: "Fully invoiced orders.", filters: true },
  { path: "/api/revenue-cohorts", page: "Accounting", what: "Revenue by lead entry cohort.", filters: true },
  { path: "/api/profitability", page: "Accounting · P&L", what: "Profit and loss: revenue, costs and margin per course and month.", params: ["detailMonth", "compareMonth", "throughDay"], filters: true },
  { path: "/api/profitability-ledger", page: "Accounting · P&L", what: "The ledger lines behind one P&L figure.", params: ["ledgerCode", "periodFrom", "periodTo", "page"], filters: true },
  { path: "/api/courses", page: "Courses", what: "Every course: leads, sales, collections, campaigns and seller ranking.", params: ["detail", "sellerRanking"], filters: true },
  { path: "/api/agent-course-intelligence", page: "Courses", what: "Course intelligence per course.", params: ["course", "productMix", "variants"], filters: true },
  { path: "/api/agent-course-invoices", page: "Courses", what: "Invoices per course and salesperson.", params: ["course", "agent"], filters: true },
  { path: "/api/products", page: "Products", what: "Odoo products and courses." },

  // Teams and management
  { path: "/api/teams", page: "Teams", what: "Sales teams and salespeople: targets, sales, collections, win rates.", filters: true },
  { path: "/api/team-course-leads", page: "Teams", what: "Paginated Odoo records behind one salesperson/course lead-count matrix cell; current owner, primary course and creation-period filters, not contact counts.", filters: true, params: ["ownerKey", "matrixCourse", "offset", "limit"] },
  { path: "/api/targets", page: "Teams", what: "Monthly targets.", params: ["month"] },
  { path: "/api/management-review", page: "Management review", what: "Review for the global date/filter window; selectedPeriod is authoritative. Full monthly media-plan targets are separate from employee sales targets. Legacy month is used only without explicit dates.", filters: true, params: ["month"] },
  { path: "/api/daily-updates", page: "Daily updates", what: "Daily course KPIs.", params: ["day"], filters: true },
  { path: "/api/weekend", page: "Weekend", what: "Weekend versus weekday performance.", filters: true },
  { path: "/api/yoy", page: "Year over year", what: "Year-over-year comparison.", params: ["year", "month"] },
  { path: "/api/telegram/preview", page: "Telegram", what: "Preview of the daily Telegram report (sends nothing).", params: ["days"] },
  { path: "/api/agent-insights", page: "Agent", what: "The curated surface gateway over HTTP (same as insights_read).", params: ["surface", "view", "operation", "lang"] },

  // Pricing
  { path: "/api/pricing/catalog", page: "Pricing", what: "Price catalogue with live offers.", params: ["bookId", "dateBasis", "includeInactive", "liveOffers", "needsReview", "limit", "offset"] },
  { path: "/api/pricing/books", page: "Pricing", what: "Price books." },
  { path: "/api/pricing/items", page: "Pricing", what: "Price items of a book.", params: ["bookId", "needsReview", "unmapped", "limit", "offset"] },
  { path: "/api/pricing/facets", page: "Pricing", what: "Pricing filters and facets.", params: ["bookId"] },
  { path: "/api/pricing/changelog", page: "Pricing", what: "Price change history.", params: ["bookId", "itemId", "limit"] },
  { path: "/api/pricing/compliance", page: "Pricing", what: "Invoices sold below or above list price.", params: ["rows"] },
  { path: "/api/pricing/exceptions", page: "Pricing", what: "Pricing exceptions." },
  { path: "/api/pricing/mappings", page: "Pricing", what: "Course to Odoo product mappings." },
  { path: "/api/pricing/diagnostics", page: "Pricing", what: "Pricing diagnostics.", params: ["odoo"] },
  { path: "/api/pricing/invoices/$movement", page: "Pricing", what: "Invoices behind one price movement; replace $movement with its id." },
  { path: "/api/prices/catalog", page: "Pricing", what: "Published price list.", params: ["limit", "offset"] },
  { path: "/api/prices/advice", page: "Pricing", what: "Price to quote for a market and payment plan.", params: ["market", "mode", "payment", "state"] },
];

/** GET routes deliberately left out, with the reason. Read by the coverage test. */
export const NOD_EXCLUDED_ENDPOINTS: Readonly<Record<string, string>> = {
  "/api/mcp": "The MCP endpoint itself.",
  "/api/auth/logout": "Session control, not data.",
  "/api/telegram/setup": "Telegram webhook administration.",
  "/api/ingest/dataset": "Raw ingestion store behind its own secret.",
  "/api/meta/leadgen-webhook": "Provider webhook handshake.",
  "/api/meta/whatsapp-attribution-webhook": "Provider webhook handshake.",
  "/api/accounting-export": "Excel download; /api/accounting carries the same data as JSON.",
  "/api/lead-course-export": "Excel download; /api/lead-course-distribution carries the same data as JSON.",
  "/api/lead-performance-export": "Excel download; /api/lead-performance carries the same data as JSON.",
  "/api/employee-call-recording": "Audio file.",
};

/** Query parameters that make a GET recompute or bypass caches; dropped before forwarding. */
export const NOD_STRIPPED_PARAMS = new Set(["force"]);

const BY_PATH = new Map(NOD_ENDPOINTS.map((endpoint) => [endpoint.path, endpoint]));

/**
 * Resolves the caller's path to a catalog entry. `$movement` style segments
 * accept any single safe segment in their place.
 */
export function matchNodEndpoint(path: string): { entry: NodEndpoint; path: string } | null {
  const clean = path.trim().split("?")[0].replace(/\/+$/u, "");
  if (!/^\/api\/[A-Za-z0-9/_.$-]+$/u.test(clean) || clean.includes("..")) return null;
  const exact = BY_PATH.get(clean);
  if (exact && !clean.includes("$")) return { entry: exact, path: clean };
  for (const entry of NOD_ENDPOINTS) {
    if (!entry.path.includes("$")) continue;
    const pattern = new RegExp(
      "^" + entry.path.replace(/[.*+?^{}()|[\]\\]/gu, "\\$&").replace(/\\?\$[A-Za-z]+/gu, "[A-Za-z0-9_.-]+") + "$",
      "u",
    );
    if (pattern.test(clean) && !clean.includes("$")) return { entry, path: clean };
  }
  return null;
}
