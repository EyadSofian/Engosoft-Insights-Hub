/**
 * Historical attribution recovery is an operator task, not a dashboard code
 * path. It is deliberately date-bounded, checkpointed, rate-limited and
 * idempotent through chatwoot_event_inbox. Run it from the deployed service or
 * another process that can reach the Railway-internal DATABASE_URL.
 *
 * Example (first inspect, then apply):
 *   npm run backfill:chatwoot-attribution -- --from 2026-09-01 --to 2026-09-07
 *   npm run backfill:chatwoot-attribution -- --from 2026-09-01 --to 2026-09-07 --apply
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  normalizeChatwootAttribution,
  processChatwootAttributionEvent,
} from "../src/lib/chatwoot-attribution.server.ts";

const args = process.argv.slice(2);
const valueOf = (name, fallback = "") => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || fallback : fallback;
};
const enabled = (name) => args.includes(name);
const date = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
const from = valueOf("--from");
const to = valueOf("--to");
const apply = enabled("--apply");
const dateField = valueOf("--date-field", "created_at");
const maxConversations = Math.max(
  1,
  Math.min(2_000, Number(valueOf("--max-conversations", "250")) || 250),
);
const maxMessagePages = Math.max(1, Math.min(20, Number(valueOf("--max-message-pages", "4")) || 4));
const delayMs = Math.max(1_000, Number(valueOf("--delay-ms", "1250")) || 1250);
const stateFile = valueOf(
  "--state-file",
  process.env.CHATWOOT_ATTRIBUTION_BACKFILL_STATE_FILE ||
    ".data/chatwoot-attribution-backfill-state.json",
);

if (!date(from) || !date(to) || from > to) {
  throw new Error("Use valid inclusive --from YYYY-MM-DD and --to YYYY-MM-DD values.");
}
if (!["created_at", "last_activity_at"].includes(dateField)) {
  throw new Error("--date-field must be created_at or last_activity_at.");
}
if (
  !process.env.CHATWOOT_BASE_URL?.trim() ||
  !process.env.CHATWOOT_ACCOUNT_ID?.trim() ||
  !process.env.CHATWOOT_API_TOKEN?.trim()
) {
  throw new Error("CHATWOOT_BASE_URL, CHATWOOT_ACCOUNT_ID, and CHATWOOT_API_TOKEN are required.");
}
if (apply && !process.env.DATABASE_URL?.trim()) {
  throw new Error(
    "DATABASE_URL is required with --apply; run where Railway PostgreSQL is reachable.",
  );
}

const baseUrl = process.env.CHATWOOT_BASE_URL.replace(/\/+$/, "");
const accountId = process.env.CHATWOOT_ACCOUNT_ID.trim();
const inWindow = (value) => {
  const parsed = Number(value);
  const at =
    Number.isFinite(parsed) && parsed > 0
      ? new Date(parsed < 10_000_000_000 ? parsed * 1_000 : parsed)
      : new Date(String(value || ""));
  if (Number.isNaN(at.valueOf())) return true; // Let the projector retain a dated evidence record when source is incomplete.
  const day = at.toISOString().slice(0, 10);
  return day >= from && day <= to;
};

async function loadState() {
  try {
    const saved = JSON.parse(await readFile(stateFile, "utf8"));
    if (
      saved?.from === from &&
      saved?.to === to &&
      saved?.dateField === dateField &&
      Number.isInteger(saved.nextPage) &&
      saved.nextPage > 0
    )
      return saved;
  } catch {
    // First run or malformed local state: start from page one. The database dedupe key makes this safe.
  }
  return { from, to, dateField, nextPage: 1, processed: 0, projected: 0, skipped: 0 };
}

async function saveState(state) {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

let nextRequestAt = 0;
async function chatwoot(path, init = {}) {
  const wait = Math.max(0, nextRequestAt - Date.now());
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  nextRequestAt = Math.max(Date.now(), nextRequestAt) + delayMs;
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      api_access_token: process.env.CHATWOOT_API_TOKEN,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new Error(`Chatwoot returned HTTP ${response.status} for ${path.split("?")[0]}`);
  return response.json();
}

const arrayFrom = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.payload)) return payload.payload;
  if (Array.isArray(payload?.data?.payload)) return payload.data.payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

async function messagesFor(conversationId) {
  const collected = [];
  let before = "";
  for (let page = 0; page < maxMessagePages; page += 1) {
    const payload = await chatwoot(
      `/api/v1/accounts/${encodeURIComponent(accountId)}/conversations/${encodeURIComponent(String(conversationId))}/messages${before ? `?before=${encodeURIComponent(before)}` : ""}`,
    );
    const rows = arrayFrom(payload);
    if (!rows.length) break;
    collected.push(...rows);
    const lastId = rows.at(-1)?.id;
    if (!lastId || String(lastId) === before || rows.length < 20) break;
    before = String(lastId);
  }
  return collected;
}

const state = await loadState();
let failures = 0;
console.log(
  `${apply ? "Applying" : "Dry run"} attribution backfill from ${from} to ${to} by ${dateField}; starting page ${state.nextPage}.`,
);

while (state.processed < maxConversations) {
  const endExclusive = new Date(`${to}T00:00:00.000Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const filters = [
    {
      attribute_key: dateField,
      filter_operator: "is_greater_than",
      values: [`${from}T00:00:00.000Z`],
      query_operator: "AND",
    },
    {
      attribute_key: dateField,
      filter_operator: "is_less_than",
      values: [endExclusive.toISOString()],
      query_operator: null,
    },
  ];
  const pagePayload = await chatwoot(
    `/api/v1/accounts/${encodeURIComponent(accountId)}/conversations/filter?page=${state.nextPage}`,
    { method: "POST", body: JSON.stringify({ payload: filters }) },
  );
  const conversations = arrayFrom(pagePayload);
  if (!conversations.length) break;

  for (const conversation of conversations) {
    if (state.processed >= maxConversations) break;
    const conversationId = Number(conversation?.id);
    if (!Number.isInteger(conversationId) || conversationId <= 0) continue;
    if (!inWindow(conversation[dateField])) {
      state.skipped += 1;
      continue;
    }
    try {
      const messages = await messagesFor(conversationId);
      for (const message of messages) {
        const payload = {
          event: "message_created",
          message,
          conversation,
          inbox: conversation.inbox,
          contact: conversation.meta?.sender || conversation.contact,
        };
        const normalized = normalizeChatwootAttribution(payload);
        if (!normalized.inbound || !inWindow(normalized.occurredAt)) continue;
        if (apply) {
          const result = await processChatwootAttributionEvent({
            payload,
            rawBody: JSON.stringify(payload),
            deliveryId: `backfill:${conversationId}:${normalized.messageId || "unknown"}`,
          });
          if (result.projected) state.projected += 1;
        } else if (normalized.attributionMethod !== "unknown") {
          state.projected += 1;
        }
      }
      state.processed += 1;
    } catch (error) {
      failures += 1;
      console.error(
        `Conversation ${conversationId} failed:`,
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }

  if (failures) {
    await saveState(state);
    throw new Error(
      `${failures} conversation(s) failed; checkpoint retained at ${stateFile}. Rerun after resolving the cause.`,
    );
  }
  state.nextPage += 1;
  await saveState(state);
  if (conversations.length < 20) break;
}

console.log(
  JSON.stringify(
    {
      mode: apply ? "apply" : "dry-run",
      from,
      to,
      dateField,
      conversationsProcessed: state.processed,
      evidenceBackedInboundMessages: state.projected,
      skippedOutsideWindow: state.skipped,
      nextPage: state.nextPage,
      checkpoint: stateFile,
    },
    null,
    2,
  ),
);
