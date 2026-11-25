/**
 * A minimal, stateless MCP server over Streamable HTTP (JSON responses only).
 *
 * WHY HAND-ROLLED. Nod (and any other MCP client) only needs `initialize`,
 * `tools/list` and `tools/call` from this app. Each request is answered on its
 * own, with no session and no SSE stream, so the whole protocol surface is a
 * few JSON-RPC methods; pulling in the SDK would add a dependency for that.
 *
 * AUTH. Every request must carry `Authorization: Bearer <token>` matching the
 * deployment's `NOD_MCP_TOKEN`. Without that variable the endpoint is off (503),
 * so deploying this code changes nothing until the token is set.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: McpToolAnnotations;
  run: (args: Record<string, unknown>, ctx: { request: Request }) => Promise<unknown>;
}

export interface McpServerSpec {
  name: string;
  version: string;
  instructions: string;
  tools: McpTool[];
  tokenEnv?: string;
}

const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

/** Thrown by a tool for a caller mistake; returned to the model as a tool error, not a crash. */
export class McpToolError extends Error {}

type JsonRpcId = string | number | null;
interface JsonRpcMessage {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
}

const digest = (value: string) => createHash("sha256").update(value).digest();

export function bearerMatches(request: Request, expected: string): boolean {
  const supplied = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!supplied || !expected) return false;
  return timingSafeEqual(digest(supplied), digest(expected));
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

const rpcError = (id: JsonRpcId, code: number, message: string) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

async function answer(spec: McpServerSpec, message: JsonRpcMessage, request: Request) {
  const id = message.id ?? null;
  const params = message.params ?? {};

  switch (message.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: spec.name, version: spec.version },
          instructions: spec.instructions,
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: spec.tools.map(({ name, title, description, inputSchema, annotations }) => ({
            name,
            title,
            description,
            inputSchema,
            annotations,
          })),
        },
      };
    case "tools/call": {
      const tool = spec.tools.find((candidate) => candidate.name === params.name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${String(params.name)}`);
      const args =
        params.arguments && typeof params.arguments === "object"
          ? (params.arguments as Record<string, unknown>)
          : {};
      try {
        const output = await tool.run(args, { request });
        const text = typeof output === "string" ? output : JSON.stringify(output, null, 1);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text }],
            ...(output && typeof output === "object" && !Array.isArray(output)
              ? { structuredContent: output }
              : {}),
            isError: false,
          },
        };
      } catch (error) {
        const known = error instanceof McpToolError;
        if (!known) console.error(`[mcp] ${tool.name} failed:`, error);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: known ? error.message : "The tool failed on the server. Try again or ask the owner to check the logs.",
              },
            ],
            isError: true,
          },
        };
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${String(message.method)}`);
  }
}

export async function handleMcpHttp(request: Request, spec: McpServerSpec): Promise<Response> {
  const token = process.env[spec.tokenEnv ?? "NOD_MCP_TOKEN"]?.trim() ?? "";
  if (!token) return json({ error: "MCP access is not enabled on this deployment." }, 503);
  if (!bearerMatches(request, token)) {
    return json({ error: "Unauthorized." }, 401, { "www-authenticate": 'Bearer realm="mcp"' });
  }

  // Stateless server: no SSE stream to resume and no session to end.
  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405, { allow: "POST" });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(rpcError(null, -32700, "Parse error"), 400);
  }

  const messages = (Array.isArray(body) ? body : [body]) as JsonRpcMessage[];
  const replies = [];
  for (const message of messages) {
    if (!message || typeof message !== "object" || message.jsonrpc !== "2.0") {
      replies.push(rpcError(null, -32600, "Invalid request"));
      continue;
    }
    // Notifications and client responses carry no id and get no reply.
    if (message.id === undefined || !message.method) continue;
    replies.push(await answer(spec, message, request));
  }

  if (replies.length === 0) return new Response(null, { status: 202 });
  return json(Array.isArray(body) ? replies : replies[0]);
}

/** Small helpers for tool argument checks. */
export const str = (args: Record<string, unknown>, key: string, required = false): string => {
  const value = args[key];
  if (value === undefined || value === null || value === "") {
    if (required) throw new McpToolError(`"${key}" is required.`);
    return "";
  }
  if (typeof value !== "string" && typeof value !== "number") {
    throw new McpToolError(`"${key}" must be a string.`);
  }
  return String(value).trim();
};
