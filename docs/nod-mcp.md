# MCP endpoint for Nod

`POST /api/mcp` is a stateless MCP server (Streamable HTTP, JSON responses) for outside agents such as Nod.

## Tools

| Tool | Kind | What it does |
| --- | --- | --- |
| `insights_list_surfaces` | read | Lists readable dashboard surfaces with their views, operations and filters. |
| `insights_read` | read | Reads one surface through the same closed-vocabulary gateway as ENGO Nexus (`readSurface`). |
| `insights_list_endpoints` | read | Lists every GET endpoint behind every page and tab (`src/lib/nod-mcp-catalog.ts`). |
| `insights_get` | read | Returns the full JSON of one endpoint: every ad set, ad, creative, lead and row. Large answers come back as an outline, then are read with `path`, `offset` and `limit`. |
| `insights_refresh_data` | action | Same as the Refresh button (`POST /api/refresh`), with its two-minute cooldown. |

The agent never builds a URL; it names a surface, view and operation from the contract in `src/lib/agent-surface-contract.ts`.

## Enable it

1. Generate a token: `openssl rand -base64 32`.
2. Set `NOD_MCP_TOKEN` on the Railway service and redeploy. Without it the endpoint answers 503.
3. In Nod: **Apps → Connect MCP**, name `Engosoft Insights Hub`, URL `https://engosoft-insights-hub-production.up.railway.app/api/mcp`, choose an access token and paste the same value.

Every request must carry `Authorization: Bearer <NOD_MCP_TOKEN>`. Rotate it by changing the variable and reconnecting in Nod.

Internal reads send `INTERNAL_API_SECRET` as `x-service-secret` and `DASHBOARD_ADMIN_SECRET` as `x-admin-secret`, and sign a P&L and revenue gate cookie for the routes behind those locks, so the tools read exactly what a signed-in admin sees. None of these values leave the server. The owner opened the P&L to Nod on 2026-11-25.

`tests/unit/nod-mcp-catalog.test.ts` fails when a GET route is neither in the catalog nor in `NOD_EXCLUDED_ENDPOINTS` with a reason.

Qodo's `/api/mcp` forwards these tools too, so most agents should connect there once (see Qodo `docs/NOD_MCP.md`).
