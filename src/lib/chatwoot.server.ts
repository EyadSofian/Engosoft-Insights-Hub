export interface ChatwootAgentMetric {
  id: number;
  name: string;
  conversations: number;
  resolved: number;
  unreadConversations: number;
  unreadMessages: number;
  awaitingReply: number;
  averageFirstResponseSeconds: number | null;
  averageResolutionSeconds: number | null;
  averageReplySeconds: number | null;
}

export interface ChatwootSnapshot {
  ok: true;
  source: string;
  fetchedAt: string;
  agents: ChatwootAgentMetric[];
  unassignedConversations: number;
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

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function unix(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function conversationActivity(from: string, to: string) {
  const cfg = config();
  const since = unixStart(from);
  const until = unixEndInclusive(to);
  const byAgent = new Map<number, {
    unreadConversations: number;
    unreadMessages: number;
    awaitingReply: number;
  }>();
  let unassignedConversations = 0;
  let expected = Number.POSITIVE_INFINITY;
  let seen = 0;

  for (let page = 1; page <= 100 && seen < expected; page += 1) {
    const params = new URLSearchParams({ status: "all", assignee_type: "all", page: String(page) });
    const raw = object(await request(
      `/api/v1/accounts/${encodeURIComponent(cfg.accountId)}/conversations?${params}`,
    ));
    const data = object(raw?.data);
    const meta = object(data?.meta);
    const payload = Array.isArray(data?.payload) ? data.payload : [];
    if (Number.isFinite(Number(meta?.all_count))) expected = Number(meta?.all_count);
    if (!payload.length) break;
    seen += payload.length;

    for (const value of payload) {
      const row = object(value);
      if (!row) continue;
      const lastActivity = unix(row.last_activity_at || row.timestamp || row.updated_at);
      if (lastActivity < since || lastActivity > until) continue;
      const conversationMeta = object(row.meta);
      const assignee = object(conversationMeta?.assignee);
      const assigneeId = Number(assignee?.id);
      if (!Number.isFinite(assigneeId)) {
        unassignedConversations += 1;
        continue;
      }
      const current = byAgent.get(assigneeId) ?? {
        unreadConversations: 0,
        unreadMessages: 0,
        awaitingReply: 0,
      };
      const unread = Math.max(0, unix(row.unread_count));
      if (unread > 0) current.unreadConversations += 1;
      current.unreadMessages += unread;
      const lastMessage = object(row.last_non_activity_message);
      if (
        lastMessage &&
        lastMessage.private !== true &&
        (Number(lastMessage.message_type) === 0 || lastMessage.sender_type === "Contact")
      ) {
        current.awaitingReply += 1;
      }
      byAgent.set(assigneeId, current);
    }
  }
  return { byAgent, unassignedConversations };
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
  const [rawMetrics, rawAgents, activity] = await Promise.all([
    request(`/api/v2/accounts/${encodeURIComponent(cfg.accountId)}/summary_reports/agent?${params}`),
    request(`/api/v1/accounts/${encodeURIComponent(cfg.accountId)}/agents`),
    conversationActivity(from, to),
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
  const metricsById = new Map<number, Record<string, unknown>>();
  for (const value of metrics) {
    const row = object(value);
    const id = Number(row?.id);
    if (row && Number.isFinite(id)) metricsById.set(id, row);
  }
  const relevantIds = new Set([...metricsById.keys(), ...activity.byAgent.keys()]);
  const result: ChatwootSnapshot = {
    ok: true,
    source: "Chatwoot · Agent reports + conversation inbox",
    fetchedAt: new Date().toISOString(),
    unassignedConversations: activity.unassignedConversations,
    agents: [...relevantIds].flatMap((id) => {
      const row = metricsById.get(id) ?? {};
      const name = names.get(id);
      if (!Number.isFinite(id) || !name) return [];
      const inbox = activity.byAgent.get(id) ?? {
        unreadConversations: 0,
        unreadMessages: 0,
        awaitingReply: 0,
      };
      return [{
        id,
        name,
        conversations: Number(row.conversations_count || 0),
        resolved: Number(row.resolved_conversations_count || 0),
        unreadConversations: inbox.unreadConversations,
        unreadMessages: inbox.unreadMessages,
        awaitingReply: inbox.awaitingReply,
        averageFirstResponseSeconds: numberOrNull(row.avg_first_response_time),
        averageResolutionSeconds: numberOrNull(row.avg_resolution_time),
        averageReplySeconds: numberOrNull(row.avg_reply_time),
      }];
    }),
  };
  cache.set(key, { expiresAt: Date.now() + TTL_MS, value: result });
  return result;
}
