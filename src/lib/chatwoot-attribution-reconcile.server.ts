import { createHash } from "node:crypto";
import { getPool } from "./acquisition-attribution.server";
import {
  WEBHOOK_DELIVERY_MISSED,
  classifyConversation,
  firstInboundMessage,
  replayPayload,
  type ReconcileState,
} from "./chatwoot-attribution-reconcile";
import {
  chatwootConfigured,
  listChatwootConversationMessages,
  listChatwootConversationsPage,
} from "./chatwoot.server";
import { databaseConfigured } from "./dashboard-db.server";

/**
 * Chatwoot conversations vs attribution rows, for a recent window.
 *
 * Reads Chatwoot's conversation list newest first (read-only API), checks each
 * conversation created in the window against chatwoot_conversation_attribution,
 * and for a conversation with an inbound message but no row rebuilds the row
 * from the API (DB only — nothing is written to Chatwoot). Every conversation's
 * state is stored, so the health query can tell "no row because nobody wrote
 * in" apart from "no row because a webhook was lost".
 */

type Row = Record<string, unknown>;
type Json = Record<string, unknown>;

export interface ChatwootReconcileSummary {
  status: "ok" | "partial" | "failed" | "not_configured" | "running";
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  windowDays: number;
  pages: number;
  conversations: number;
  states: Record<ReconcileState, number>;
  message: string;
}

let running: Promise<ChatwootReconcileSummary> | null = null;
let schemaReady: Promise<void> | null = null;

function ensureSchema() {
  schemaReady ??= getPool()
    .query(
      `CREATE TABLE IF NOT EXISTS chatwoot_attribution_reconciliation (
         conversation_id bigint PRIMARY KEY,
         inbox_id bigint,
         conversation_created_at timestamptz,
         state text NOT NULL,
         detail text NOT NULL DEFAULT '',
         checked_at timestamptz NOT NULL DEFAULT now()
       );
       CREATE TABLE IF NOT EXISTS chatwoot_attribution_reconcile_state (
         id integer PRIMARY KEY DEFAULT 1,
         status text NOT NULL DEFAULT 'never',
         summary jsonb NOT NULL DEFAULT '{}'::jsonb,
         updated_at timestamptz NOT NULL DEFAULT now()
       );`,
    )
    .then(() => undefined)
    .catch((error) => {
      schemaReady = null;
      throw error;
    });
  return schemaReady;
}

export function runChatwootAttributionReconcile(
  options: { days?: number; dryRun?: boolean; maxConversations?: number } = {},
) {
  running ??= reconcile(options).finally(() => {
    running = null;
  });
  return running;
}

export function chatwootReconcileRunning() {
  return running !== null;
}

async function saveState(summary: ChatwootReconcileSummary) {
  await getPool().query(
    `INSERT INTO chatwoot_attribution_reconcile_state (id, status, summary, updated_at)
     VALUES (1, $1, $2::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, summary = EXCLUDED.summary, updated_at = now()`,
    [summary.status, JSON.stringify(summary)],
  );
}

async function reconcile(options: {
  days?: number;
  dryRun?: boolean;
  maxConversations?: number;
}): Promise<ChatwootReconcileSummary> {
  const windowDays = Math.min(Math.max(Number(options.days) || 3, 1), 30);
  const dryRun = options.dryRun !== false;
  const maxConversations = Math.min(Math.max(Number(options.maxConversations) || 1_500, 1), 5_000);
  const summary: ChatwootReconcileSummary = {
    status: "running",
    dryRun,
    startedAt: new Date().toISOString(),
    finishedAt: "",
    windowDays,
    pages: 0,
    conversations: 0,
    states: { has_row: 0, no_inbound_message: 0, replayable: 0, replayed: 0, failed: 0 },
    message: "",
  };
  if (!databaseConfigured() || !chatwootConfigured()) {
    return {
      ...summary,
      status: "not_configured",
      message: "Database or Chatwoot is not configured.",
    };
  }
  await ensureSchema();
  await saveState(summary);
  const pool = getPool();
  const since = Date.now() / 1000 - windowDays * 86_400;
  const { processChatwootAttributionEvent } = await import("./chatwoot-attribution.server");

  try {
    let done = false;
    for (let page = 1; !done && page <= 250; page += 1) {
      const conversations = await withRetry(() => listChatwootConversationsPage(page));
      summary.pages = page;
      if (!conversations.length) break;
      const inWindow = conversations.filter((row) => Number(row.created_at ?? 0) >= since);
      if (inWindow.length < conversations.length) done = true;
      const ids = inWindow
        .map((row) => Number(row.id))
        .filter((id) => Number.isInteger(id) && id > 0);
      const existing = new Set(
        (
          await pool.query<Row>(
            `SELECT conversation_id::text AS id FROM chatwoot_conversation_attribution WHERE conversation_id = ANY($1::bigint[])`,
            [ids],
          )
        ).rows.map((row) => String(row.id)),
      );
      // A conversation already seen without an inbound message, and quiet since,
      // is not fetched again.
      const previous = new Map(
        (
          await pool.query<Row>(
            `SELECT conversation_id::text AS id, extract(epoch FROM checked_at) AS checked
               FROM chatwoot_attribution_reconciliation
              WHERE state = 'no_inbound_message' AND conversation_id = ANY($1::bigint[])`,
            [ids],
          )
        ).rows.map((row) => [String(row.id), Number(row.checked)]),
      );
      for (const conversation of inWindow) {
        if (summary.conversations >= maxConversations) {
          done = true;
          break;
        }
        summary.conversations += 1;
        const id = Number(conversation.id);
        const hasRow = existing.has(String(id));
        let state: ReconcileState = "has_row";
        let detail = "";
        const quietSince = previous.get(String(id));
        if (!hasRow && quietSince && Number(conversation.last_activity_at ?? 0) <= quietSince) {
          state = "no_inbound_message";
          detail = "unchanged since last check";
        } else if (!hasRow) {
          let messages: Json[] | null = null;
          try {
            messages = await withRetry(() => collectMessages(id));
          } catch (error) {
            state = "failed";
            detail = `messages unreadable: ${(error instanceof Error ? error.message : String(error)).slice(0, 160)}`;
          }
          const inbound = messages ? firstInboundMessage(messages) : null;
          if (messages) state = classifyConversation({ hasRow, firstInbound: inbound });
          if (state === "replayable" && inbound && !dryRun) {
            try {
              const payload = replayPayload(conversation as Json, inbound);
              const rawBody = JSON.stringify(payload);
              await processChatwootAttributionEvent({
                payload,
                rawBody,
                deliveryId: `replay:${id}:${String(inbound.id)}:${createHash("sha256").update(rawBody).digest("hex").slice(0, 12)}`,
                replay: { unknownReason: WEBHOOK_DELIVERY_MISSED },
              });
              state = "replayed";
              detail = `message ${String(inbound.id)}`;
            } catch (error) {
              state = "failed";
              detail = (error instanceof Error ? error.message : String(error)).slice(0, 200);
            }
          }
        }
        summary.states[state] += 1;
        await pool.query(
          `INSERT INTO chatwoot_attribution_reconciliation (conversation_id, inbox_id, conversation_created_at, state, detail, checked_at)
           VALUES ($1, $2, to_timestamp($3), $4, $5, now())
           ON CONFLICT (conversation_id) DO UPDATE SET state = EXCLUDED.state, detail = EXCLUDED.detail,
             inbox_id = EXCLUDED.inbox_id, conversation_created_at = EXCLUDED.conversation_created_at, checked_at = now()`,
          [
            id,
            Number(conversation.inbox_id) || null,
            Number(conversation.created_at) || 0,
            state,
            detail,
          ],
        );
      }
      await saveState(summary);
    }
    summary.status = summary.states.failed ? "partial" : "ok";
    summary.finishedAt = new Date().toISOString();
    summary.message = `${summary.conversations} conversations checked: ${summary.states.has_row} with a row, ${summary.states.no_inbound_message} without an inbound message, ${summary.states.replayable} missing a row${dryRun ? " (dry run)" : ""}, ${summary.states.replayed} rebuilt, ${summary.states.failed} failed.`;
    await saveState(summary);
    return summary;
  } catch (error) {
    summary.status = "failed";
    summary.finishedAt = new Date().toISOString();
    summary.message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    await saveState(summary).catch(() => undefined);
    return summary;
  }
}

/** Chatwoot answers 502/504 under load; a transient failure must not end the whole run. */
async function withRetry<T>(task: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (
        !/HTTP (50[234])|timeout|aborted|fetch failed/i.test(
          String((error as Error)?.message ?? error),
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)));
    }
  }
  throw lastError;
}

/** Up to five pages back, enough to reach the first inbound message of a normal conversation. */
async function collectMessages(conversationId: number): Promise<Json[]> {
  const all: Json[] = [];
  let before: number | undefined;
  for (let page = 0; page < 5; page += 1) {
    const batch = await listChatwootConversationMessages(conversationId, before);
    if (!batch.length) break;
    all.push(...batch);
    const oldest = Math.min(...batch.map((message) => Number(message.id) || Infinity));
    if (!Number.isFinite(oldest) || batch.length < 20) break;
    before = oldest;
  }
  return all;
}

/** Health of the Chatwoot → attribution pipeline, from the database alone. */
export async function chatwootAttributionHealth() {
  if (!databaseConfigured()) return { configured: false as const };
  await ensureSchema();
  const pool = getPool();
  const [pipeline, reconciliation, state] = await Promise.all([
    pool.query<Row>(
      `SELECT
         (SELECT count(*)::int FROM chatwoot_conversation_attribution) AS attribution_rows,
         (SELECT count(*)::int FROM chatwoot_event_inbox WHERE status = 'failed') AS failed_events,
         (SELECT count(*)::int FROM chatwoot_event_inbox
           WHERE status IN ('pending','processing') AND received_at < now() - interval '15 minutes') AS stuck_events,
         (SELECT count(DISTINCT e.conversation_id)::int FROM chatwoot_event_inbox e
           WHERE e.status = 'processed' AND e.conversation_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM chatwoot_conversation_attribution a WHERE a.conversation_id = e.conversation_id)) AS processed_without_row,
         (SELECT count(*)::int FROM chatwoot_conversation_attribution WHERE attribution_method = 'unknown' AND unknown_reason = '') AS unknown_without_reason`,
    ),
    pool.query<Row>(
      `SELECT state, count(*)::int AS n FROM chatwoot_attribution_reconciliation GROUP BY 1`,
    ),
    pool.query<Row>(
      `SELECT status, summary, updated_at FROM chatwoot_attribution_reconcile_state WHERE id = 1`,
    ),
  ]);
  return {
    configured: true as const,
    running: chatwootReconcileRunning(),
    pipeline: pipeline.rows[0] ?? {},
    reconciliation: Object.fromEntries(
      reconciliation.rows.map((row) => [String(row.state), Number(row.n)]),
    ),
    lastRun: state.rows[0] ?? null,
  };
}

let worker: ReturnType<typeof setInterval> | null = null;

/** Detects and repairs lost webhook rows automatically (CHATWOOT_RECONCILE_HOURS, 0 disables). */
export function startChatwootReconcileWorker() {
  if (worker || !databaseConfigured() || !chatwootConfigured()) return;
  const hours = Number(process.env.CHATWOOT_RECONCILE_HOURS ?? 6);
  if (!Number.isFinite(hours) || hours <= 0) return;
  const run = () =>
    runChatwootAttributionReconcile({ days: 2, dryRun: false }).catch((error) =>
      console.error(
        "[chatwoot-reconcile] scheduled run failed:",
        error instanceof Error ? error.message : error,
      ),
    );
  setTimeout(run, 10 * 60_000).unref?.();
  worker = setInterval(run, hours * 3_600_000);
  worker.unref?.();
}

/**
 * The one operational number that matters: Chatwoot conversations with an
 * inbound message that have no attribution row. Target zero; anything else is
 * flagged. Counts come from the last reconciliation window and the event inbox.
 */
export async function chatwootOperationalHealth() {
  if (!databaseConfigured()) return null;
  await ensureSchema();
  const row =
    (
      await getPool().query<Row>(
        `SELECT
         (SELECT count(*) FILTER (WHERE state IN ('has_row','replayed','replayable','failed'))::int FROM chatwoot_attribution_reconciliation) AS inbound,
         (SELECT count(*) FILTER (WHERE state IN ('has_row','replayed'))::int FROM chatwoot_attribution_reconciliation) AS present,
         (SELECT count(*) FILTER (WHERE state IN ('replayable','failed'))::int FROM chatwoot_attribution_reconciliation) AS missing,
         (SELECT count(*)::int FROM chatwoot_conversation_attribution WHERE unknown_reason = 'webhook_delivery_missed') AS recovered,
         (SELECT count(*)::int FROM chatwoot_event_inbox event
            WHERE (event.status = 'failed' OR (event.status IN ('pending','processing') AND event.received_at < now() - interval '15 minutes'))
              -- An event interrupted by a restart after its conversation already has
              -- its attribution row lost nothing; only real gaps are flagged.
              AND NOT EXISTS (SELECT 1 FROM chatwoot_conversation_attribution attribution
                               WHERE attribution.conversation_id = event.conversation_id)) AS failed_or_stuck,
         (SELECT max(updated_at) FROM chatwoot_attribution_reconcile_state) AS checked_at`,
      )
    ).rows[0] ?? {};
  const missing = Number(row.missing ?? 0);
  const failedOrStuck = Number(row.failed_or_stuck ?? 0);
  return {
    inboundConversations: Number(row.inbound ?? 0),
    expectedRows: Number(row.inbound ?? 0),
    presentRows: Number(row.present ?? 0),
    missing,
    recovered: Number(row.recovered ?? 0),
    failedOrStuck,
    flagged: missing > 0 || failedOrStuck > 0,
    checkedAt: row.checked_at ?? null,
  };
}
