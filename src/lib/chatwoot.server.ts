export interface ChatwootAgentMetric {
  id: number;
  name: string;
  conversations: number;
  resolved: number;
  /** Current open workload. This comes from Chatwoot's live agent report. */
  openConversations: number;
  /** Not available from the bounded reports API; never inferred from `open`. */
  unreadConversations: number | null;
  /** Not available from the bounded reports API; loaded only with evidence. */
  unreadMessages: number | null;
  /** Current conversations where the contact is waiting for an agent reply. */
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
  openConversations: number;
  awaitingReply: number;
  unassignedConversations: number;
}

export interface ChatwootConversationEvidence {
  id: number;
  contactName: string;
  status: string;
  unreadMessages: number;
  awaitingReply: boolean;
  lastActivityAt: number;
  url: string;
}

export interface ChatwootAgentConversationEvidence {
  agentId: number;
  total: number;
  conversations: ChatwootConversationEvidence[];
}

const TTL_MS = 60_000;
const cache = new Map<string, { expiresAt: number; value: ChatwootSnapshot }>();
const evidenceCache = new Map<
  string,
  { expiresAt: number; value: ChatwootAgentConversationEvidence }
>();

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

const count = (value: unknown): number => Math.max(0, numberOrNull(value) ?? 0);

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const cfg = config();
  if (!chatwootConfigured()) throw new Error("Chatwoot is not configured");
  const response = await fetch(`${cfg.baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      api_access_token: cfg.token,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(10_000),
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

function isAwaitingReply(row: Record<string, unknown>): boolean {
  const lastMessage = object(row.last_non_activity_message);
  return Boolean(
    lastMessage &&
    lastMessage.private !== true &&
    (Number(lastMessage.message_type) === 0 || lastMessage.sender_type === "Contact"),
  );
}

function toEvidence(row: Record<string, unknown>): ChatwootConversationEvidence | null {
  const id = Number(row.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const cfg = config();
  const meta = object(row.meta);
  const sender = object(meta?.sender);
  return {
    id,
    contactName: String(sender?.name || sender?.available_name || "").trim(),
    status: String(row.status || "").trim(),
    unreadMessages: count(row.unread_count),
    awaitingReply: isAwaitingReply(row),
    lastActivityAt: unix(row.last_activity_at || row.timestamp || row.updated_at),
    url: `${cfg.baseUrl}/app/accounts/${encodeURIComponent(cfg.accountId)}/conversations/${id}`,
  };
}

function isoStart(date: string) {
  return `${date}T00:00:00.000Z`;
}

function isoEndExclusive(date: string) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString();
}

function unixStart(date: string) {
  return Math.floor(Date.parse(isoStart(date)) / 1000);
}

function unixEndInclusive(date: string) {
  return Math.floor(Date.parse(`${date}T23:59:59Z`) / 1000);
}

/**
 * Loads only one employee's conversations for the selected range.
 *
 * The dashboard aggregate deliberately never calls the paginated conversation
 * list. Chatwoot filters the evidence server-side, and this function reads only
 * enough 25-row pages to satisfy the visible drawer limit.
 */
export async function getChatwootAgentConversationEvidence(input: {
  agentId: number;
  from: string;
  to: string;
  limit?: number;
}): Promise<ChatwootAgentConversationEvidence> {
  if (!Number.isInteger(input.agentId) || input.agentId <= 0) {
    throw new Error("A valid Chatwoot agent id is required");
  }
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 40)));
  const cacheKey = `${input.agentId}:${input.from}:${input.to}:${limit}`;
  const cached = evidenceCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const cfg = config();
  const filters = [
    {
      attribute_key: "assignee_id",
      filter_operator: "equal_to",
      values: [input.agentId],
      query_operator: "AND",
    },
    {
      attribute_key: "last_activity_at",
      filter_operator: "is_greater_than",
      values: [isoStart(input.from)],
      query_operator: "AND",
    },
    {
      attribute_key: "last_activity_at",
      filter_operator: "is_less_than",
      values: [isoEndExclusive(input.to)],
      query_operator: null,
    },
  ];
  const conversations: ChatwootConversationEvidence[] = [];
  let total = 0;
  const pages = Math.ceil(limit / 25);

  for (let page = 1; page <= pages && conversations.length < limit; page += 1) {
    const raw = object(
      await request(
        `/api/v1/accounts/${encodeURIComponent(cfg.accountId)}/conversations/filter?page=${page}`,
        { method: "POST", body: JSON.stringify({ payload: filters }) },
      ),
    );
    const payload = Array.isArray(raw?.payload) ? raw.payload : [];
    const meta = object(raw?.meta);
    total = count(meta?.all_count);
    if (!payload.length) break;
    for (const value of payload) {
      const row = object(value);
      const evidence = row ? toEvidence(row) : null;
      if (evidence) conversations.push(evidence);
      if (conversations.length >= limit) break;
    }
  }

  conversations.sort((left, right) => right.lastActivityAt - left.lastActivityAt);
  const result = { agentId: input.agentId, total, conversations };
  evidenceCache.set(cacheKey, { expiresAt: Date.now() + TTL_MS, value: result });
  return result;
}

/**
 * Fast dashboard path: four bounded Chatwoot report calls, independent of the
 * account's conversation count. Historical totals use the selected period;
 * open/unattended/unassigned are explicitly live workload metrics.
 */
export async function getChatwootAgentSnapshot(
  from: string,
  to: string,
): Promise<ChatwootSnapshot> {
  const key = `${from}:${to}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const cfg = config();
  const params = new URLSearchParams({
    since: String(unixStart(from)),
    until: String(unixEndInclusive(to)),
  });
  const [rawMetrics, rawAgents, rawAgentWorkload, rawAccountWorkload] = await Promise.all([
    request(
      `/api/v2/accounts/${encodeURIComponent(cfg.accountId)}/summary_reports/agent?${params}`,
    ),
    request(`/api/v1/accounts/${encodeURIComponent(cfg.accountId)}/agents`),
    request(
      `/api/v2/accounts/${encodeURIComponent(cfg.accountId)}/reports/conversations?type=agent`,
    ),
    request(
      `/api/v2/accounts/${encodeURIComponent(cfg.accountId)}/reports/conversations?type=account`,
    ),
  ]);

  const names = new Map<number, string>();
  for (const value of Array.isArray(rawAgents) ? rawAgents : []) {
    const row = object(value);
    const id = Number(row?.id);
    const name = String(row?.available_name || row?.name || "").trim();
    if (Number.isFinite(id) && name) names.set(id, name);
  }

  const metricsById = new Map<number, Record<string, unknown>>();
  for (const value of Array.isArray(rawMetrics) ? rawMetrics : []) {
    const row = object(value);
    const id = Number(row?.id);
    if (row && Number.isFinite(id)) metricsById.set(id, row);
  }

  const workloadById = new Map<number, Record<string, unknown>>();
  for (const value of Array.isArray(rawAgentWorkload) ? rawAgentWorkload : []) {
    const row = object(value);
    const id = Number(row?.id);
    const metric = object(row?.metric);
    if (row && metric && Number.isFinite(id)) {
      workloadById.set(id, metric);
      if (!names.has(id)) {
        const name = String(row.name || "").trim();
        if (name) names.set(id, name);
      }
    }
  }

  const relevantIds = new Set([...metricsById.keys(), ...workloadById.keys()]);
  const accountWorkload = object(rawAccountWorkload) ?? {};
  const result: ChatwootSnapshot = {
    ok: true,
    source: "Chatwoot · period reports + live workload",
    fetchedAt: new Date().toISOString(),
    openConversations: count(accountWorkload.open),
    awaitingReply: count(accountWorkload.unattended),
    unassignedConversations: count(accountWorkload.unassigned),
    agents: [...relevantIds].flatMap((id) => {
      const row = metricsById.get(id) ?? {};
      const workload = workloadById.get(id) ?? {};
      const name = names.get(id);
      if (!Number.isFinite(id) || !name) return [];
      return [
        {
          id,
          name,
          conversations: count(row.conversations_count),
          resolved: count(row.resolved_conversations_count),
          openConversations: count(workload.open),
          unreadConversations: null,
          unreadMessages: null,
          awaitingReply: count(workload.unattended),
          averageFirstResponseSeconds: numberOrNull(row.avg_first_response_time),
          averageResolutionSeconds: numberOrNull(row.avg_resolution_time),
          averageReplySeconds: numberOrNull(row.avg_reply_time),
        },
      ];
    }),
  };
  cache.set(key, { expiresAt: Date.now() + TTL_MS, value: result });
  return result;
}
