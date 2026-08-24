export interface ChatwootAgentMetric {
  id: number;
  name: string;
  conversations: number;
  resolved: number;
  averageFirstResponseSeconds: number | null;
  averageResolutionSeconds: number | null;
  averageReplySeconds: number | null;
}

export interface ChatwootSnapshot {
  ok: true;
  source: string;
  fetchedAt: string;
  agents: ChatwootAgentMetric[];
}

const TTL_MS = 60_000;
const cache = new Map<string, { expiresAt: number; value: ChatwootSnapshot }>();

function config() {
  return {
    baseUrl: (process.env.CHATWOOT_BASE_URL || "").replace(/\/+$/, ""),
    accountId: (process.env.CHATWOOT_ACCOUNT_ID || process.env.ACCOUNT_ID || "").trim(),
    token: (process.env.CHATWOOT_API_TOKEN || "").trim(),
  };
}

export function chatwootConfigured() {
  const value = config();
  return Boolean(value.baseUrl && value.accountId && value.token);
}

const numberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

async function request(path: string): Promise<unknown> {
  const cfg = config();
  if (!chatwootConfigured()) throw new Error("Chatwoot is not configured");
  const response = await fetch(`${cfg.baseUrl}${path}`, {
    headers: { Accept: "application/json", api_access_token: cfg.token },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Chatwoot returned HTTP ${response.status}`);
  return response.json();
}

function unixStart(date: string) {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
}

function unixEndInclusive(date: string) {
  return Math.floor(Date.parse(`${date}T23:59:59Z`) / 1000);
}

export async function getChatwootAgentSnapshot(from: string, to: string): Promise<ChatwootSnapshot> {
  const key = `${from}:${to}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const cfg = config();
  const params = new URLSearchParams({
    since: String(unixStart(from)),
    until: String(unixEndInclusive(to)),
  });
  const [rawMetrics, rawAgents] = await Promise.all([
    request(`/api/v2/accounts/${encodeURIComponent(cfg.accountId)}/summary_reports/agent?${params}`),
    request(`/api/v1/accounts/${encodeURIComponent(cfg.accountId)}/agents`),
  ]);
  const agents = Array.isArray(rawAgents) ? rawAgents : [];
  const names = new Map<number, string>();
  for (const value of agents) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const id = Number(row.id);
    const name = String(row.available_name || row.name || "").trim();
    if (Number.isFinite(id) && name) names.set(id, name);
  }
  const metrics = Array.isArray(rawMetrics) ? rawMetrics : [];
  const result: ChatwootSnapshot = {
    ok: true,
    source: "Chatwoot · Agent reports",
    fetchedAt: new Date().toISOString(),
    agents: metrics.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const row = value as Record<string, unknown>;
      const id = Number(row.id);
      const name = names.get(id);
      if (!Number.isFinite(id) || !name) return [];
      return [{
        id,
        name,
        conversations: Number(row.conversations_count || 0),
        resolved: Number(row.resolved_conversations_count || 0),
        averageFirstResponseSeconds: numberOrNull(row.avg_first_response_time),
        averageResolutionSeconds: numberOrNull(row.avg_resolution_time),
        averageReplySeconds: numberOrNull(row.avg_reply_time),
      }];
    }),
  };
  cache.set(key, { expiresAt: Date.now() + TTL_MS, value: result });
  return result;
}
