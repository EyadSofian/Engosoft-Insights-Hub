/**
 * The tools Insights Hub offers an outside agent (Nod) over MCP.
 *
 * Reads go through the same closed-vocabulary gateway as ENGO Nexus
 * (`readSurface`), so the agent names a surface, a view and an operation and
 * never builds a URL. The one action is the dashboard's own "refresh data"
 * button, with the same two-minute cooldown.
 */
import { SURFACE_CONTRACTS } from "./agent-surface-contract";
import { AGENT_READABLE_SURFACES } from "./agent-insights-registry";
import { readSurface } from "./agent-surface-gateway.server";
import { McpToolError, str, type McpServerSpec, type McpTool } from "./mcp-core.server";

/** Calls the dashboard's own endpoints as a trusted service, in case read sign-in is enforced. */
const serviceFetch: typeof fetch = (input, init = {}) => {
  const headers = new Headers(init.headers);
  const secret = process.env.INTERNAL_API_SECRET?.trim();
  if (secret) headers.set("x-service-secret", secret);
  return fetch(input, { ...init, headers });
};

const originOf = (request: Request) => new URL(request.url).origin;

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
      surfaces: SURFACE_CONTRACTS.filter((contract) => readable.has(contract.id)).map((contract) => ({
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
      })),
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
      surface: { type: "string", description: "Surface id, e.g. overview, campaigns, accounting, leads." },
      operation: {
        type: "string",
        enum: ["summary", "list", "detail", "compare", "trend", "search"],
        description: "What to read. Defaults to summary.",
      },
      view: { type: "string", description: "Optional view id inside the surface." },
      filters: {
        type: "object",
        description: "Optional filters the surface declares, e.g. {\"from\":\"2026-11-01\",\"to\":\"2026-11-24\"}.",
        additionalProperties: { type: "string" },
      },
      lang: { type: "string", enum: ["ar", "en"], description: "Language of caveats. Defaults to ar." },
    },
    required: ["surface"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  run: async (args, { request }) => {
    const params = new URLSearchParams();
    const filters = args.filters;
    if (filters !== undefined && (typeof filters !== "object" || filters === null || Array.isArray(filters))) {
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
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
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
  version: "1.0.0",
  instructions:
    "Engosoft Insights Hub: marketing & sales figures for Engosoft (Egypt, KSA, UAE). Start with insights_list_surfaces, then insights_read. Revenue is collected cash from Odoo by payment date. Report each figure with its period and any caveat the result carries. Answer in the owner's language; the data labels are Arabic-first.",
  tools: [listSurfaces, read, refresh],
};
