import { createFileRoute } from "@tanstack/react-router";

/**
 * MCP endpoint for outside agents such as Nod. Off until NOD_MCP_TOKEN is set;
 * every request needs `Authorization: Bearer <NOD_MCP_TOKEN>`.
 */
const handle = async ({ request }: { request: Request }) => {
  const { handleMcpHttp } = await import("@/lib/mcp-core.server");
  const { INSIGHTS_MCP } = await import("@/lib/nod-mcp-tools.server");
  return handleMcpHttp(request, INSIGHTS_MCP);
};

export const Route = createFileRoute("/api/mcp")({
  server: { handlers: { POST: handle, GET: handle, DELETE: handle } },
});
