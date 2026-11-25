/**
 * The tools Insights Hub offers an outside agent (Nod) over MCP.
 *
 * Two ways to read. `insights_read` answers through the same curated gateway
 * as ENGO Nexus (`readSurface`): headline figures with caveats. `insights_get`
 * returns the full JSON of any page's endpoint from `nod-mcp-catalog.ts`, so
 * every ad set, creative, lead and row is reachable, paged when large. The one
 * action is the dashboard's own "refresh data" button, with its cooldown.
 */
import { SURFACE_CONTRACTS } from "./agent-surface-contract";
import { AGENT_READABLE_SURFACES } from "./agent-insights-registry";
import { readSurface } from "./agent-surface-gateway.server";
import { McpToolError, str, type McpServerSpec, type McpTool } from "./mcp-core.server";
import {
  NOD_ENDPOINTS,
  NOD_STRIPPED_PARAMS,
  STANDARD_FILTERS,
  matchNodEndpoint,
} from "./nod-mcp-catalog";
import { SLICE_INPUT_PROPERTIES, sliceJson } from "./mcp-json-slice";
import { issuePnlCookie, pnlGuardApplies } from "./profitability-access.server";
import { issueRevenueSessionCookie, revenueGuardApplies } from "./revenue-access.server";
import { LEAD_OWNERSHIP_INTERPRETATION } from "./lead-ownership-audit";

/**
 * Where internal reads go. Over loopback when the port is known, so the
 * service secret and admin code never cross the network: `request.url` reports
 * `http://<public host>` behind Railway's proxy, and a read sent there leaves
 * the container in plain HTTP and comes back as a 301 to https.
 */
const originOf = (request: Request) => {
  const port = process.env.PORT?.trim();
  if (port && /^\d+$/u.test(port)) return `http://127.0.0.1:${port}`;
  const url = new URL(request.url);
  return `https://${url.host}`;
};

/** First `name=value` pair of a Set-Cookie string, for a Cookie header. */
const cookiePair = (setCookie: string | null) => (setCookie ? setCookie.split(";")[0] : "");

/**
 * The credentials a page's own request would carry, for a server-side read.
 *
 * Runs inside the dashboard's own server, so it presents the service secret,
 * the admin code and, for the P&L and revenue pages, a freshly signed gate
 * cookie. None of those values ever leave the process: the agent only ever
 * holds NOD_MCP_TOKEN. The owner chose to open the P&L to Nod on 2026-11-25.
 */
function trustedHeaders(url: URL, base?: HeadersInit): Headers {
  const headers = new Headers(base);
  const service = process.env.INTERNAL_API_SECRET?.trim();
  if (service) headers.set("x-service-secret", service);
  const admin = process.env.DASHBOARD_ADMIN_SECRET?.trim();
  if (admin) headers.set("x-admin-secret", admin);
  const probe = new Request(url);
  const cookies: string[] = [];
  try {
    if (pnlGuardApplies(probe)) cookies.push(cookiePair(issuePnlCookie()));
  } catch {
    // P&L lock not configured: the route answers on its own terms.
  }
  if (revenueGuardApplies(probe)) cookies.push(cookiePair(issueRevenueSessionCookie()));
  const cookie = cookies.filter(Boolean).join("; ");
  if (cookie) headers.set("cookie", cookie);
  return headers;
}

/** Calls the dashboard's own endpoints as a trusted service; used by the surface gateway too. */
const serviceFetch: typeof fetch = (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  return fetch(input, { ...init, headers: trustedHeaders(url, init.headers) });
};

/**
 * Reads one dashboard endpoint exactly as its page does.
 */
async function fullRead(origin: string, path: string, params: URLSearchParams) {
  const url = new URL(path, origin);
  for (const [key, value] of params)
    if (!NOD_STRIPPED_PARAMS.has(key)) url.searchParams.set(key, value);
  const headers = trustedHeaders(url, { accept: "application/json" });
  const response = await fetch(url, { headers, redirect: "manual" });
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("json")) {
    throw new McpToolError(
      `${path} answered HTTP ${response.status} with ${type || "no content type"}, not JSON.`,
    );
  }
  return { status: response.status, body: (await response.json()) as unknown };
}

const listEndpoints: McpTool = {
  name: "insights_list_endpoints",
  title: "List every dashboard data endpoint",
  description:
    "Lists every data endpoint behind every page and tab of the dashboard (campaigns, every ad set and ad, creatives, leads, CRM, lost, teams, calls, sales, accounting, P&L, courses, pricing, attribution, media plan, …) with the parameters each accepts. Use insights_get to read any of them in full.",
  inputSchema: {
    type: "object",
    properties: {
      page: {
        type: "string",
        description: "Optional page name to narrow the list, e.g. Ads or Leads.",
      },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  run: async (args) => {
    const page = str(args, "page").toLowerCase();
    const endpoints = NOD_ENDPOINTS.filter(
      (endpoint) => !page || endpoint.page.toLowerCase().includes(page),
    );
    return {
      count: endpoints.length,
      endpoints: endpoints.map((endpoint) => ({
        path: endpoint.path,
        page: endpoint.page,
        what: endpoint.what,
        ...(endpoint.params ? { params: endpoint.params } : {}),
        ...(endpoint.filters ? { standardFilters: true } : {}),
      })),
      standardFilters: STANDARD_FILTERS,
      paging:
        'insights_get returns small answers whole. A large one comes back as an outline; then pass path (e.g. "rows") and page lists with offset/limit until nextOffset is gone.',
    };
  },
};

const getEndpoint: McpTool = {
  name: "insights_get",
  title: "Read any dashboard endpoint in full",
  description:
    "Reads one endpoint from insights_list_endpoints in full, paged when large. For owner/assignment/contact questions read ownershipAudit and interpretationRules first: missing current owner never proves never-assigned or never-contacted; Lost duplicate reasons must be separated from open unowned leads. Large answers return an outline; read parts with path and page with offset/limit.",
  inputSchema: {
    type: "object",
    properties: {
      endpoint: {
        type: "string",
        description: "Path from insights_list_endpoints, e.g. /api/ads.",
      },
      params: {
        type: "object",
        description:
          'Query parameters, e.g. {"from":"2026-11-01","to":"2026-11-25","company":"2"}.',
        additionalProperties: { type: ["string", "number", "boolean"] },
      },
      ...SLICE_INPUT_PROPERTIES,
    },
    required: ["endpoint"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  run: async (args, { request }) => {
    const match = matchNodEndpoint(str(args, "endpoint", true));
    if (!match)
      throw new McpToolError("Unknown endpoint. Call insights_list_endpoints for the valid paths.");
    const raw = args.params;
    if (raw !== undefined && (typeof raw !== "object" || raw === null || Array.isArray(raw))) {
      throw new McpToolError('"params" must be an object.');
    }
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
      if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
    }
    const { status, body } = await fullRead(originOf(request), match.path, params);
    const slice = sliceJson(body, {
      path: typeof args.path === "string" ? args.path : "",
      offset: typeof args.offset === "number" ? args.offset : undefined,
      limit: typeof args.limit === "number" ? args.limit : undefined,
    });
    const audit =
      body && typeof body === "object" && "ownershipAudit" in body
        ? (body as Record<string, unknown>).ownershipAudit
        : undefined;
    return {
      endpoint: match.path,
      page: match.entry.page,
      httpStatus: status,
      ...slice,
      // Must survive path/offset slicing: one isolated owner row is not its evidence contract.
      ...(audit ? { ownershipAudit: audit } : {}),
      interpretationRules: LEAD_OWNERSHIP_INTERPRETATION,
    };
  },
};

const listSurfaces: McpTool = {
  name: "insights_list_surfaces",
  title: "List dashboard surfaces",
  description:
    "Lists every page of the Engosoft marketing & sales dashboard that can be read: its id, Arabic and English title, views, operations and accepted filters. Call this first to pick the right surface for insights_read.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  run: async () => {
    const readable = new Set(AGENT_READABLE_SURFACES.map((surface) => surface.id));
    return {
      surfaces: SURFACE_CONTRACTS.filter((contract) => readable.has(contract.id)).map(
        (contract) => ({
          id: contract.id,
          title: contract.title,
          status: contract.status,
          personalData: contract.sensitivity === "personal",
          operations: contract.operations,
          views: contract.views.map((view) => ({
            id: view.id,
            title: view.title,
            ...(view.operations ? { operations: view.operations } : {}),
          })),
          filters: contract.filters,
          ...(contract.note ? { note: contract.note } : {}),
        }),
      ),
      filterHelp: {
        from: "Start date, YYYY-MM-DD",
        to: "End date, YYYY-MM-DD",
        range: "A preset such as 7d, 30d, mtd, ytd",
        month: "A month, YYYY-MM",
        company: "Odoo company: 2 Egypt, 3 KSA, 4 UAE",
      },
    };
  },
};

const read: McpTool = {
  name: "insights_read",
  title: "Read a dashboard surface",
  description:
    "Reads live figures from one dashboard surface (overview, campaigns, ads, website, accounting, courses, leads, lost, teams, …): ad spend, leads, collected revenue, ROAS, CRM, lost reasons and team targets. Returns figures with their sources and caveats. Use insights_list_surfaces to see valid surfaces, views, operations and filters.",
  inputSchema: {
    type: "object",
    properties: {
      surface: {
        type: "string",
        description: "Surface id, e.g. overview, campaigns, accounting, leads.",
      },
      operation: {
        type: "string",
        enum: ["summary", "list", "detail", "compare", "trend", "search"],
        description: "What to read. Defaults to summary.",
      },
      view: { type: "string", description: "Optional view id inside the surface." },
      filters: {
        type: "object",
        description:
          'Optional filters the surface declares, e.g. {"from":"2026-11-01","to":"2026-11-24"}.',
        additionalProperties: { type: "string" },
      },
      lang: {
        type: "string",
        enum: ["ar", "en"],
        description: "Language of caveats. Defaults to ar.",
      },
    },
    required: ["surface"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  run: async (args, { request }) => {
    const params = new URLSearchParams();
    const filters = args.filters;
    if (
      filters !== undefined &&
      (typeof filters !== "object" || filters === null || Array.isArray(filters))
    ) {
      throw new McpToolError('"filters" must be an object of strings.');
    }
    for (const [key, value] of Object.entries((filters ?? {}) as Record<string, unknown>)) {
      if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
    }
    const result = await readSurface({
      surfaceId: str(args, "surface", true),
      operation: str(args, "operation") || "summary",
      view: str(args, "view") || null,
      params,
      origin: originOf(request),
      lang: str(args, "lang") === "en" ? "en" : "ar",
      fetchImpl: serviceFetch,
    });
    if (result.status === "UNKNOWN_ENTITY") {
      throw new McpToolError(`${result.reason} Call insights_list_surfaces for valid ids.`);
    }
    return result;
  },
};

const refresh: McpTool = {
  name: "insights_refresh_data",
  title: "Refresh dashboard data",
  description:
    "Reloads the dashboard's data from Odoo, the ad platforms and the stored snapshots — the same as the Refresh button. Takes up to a few minutes. Within two minutes of the last refresh it returns the stored copy instead. Use only when the owner asks for fresh numbers.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  run: async (_args, { request }) => {
    const response = await serviceFetch(new URL("/api/refresh", originOf(request)), {
      method: "POST",
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new McpToolError(`Refresh failed with HTTP ${response.status}.`);
    return (await response.json()) as Record<string, unknown>;
  },
};

export const INSIGHTS_MCP: McpServerSpec = {
  name: "engosoft-insights-hub",
  version: "1.1.0",
  instructions:
    "Engosoft Insights Hub: marketing & sales figures for Engosoft (Egypt, KSA, UAE). For headline answers use insights_list_surfaces then insights_read. For full detail use insights_list_endpoints then insights_get. Revenue is collected cash from Odoo by payment date. Report each figure with its period and any caveat the result carries. " +
    LEAD_OWNERSHIP_INTERPRETATION.en +
    " Management review follows the global date window: check selectedPeriod and targetBasis before comparing with teams. Media-plan targets and employee quotas are different sources. Target achievement is not a lead conversion rate; calculate deficits from the stated denominator, never infer a guaranteed uplift from a ranking. Answer in the owner's language; the data labels are Arabic-first.",
  tools: [listSurfaces, read, listEndpoints, getEndpoint, refresh],
};
