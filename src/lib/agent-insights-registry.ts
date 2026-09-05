/**
 * Every analytical surface the dashboard shows, and how an agent reaches it.
 *
 * WHY THIS EXISTS. ENGO Nexus could reach seven of the sixteen visible
 * surfaces. Asked "الويبسايت باع بكام؟" it answered that it did not have the
 * data — while /website was showing the figure. That is not a data gap, it is
 * an unwired capability, and the two are indistinguishable to a user.
 *
 * This registry is ARCHITECTURE METADATA, not business data. It records which
 * route a surface owns, which internal views it has, which endpoint answers it,
 * and whether an agent may read it. Tests assert that every visible navigation
 * route appears here, so a new page cannot ship without either coverage or an
 * explicit decision not to.
 *
 * It contains no figures and performs no computation — the endpoints it names
 * are the dashboard's own, so the agent and the page cannot diverge.
 */

export type SurfaceStatus =
  "CONNECTED" | "PARTIAL" | "MISSING" | "NOT_AGENT_SAFE" | "NOT_APPLICABLE";

export type SurfaceOperation = "summary" | "list" | "detail" | "compare" | "trend" | "search";

export interface InsightsSurface {
  /** Stable id used by the agent tool. Never a URL. */
  id: string;
  /** Routes that resolve to this surface, including legacy aliases. */
  routes: string[];
  /** Navigation section this surface belongs to. */
  section: string;
  /** Internal analytical views the page switches between, if any. */
  views: string[];
  /** Dashboard endpoints that supply it. The agent never sees these. */
  endpoints: string[];
  /** What an agent may ask of it. */
  operations: SurfaceOperation[];
  /** Entity kinds selectable on this surface. */
  entities: string[];
  /** True when the surface can expose personal data and needs care. */
  sensitive: boolean;
  status: SurfaceStatus;
  /**
   * Where this surface keeps its headline figures, as dot paths.
   *
   * `totals` and `summary` are the dashboard's two conventions and are always
   * tried. A surface that keeps them elsewhere says so here — Weekend nests
   * them under `portfolio.weekend`, Media Plan under `plan` — and without that
   * the agent received a payload with no numbers it could quote.
   */
  summaryPaths?: string[];
  /** Why, when the status is not CONNECTED. */
  note?: string;
}

export const INSIGHTS_SURFACES: InsightsSurface[] = [
  {
    id: "overview",
    routes: ["/"],
    section: "business",
    views: [],
    endpoints: ["/api/overview", "/api/teams"],
    operations: ["summary", "trend"],
    entities: [],
    sensitive: false,
    status: "CONNECTED",
  },
  {
    id: "campaigns",
    routes: ["/campaigns"],
    section: "campaigns",
    views: [],
    endpoints: ["/api/campaigns", "/api/campaign-risk"],
    operations: ["summary", "list", "detail", "compare"],
    entities: ["campaign"],
    sensitive: false,
    status: "CONNECTED",
  },
  {
    id: "ads",
    routes: ["/ads"],
    section: "campaigns",
    views: [],
    endpoints: ["/api/ads"],
    operations: ["summary", "list", "detail"],
    entities: ["campaign", "adset", "ad"],
    sensitive: false,
    status: "CONNECTED",
  },
  {
    id: "website",
    routes: ["/website"],
    section: "campaigns",
    views: ["owner", "campaigns", "operations"],
    endpoints: ["/api/website"],
    operations: ["summary", "list", "detail"],
    entities: ["campaign", "course", "owner"],
    sensitive: false,
    status: "CONNECTED",
  },
  {
    id: "accounting",
    routes: ["/accounting", "/full-invoiced", "/products", "/sales"],
    section: "sales",
    views: ["summary", "months", "profitability"],
    endpoints: ["/api/accounting", "/api/sales", "/api/profitability"],
    operations: ["summary", "list", "trend"],
    entities: ["course", "product", "salesperson"],
    // Invoice rows carry customer names; aggregates only for the agent.
    sensitive: true,
    status: "CONNECTED",
  },
  {
    id: "courses",
    routes: ["/courses"],
    section: "sales",
    views: ["campaigns", "alerts", "all"],
    endpoints: ["/api/courses", "/api/agent-course-intelligence", "/api/course-lead-alerts"],
    operations: ["summary", "list", "detail", "compare", "trend"],
    entities: ["course", "campaign", "product"],
    sensitive: false,
    status: "CONNECTED",
  },
  {
    id: "pricing",
    routes: ["/pricing"],
    section: "sales",
    views: [],
    // The file is pricing.catalog.ts; TanStack serves it at /api/pricing/catalog.
    endpoints: ["/api/pricing/catalog"],
    operations: ["summary", "search"],
    entities: ["product"],
    sensitive: false,
    status: "PARTIAL",
    note: "Current sell price is PriceEngo's, not this page's. The agent quotes PriceEngo; this surface exposes the internal catalogue view only.",
  },
  {
    id: "leads",
    routes: ["/leads"],
    section: "leads",
    views: [],
    endpoints: ["/api/leads", "/api/crm-calls", "/api/uncalled-leads"],
    operations: ["summary", "list", "trend"],
    entities: ["source", "course", "salesperson"],
    // Lead rows carry phone and email — aggregates only.
    sensitive: true,
    status: "CONNECTED",
  },
  {
    id: "lost",
    routes: ["/lost"],
    section: "leads",
    views: ["team", "course"],
    endpoints: ["/api/lost"],
    operations: ["summary", "list"],
    entities: ["course", "team", "salesperson"],
    sensitive: true,
    status: "CONNECTED",
  },
  {
    id: "teams",
    routes: ["/teams"],
    section: "leads",
    views: [],
    endpoints: ["/api/teams"],
    operations: ["summary", "list", "detail", "compare"],
    entities: ["team", "salesperson"],
    sensitive: true,
    status: "CONNECTED",
  },
  {
    id: "weekend",
    routes: ["/weekend"],
    section: "comparisons",
    views: [],
    endpoints: ["/api/weekend"],
    operations: ["summary", "compare"],
    entities: [],
    sensitive: false,
    status: "CONNECTED",
    summaryPaths: ["portfolio.weekend", "portfolio.comparison", "window"],
  },
  {
    id: "yoy",
    routes: ["/yoy"],
    section: "comparisons",
    views: [],
    endpoints: ["/api/yoy"],
    operations: ["summary", "compare", "trend"],
    entities: ["course"],
    sensitive: false,
    status: "CONNECTED",
  },
  {
    id: "media_buyers",
    routes: ["/media-buyers"],
    section: "media-buyers",
    views: [],
    endpoints: ["/api/media-buyers"],
    operations: ["summary", "list", "compare"],
    entities: ["media_buyer", "campaign"],
    sensitive: true,
    status: "CONNECTED",
  },
  {
    id: "media_plan",
    routes: ["/media-plan"],
    section: "media-buyers",
    views: [],
    endpoints: ["/api/media-plan", "/api/media-plan-activity"],
    operations: ["summary", "list"],
    entities: ["campaign", "media_buyer"],
    sensitive: false,
    status: "CONNECTED",
    summaryPaths: ["plan", "window", "actual"],
  },
  {
    id: "social_media",
    routes: ["/social-media"],
    section: "social",
    views: [],
    endpoints: ["/api/ads", "/api/organic", "/api/teams"],
    operations: ["summary", "list"],
    entities: ["campaign", "source"],
    sensitive: false,
    status: "CONNECTED",
  },
  {
    id: "organic",
    routes: ["/organic"],
    section: "social",
    views: [],
    endpoints: ["/api/organic"],
    operations: ["summary", "list"],
    entities: ["source", "course"],
    sensitive: false,
    status: "CONNECTED",
  },
  {
    id: "guide",
    routes: ["/guide"],
    section: "support",
    views: [],
    endpoints: [],
    operations: [],
    entities: [],
    sensitive: false,
    status: "NOT_APPLICABLE",
    note: "Documentation page. No analytics to retrieve.",
  },
];

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
];

const BY_ROUTE = new Map<string, InsightsSurface>();
for (const surface of INSIGHTS_SURFACES) {
  for (const route of surface.routes) BY_ROUTE.set(route, surface);
}

/** The surface a pathname belongs to, or null. */
export function surfaceForRoute(pathname: string): InsightsSurface | null {
  const normalized = (pathname || "/").toLowerCase().replace(/\/+$/, "") || "/";
  return (
    BY_ROUTE.get(normalized) ??
    INSIGHTS_SURFACES.find((surface) =>
      surface.routes.some((route) => route !== "/" && normalized.startsWith(`${route}/`)),
    ) ??
    null
  );
}

export const surfaceById = (id: string): InsightsSurface | null =>
  INSIGHTS_SURFACES.find((surface) => surface.id === id) ?? null;

/** Surfaces an agent may actually read. */
export const AGENT_READABLE_SURFACES = INSIGHTS_SURFACES.filter(
  (surface) => surface.status === "CONNECTED" || surface.status === "PARTIAL",
);
