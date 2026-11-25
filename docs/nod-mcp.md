# MCP endpoint for Nod

`POST /api/mcp` is a stateless MCP server (Streamable HTTP, JSON responses) for outside agents such as Nod.

## Tools

| Tool | Kind | What it does |
| --- | --- | --- |
| `insights_list_surfaces` | read | Lists readable dashboard surfaces with their views, operations and filters. |
| `insights_read` | read | Reads one surface through the same closed-vocabulary gateway as ENGO Nexus (`readSurface`). |
| `insights_refresh_data` | action | Same as the Refresh button (`POST /api/refresh`), with its two-minute cooldown. |

The agent never builds a URL; it names a surface, view and operation from the contract in `src/lib/agent-surface-contract.ts`.

## Enable it

1. Generate a token: `openssl rand -base64 32`.
2. Set `NOD_MCP_TOKEN` on the Railway service and redeploy. Without it the endpoint answers 503.
3. In Nod: **Apps → Connect MCP**, name `Engosoft Insights Hub`, URL `https://engosoft-insights-hub-production.up.railway.app/api/mcp`, choose an access token and paste the same value.

Every request must carry `Authorization: Bearer <NOD_MCP_TOKEN>`. Rotate it by changing the variable and reconnecting in Nod.

Internal reads send `INTERNAL_API_SECRET` as `x-service-secret` when it is set, so the tools keep working if read sign-in is enforced on `/api/*`.
