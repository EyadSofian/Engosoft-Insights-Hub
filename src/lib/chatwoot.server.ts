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

export interface ChatwootPhoneConversationEvidence {
  phoneKey: string;
  contactId: number;
  contactName: string;
  conversationId: number;
  status: string;
  assigneeId: number | null;
  assigneeName: string;
  /** Human senders observed on outbound messages; stronger than current assignee. */
  agentNames?: string[];
  lastActivityAt: number;
  /** First proven employee reply, or the latest outbound message when the employee initiated. */
  agentContactedAt: number;
  /** Latest customer message, used to keep unanswered chats in the action queue. */
  customerMessagedAt: number;
  awaitingReply: boolean;
  url: string;
}

export interface ChatwootPhoneEvidenceBatch {
  evidence: Map<string, ChatwootPhoneConversationEvidence[]>;
  /** Every requested number has authoritative cached or freshly fetched data. */
  complete: boolean;
  missing: number;
  refreshed: number;
  error: string | null;
}

const TTL_MS = 60_000;
const cache = new Map<string, { expiresAt: number; value: ChatwootSnapshot }>();
const evidenceCache = new Map<
  string,
  { expiresAt: number; value: ChatwootAgentConversationEvidence }
>();
const PHONE_EVIDENCE_TTL_MS = 10 * 60_000;
const STORED_PHONE_EVIDENCE_TTL_MS = 24 * 60 * 60_000;
const FALLBACK_REMOTE_PHONE_BUDGET = 12;
const phoneEvidenceCache = new Map<
  string,
  { expiresAt: number; value: ChatwootPhoneConversationEvidence[] }
>();
const phoneEvidenceInFlight = new Map<string, Promise<ChatwootPhoneConversationEvidence[]>>();
let storedPhoneEvidencePromise:
  | Promise<Map<string, { refreshedAt: number; value: ChatwootPhoneConversationEvidence[] }>>
  | null = null;
let storedPhoneEvidenceExpiresAt = 0;
let requestNotBefore = 0;

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

async function request(path: string, init?: RequestInit, attempt = 0): Promise<unknown> {
  const cfg = config();
  if (!chatwootConfigured()) throw new Error("Chatwoot is not configured");
  const minInterval = Math.max(
    0,
    Math.min(10_000, Number(process.env.CHATWOOT_REQUEST_MIN_INTERVAL_MS) || 0),
  );
  if (minInterval > 0) {
    const waitMs = Math.max(0, requestNotBefore - Date.now());
    requestNotBefore = Math.max(Date.now(), requestNotBefore) + minInterval;
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
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
  if (response.status === 429 && attempt < 3) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(15_000, retryAfter * 1_000)
      : Math.min(12_000, 1_500 * 2 ** attempt);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return request(path, init, attempt + 1);
  }
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

function isClosedChatStatus(value: unknown): boolean {
  return ["resolved", "closed"].includes(String(value || "").trim().toLowerCase());
}

function isAwaitingReply(row: Record<string, unknown>): boolean {
  if (isClosedChatStatus(row.status)) return false;
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

const arabicDigits = "٠١٢٣٤٥٦٧٨٩";

export function chatwootPhoneKey(value: string): string {
  const digits = String(value || "")
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : "";
}

function parseStoredPhoneEvidence(value: string): ChatwootPhoneConversationEvidence[] {
  try {
    const parsed: unknown = JSON.parse(value || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row): row is ChatwootPhoneConversationEvidence => {
        const item = object(row);
        return Boolean(
          item &&
          chatwootPhoneKey(String(item.phoneKey || "")) &&
          Number.isInteger(Number(item.conversationId)) &&
          Number(item.conversationId) > 0 &&
          typeof item.url === "string",
        );
      })
      .map((row) => ({
        ...row,
        awaitingReply: isClosedChatStatus(row.status) ? false : row.awaitingReply,
      }));
  } catch {
    return [];
  }
}

async function readStoredPhoneEvidence() {
  if (!databaseConfigured()) {
    return new Map<
      string,
      { refreshedAt: number; value: ChatwootPhoneConversationEvidence[] }
    >();
  }
  if (storedPhoneEvidencePromise && storedPhoneEvidenceExpiresAt > Date.now()) {
    return storedPhoneEvidencePromise;
  }
  storedPhoneEvidenceExpiresAt = Date.now() + 60_000;
  storedPhoneEvidencePromise = readDashboardDataset("chatwoot_phone_evidence")
    .then((snapshot) => {
      const rows = new Map<
        string,
        { refreshedAt: number; value: ChatwootPhoneConversationEvidence[] }
      >();
      for (const row of snapshot.rows) {
        const key = chatwootPhoneKey(row.phoneKey || "");
        if (!key) continue;
        const refreshedAt = Date.parse(row.refreshedAt || "");
        rows.set(key, {
          refreshedAt: Number.isFinite(refreshedAt) ? refreshedAt : 0,
          value: parseStoredPhoneEvidence(row.evidence || "[]"),
        });
      }
      return rows;
    })
    .catch((error) => {
      storedPhoneEvidencePromise = null;
      storedPhoneEvidenceExpiresAt = 0;
      throw error;
    });
  return storedPhoneEvidencePromise;
}

async function persistPhoneEvidence(
  values: Map<string, ChatwootPhoneConversationEvidence[]>,
): Promise<void> {
  if (!databaseConfigured() || !values.size) return;
  const refreshedAt = new Date().toISOString();
  await writeDashboardDataset(
    "chatwoot_phone_evidence",
    [...values].map(([phoneKey, evidence]) => ({
      phoneKey,
      evidence: JSON.stringify(evidence),
      refreshedAt,
    })),
    { mode: "upsert", syncedAt: refreshedAt, metadata: { source: "chatwoot-phone-sync" } },
  );
  storedPhoneEvidencePromise = null;
  storedPhoneEvidenceExpiresAt = 0;
}

function phoneConversation(
  phoneKey: string,
  contact: Record<string, unknown>,
  row: Record<string, unknown>,
): ChatwootPhoneConversationEvidence | null {
  const conversationId = Number(row.id);
  const contactId = Number(contact.id);
  if (!Number.isInteger(conversationId) || conversationId <= 0) return null;
  if (!Number.isInteger(contactId) || contactId <= 0) return null;
  const cfg = config();
  const meta = object(row.meta);
  const assignee = object(meta?.assignee);
  const lastMessage = object(row.last_non_activity_message);
  const lastMessageAt = unix(lastMessage?.created_at);
  const messageType = Number(lastMessage?.message_type);
  const senderType = String(lastMessage?.sender_type || "");
  const outbound = messageType === 1 || senderType === "User";
  const inbound = messageType === 0 || senderType === "Contact";
  const firstReplyAt = unix(row.first_reply_created_at);
  const lastSender = object(lastMessage?.sender);
  const lastAgentName = outbound
    ? String(lastSender?.available_name || lastSender?.name || "").trim()
    : "";
  const assigneeName = String(assignee?.available_name || assignee?.name || "").trim();
  const status = String(row.status || "").trim();
  return {
    phoneKey,
    contactId,
    contactName: String(contact.name || contact.available_name || "").trim(),
    conversationId,
    status,
    assigneeId: numberOrNull(assignee?.id),
    assigneeName,
    agentNames: [...new Set([lastAgentName, firstReplyAt ? assigneeName : ""].filter(Boolean))],
    lastActivityAt: unix(row.last_activity_at || row.timestamp || row.updated_at),
    agentContactedAt: Math.max(firstReplyAt, outbound ? lastMessageAt : 0),
    customerMessagedAt: inbound ? lastMessageAt : 0,
    awaitingReply: !isClosedChatStatus(status) && inbound && lastMessage?.private !== true,
    url: `${cfg.baseUrl}/app/accounts/${encodeURIComponent(cfg.accountId)}/conversations/${conversationId}`,
  };
}

async function loadPhoneEvidence(phoneKey: string): Promise<ChatwootPhoneConversationEvidence[]> {
  const cached = phoneEvidenceCache.get(phoneKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const running = phoneEvidenceInFlight.get(phoneKey);
  if (running) return running;

  const promise = (async () => {
    const cfg = config();
    const raw = object(
      await request(
        `/api/v1/accounts/${encodeURIComponent(cfg.accountId)}/contacts/search?q=${encodeURIComponent(phoneKey)}`,
      ),
    );
    const contacts = (Array.isArray(raw?.payload) ? raw.payload : [])
      .map(object)
      .filter((row): row is Record<string, unknown> => Boolean(row))
      .filter((row) => chatwootPhoneKey(String(row.phone_number || "")) === phoneKey);
    const conversations = await Promise.all(
      contacts.map(async (contact) => {
        const result = object(
          await request(
            `/api/v1/accounts/${encodeURIComponent(cfg.accountId)}/contacts/${encodeURIComponent(String(contact.id))}/conversations`,
          ),
        );
        return (Array.isArray(result?.payload) ? result.payload : [])
          .map(object)
          .filter((row): row is Record<string, unknown> => Boolean(row))
          .map((row) => phoneConversation(phoneKey, contact, row))
          .filter((row): row is ChatwootPhoneConversationEvidence => Boolean(row));
      }),
    );
    const value = conversations.flat().sort((left, right) => right.lastActivityAt - left.lastActivityAt);
    phoneEvidenceCache.set(phoneKey, { expiresAt: Date.now() + PHONE_EVIDENCE_TTL_MS, value });
    return value;
  })().finally(() => phoneEvidenceInFlight.delete(phoneKey));
  phoneEvidenceInFlight.set(phoneKey, promise);
  return promise;
}

/**
 * Matches a bounded set of Odoo lead phones against Chatwoot.
 *
 * The account contact search is the only documented API that matches phone
 * numbers directly. Requests are concurrency-limited and cached per number so
 * opening the evidence drawer again never re-scans the account history.
 */
export async function getChatwootPhoneConversationEvidence(
  phones: string[],
  options: {
    /** Maximum cold numbers allowed to hit Chatwoot during this request. */
    maxRemote?: number;
    remoteConcurrency?: number;
  } = {},
): Promise<ChatwootPhoneEvidenceBatch> {
  if (!chatwootConfigured()) throw new Error("Chatwoot is not configured");
  const keys = [...new Set(phones.map(chatwootPhoneKey).filter(Boolean))];
  const result = new Map<string, ChatwootPhoneConversationEvidence[]>();
  if (!keys.length) {
    return { evidence: result, complete: true, missing: 0, refreshed: 0, error: null };
  }

  let storageError: string | null = null;
  const stored = await readStoredPhoneEvidence().catch((error) => {
    storageError = error instanceof Error ? error.message : "Chatwoot cache is unavailable";
    return new Map<
      string,
      { refreshedAt: number; value: ChatwootPhoneConversationEvidence[] }
    >();
  });
  const staleBefore = Date.now() - STORED_PHONE_EVIDENCE_TTL_MS;
  const remoteCandidates: string[] = [];
  for (const key of keys) {
    const cached = phoneEvidenceCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      result.set(key, cached.value);
      continue;
    }
    const saved = stored.get(key);
    if (saved) {
      result.set(key, saved.value);
      if (saved.refreshedAt < staleBefore) {
        phoneEvidenceCache.delete(key);
        remoteCandidates.push(key);
      } else {
        phoneEvidenceCache.set(key, {
          expiresAt: Date.now() + PHONE_EVIDENCE_TTL_MS,
          value: saved.value,
        });
      }
    } else {
      remoteCandidates.push(key);
    }
  }

  const configuredBudget = Number(process.env.CHATWOOT_PHONE_REMOTE_BUDGET);
  const defaultBudget = databaseConfigured()
    ? Number.isFinite(configuredBudget)
      ? Math.max(0, Math.trunc(configuredBudget))
      : FALLBACK_REMOTE_PHONE_BUDGET
    : keys.length;
  const remoteBudget = Math.max(
    0,
    Math.min(keys.length, Math.trunc(options.maxRemote ?? defaultBudget)),
  );
  const selected = remoteCandidates.slice(0, remoteBudget);
  const refreshed = new Map<string, ChatwootPhoneConversationEvidence[]>();
  let cursor = 0;
  let remoteError: string | null = null;
  const worker = async () => {
    while (cursor < selected.length) {
      const key = selected[cursor++];
      try {
        const value = await loadPhoneEvidence(key);
        result.set(key, value);
        refreshed.set(key, value);
      } catch (error) {
        remoteError ||= error instanceof Error ? error.message : "Chatwoot request failed";
      }
    }
  };
  const requestedConcurrency = Math.max(1, Math.trunc(options.remoteConcurrency ?? 2));
  await Promise.all(
    Array.from({ length: Math.min(requestedConcurrency, selected.length) }, worker),
  );
  if (refreshed.size) {
    await persistPhoneEvidence(refreshed).catch((error) => {
      storageError ||= error instanceof Error ? error.message : "Chatwoot cache write failed";
    });
  }
  const missing = keys.filter((key) => !result.has(key)).length;
  return {
    evidence: result,
    complete: missing === 0,
    missing,
    refreshed: refreshed.size,
    error: remoteError || storageError,
  };
}

function webhookUnix(value: unknown): number {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1_000) : 0;
}

/**
 * Persist one Chatwoot event without calling Chatwoot again. This is the live
 * path: the bounded REST lookup above exists only to backfill numbers that
 * pre-date the webhook.
 */
export async function ingestChatwootPhoneWebhook(payload: unknown): Promise<{
  accepted: boolean;
  phoneKey: string;
  conversationId: number | null;
}> {
  const root = object(payload);
  if (!root) return { accepted: false, phoneKey: "", conversationId: null };
  const event = String(root.event || "");
  const rootConversation = object(root.conversation);
  const conversation = rootConversation || root;
  const meta = object(conversation.meta);
  const metaSender = object(meta?.sender);
  const contact = object(root.contact) || metaSender || object(root.sender);
  const contactInbox = object(conversation.contact_inbox);
  const phoneKey = chatwootPhoneKey(
    String(
      contact?.phone_number ||
        metaSender?.phone_number ||
        contactInbox?.source_id ||
        "",
    ),
  );
  const conversationId = Number(conversation.id || conversation.display_id);
  if (!phoneKey || !Number.isInteger(conversationId) || conversationId <= 0) {
    return {
      accepted: false,
      phoneKey,
      conversationId: Number.isInteger(conversationId) ? conversationId : null,
    };
  }

  const saved = await readStoredPhoneEvidence().catch(
    () =>
      new Map<
        string,
        { refreshedAt: number; value: ChatwootPhoneConversationEvidence[] }
      >(),
  );
  const existingRows = saved.get(phoneKey)?.value ?? phoneEvidenceCache.get(phoneKey)?.value ?? [];
  const previous = existingRows.find((row) => row.conversationId === conversationId);
  const assignee = object(meta?.assignee);
  const messages = Array.isArray(conversation.messages)
    ? conversation.messages.map(object).filter(Boolean)
    : [];
  const eventMessage = event.startsWith("message_") ? root : messages.at(-1) || null;
  const messageType = String(eventMessage?.message_type ?? "").toLowerCase();
  const senderType = String(eventMessage?.sender_type || object(eventMessage?.sender)?.type || "")
    .toLowerCase();
  const incoming = messageType === "0" || messageType === "incoming" || senderType === "contact";
  const outgoing =
    messageType === "1" ||
    messageType === "outgoing" ||
    messageType === "3" ||
    messageType === "template" ||
    senderType === "user";
  const messageAt = webhookUnix(eventMessage?.created_at);
  const privateMessage = eventMessage?.private === true;
  const eventSender = object(eventMessage?.sender);
  const eventAgentName = outgoing
    ? String(eventSender?.available_name || eventSender?.name || "").trim()
    : "";
  const activityAt = Math.max(
    webhookUnix(conversation.last_activity_at || conversation.timestamp || root.created_at),
    messageAt,
    previous?.lastActivityAt ?? 0,
  );
  const cfg = config();
  const status = String(conversation.status || previous?.status || "").trim();
  const next: ChatwootPhoneConversationEvidence = {
    phoneKey,
    contactId: Number(contact?.id || previous?.contactId || 0),
    contactName: String(contact?.name || contact?.available_name || previous?.contactName || "").trim(),
    conversationId,
    status,
    assigneeId: numberOrNull(assignee?.id) ?? previous?.assigneeId ?? null,
    assigneeName: String(
      assignee?.available_name || assignee?.name || previous?.assigneeName || "",
    ).trim(),
    agentNames: [
      ...new Set([...(previous?.agentNames ?? []), eventAgentName].filter(Boolean)),
    ],
    lastActivityAt: activityAt,
    agentContactedAt: Math.max(
      previous?.agentContactedAt ?? 0,
      outgoing && !privateMessage ? messageAt : 0,
    ),
    customerMessagedAt: Math.max(
      previous?.customerMessagedAt ?? 0,
      incoming && !privateMessage ? messageAt : 0,
    ),
    awaitingReply: isClosedChatStatus(status)
      ? false
      : privateMessage || (!incoming && !outgoing)
        ? previous?.awaitingReply ?? false
        : incoming,
    url: `${cfg.baseUrl}/app/accounts/${encodeURIComponent(cfg.accountId)}/conversations/${conversationId}`,
  };
  const rows = [next, ...existingRows.filter((row) => row.conversationId !== conversationId)].sort(
    (left, right) => right.lastActivityAt - left.lastActivityAt,
  );
  const update = new Map([[phoneKey, rows]]);
  await persistPhoneEvidence(update);
  phoneEvidenceCache.set(phoneKey, {
    expiresAt: Date.now() + PHONE_EVIDENCE_TTL_MS,
    value: rows,
  });
  return { accepted: true, phoneKey, conversationId };
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
import {
  databaseConfigured,
  readDashboardDataset,
  writeDashboardDataset,
} from "./dashboard-db.server.ts";
