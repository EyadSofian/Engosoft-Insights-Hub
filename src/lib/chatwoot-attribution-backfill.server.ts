import { Pool } from "pg";
import {
  CHATWOOT_ATTRIBUTION_DEFINITIONS,
  HISTORICAL_EVIDENCE_MISSING,
  buildChatwootAttributionAttributes,
  hasAttributionEvidence,
  planChatwootAttributionUpdate,
  type ChatwootAttributionAttributes,
} from "./chatwoot-attribution-attributes";
import { inboxBranchMappingConfigured, resolveInboxBranch } from "./chatwoot-attribution.server";
import {
  chatwootConfigured,
  createChatwootConversationAttributeDefinition,
  getChatwootConversationCustomAttributes,
  listChatwootConversationAttributeKeys,
  listChatwootInboxes,
  mergeChatwootConversationCustomAttributes,
} from "./chatwoot.server";

/**
 * Historical backfill of the facts an inbox proves.
 *
 * It fills only empty operational fields (channel, branch) and the unknown
 * reason for conversations that have no provider evidence. It never writes
 * campaign, ad or click identifiers, never touches a conversation that already
 * carries proven attribution beyond those facts, never reads CRM, and runs as a
 * dry run unless told otherwise.
 */

let pool: Pool | null = null;

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
      ssl:
        connectionString.includes(".railway.internal") || process.env.PGSSLMODE === "disable"
          ? false
          : { rejectUnauthorized: false },
    });
  }
  return pool;
}

const FACT_KEYS = ["attribution_channel", "engosoft_branch"] as const;

const DESCRIPTIONS: Record<string, string> = {
  attribution_channel: "Messaging channel proven by the Chatwoot inbox.",
  meta_creative_id: "Meta creative ID resolved from a provider referral.",
  attribution_unknown_reason: "Why marketing attribution is unknown for this conversation.",
};

interface ConversationFacts {
  conversation_id: number;
  inbox_id: number | null;
  channel: string;
  branch_id: string;
  branch_name: string;
  attribution_method: string;
  confidence: string;
  unknown_reason: string;
  campaign_id: string;
  ad_id: string;
  ctwa_clid: string;
}

export interface ChatwootFactsBackfillReport {
  dryRun: boolean;
  offset: number;
  limit: number;
  nextOffset: number | null;
  totalConversations: number;
  scanned: number;
  branchMappingConfigured: boolean;
  database: { channelPopulated: number; branchPopulated: number; unknownReasonPopulated: number };
  chatwoot: {
    skipped: boolean;
    conversationsUpdated: number;
    conversationsUnchanged: number;
    channelPopulated: number;
    branchPopulated: number;
    methodPopulated: number;
    confidencePopulated: number;
    unknownReasonPopulated: number;
    failures: number;
    failureSamples: { conversationId: number; error: string }[];
  };
  campaignFieldsUntouched: number;
  exactAttributionPreserved: number;
  definitions: { missing: string[]; created: string[] };
}

function pick(
  attributes: ChatwootAttributionAttributes,
  keys: readonly string[],
): ChatwootAttributionAttributes {
  return Object.fromEntries(
    Object.entries(attributes).filter(([key]) => keys.includes(key)),
  ) as ChatwootAttributionAttributes;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 160) : "request failed";
}

export async function backfillChatwootAttributionFacts(
  options: { dryRun?: boolean; offset?: number; limit?: number; syncChatwoot?: boolean } = {},
): Promise<ChatwootFactsBackfillReport> {
  const dryRun = options.dryRun !== false;
  const offset = Math.max(0, Math.floor(Number(options.offset) || 0));
  const limit = Math.min(Math.max(Math.floor(Number(options.limit) || 100), 1), 250);
  const syncChatwoot = options.syncChatwoot !== false && chatwootConfigured();
  const db = getPool();

  const report: ChatwootFactsBackfillReport = {
    dryRun,
    offset,
    limit,
    nextOffset: null,
    totalConversations: 0,
    scanned: 0,
    branchMappingConfigured: inboxBranchMappingConfigured(),
    database: { channelPopulated: 0, branchPopulated: 0, unknownReasonPopulated: 0 },
    chatwoot: {
      skipped: !syncChatwoot,
      conversationsUpdated: 0,
      conversationsUnchanged: 0,
      channelPopulated: 0,
      branchPopulated: 0,
      methodPopulated: 0,
      confidencePopulated: 0,
      unknownReasonPopulated: 0,
      failures: 0,
      failureSamples: [],
    },
    campaignFieldsUntouched: 0,
    exactAttributionPreserved: 0,
    definitions: { missing: [], created: [] },
  };

  const inboxChannels = new Map<number, string>();
  if (chatwootConfigured()) {
    for (const inbox of await listChatwootInboxes()) inboxChannels.set(inbox.id, inbox.channelType);
  }

  if (syncChatwoot && offset === 0) {
    const defined = new Set(await listChatwootConversationAttributeKeys());
    report.definitions.missing = CHATWOOT_ATTRIBUTION_DEFINITIONS.map((item) => item.key).filter(
      (key) => !defined.has(key),
    );
    if (!dryRun) {
      for (const definition of CHATWOOT_ATTRIBUTION_DEFINITIONS) {
        if (defined.has(definition.key)) continue;
        await createChatwootConversationAttributeDefinition({
          key: definition.key,
          name: definition.name,
          description: DESCRIPTIONS[definition.key] ?? definition.name,
        });
        report.definitions.created.push(definition.key);
      }
    }
  }

  const [count, rows] = await Promise.all([
    db.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM chatwoot_conversation_attribution`,
    ),
    db.query<ConversationFacts>(
      `SELECT conversation_id::int AS conversation_id, inbox_id::int AS inbox_id, channel, branch_id, branch_name,
              attribution_method, confidence, unknown_reason, campaign_id, ad_id, ctwa_clid
         FROM chatwoot_conversation_attribution
        ORDER BY conversation_id ASC
        LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
  ]);
  report.totalConversations = Number(count.rows[0]?.total ?? 0);
  report.scanned = rows.rows.length;
  report.nextOffset =
    offset + rows.rows.length < report.totalConversations ? offset + rows.rows.length : null;

  for (const row of rows.rows) {
    const inboxChannel = row.inbox_id ? inboxChannels.get(row.inbox_id) || "" : "";
    const channel = row.channel || inboxChannel;
    const mapped = row.branch_id ? null : resolveInboxBranch(row.inbox_id);
    const branch = row.branch_name || row.branch_id || mapped?.name || mapped?.id || "";
    const proven =
      hasAttributionEvidence(row.attribution_method) ||
      row.confidence === "exact" ||
      Boolean(row.campaign_id || row.ad_id || row.ctwa_clid);
    const missingReason = row.attribution_method === "unknown" && !row.unknown_reason;

    // Campaign, ad set, ad and click fields are never part of this backfill.
    report.campaignFieldsUntouched += 1;
    if (proven) report.exactAttributionPreserved += 1;

    const setChannel = !row.channel && Boolean(inboxChannel);
    const setBranch = !row.branch_id && Boolean(mapped);
    if (setChannel) report.database.channelPopulated += 1;
    if (setBranch) report.database.branchPopulated += 1;
    if (missingReason) report.database.unknownReasonPopulated += 1;
    if (!dryRun && (setChannel || setBranch || missingReason)) {
      await db.query(
        `UPDATE chatwoot_conversation_attribution SET
            channel = CASE WHEN channel = '' THEN $2 ELSE channel END,
            branch_id = CASE WHEN branch_id = '' THEN $3 ELSE branch_id END,
            branch_name = CASE WHEN branch_id = '' THEN $4 ELSE branch_name END,
            unknown_reason = CASE WHEN attribution_method = 'unknown' AND unknown_reason = '' THEN $5 ELSE unknown_reason END
          WHERE conversation_id = $1`,
        [
          row.conversation_id,
          setChannel ? inboxChannel : "",
          setBranch ? mapped?.id || "" : "",
          setBranch ? mapped?.name || mapped?.id || "" : "",
          HISTORICAL_EVIDENCE_MISSING,
        ],
      );
    }

    if (!syncChatwoot) continue;
    const built = buildChatwootAttributionAttributes({
      channel,
      branch,
      attributionMethod: proven ? row.attribution_method : "unknown",
      confidence: row.confidence,
      unknownReason: row.unknown_reason,
      historical: true,
    });
    // Proven conversations only gain the inbox facts; their attribution is left as it is.
    const wanted = proven ? pick(built, FACT_KEYS) : built;
    let changes: Record<string, string>;
    try {
      const current = await getChatwootConversationCustomAttributes(row.conversation_id);
      changes = planChatwootAttributionUpdate(current, wanted, "backfill");
    } catch (error) {
      report.chatwoot.failures += 1;
      if (report.chatwoot.failureSamples.length < 10)
        report.chatwoot.failureSamples.push({
          conversationId: row.conversation_id,
          error: message(error),
        });
      continue;
    }
    if (!Object.keys(changes).length) {
      report.chatwoot.conversationsUnchanged += 1;
      continue;
    }
    if (changes.attribution_channel) report.chatwoot.channelPopulated += 1;
    if (changes.engosoft_branch) report.chatwoot.branchPopulated += 1;
    if (changes.attribution_method) report.chatwoot.methodPopulated += 1;
    if (changes.attribution_confidence) report.chatwoot.confidencePopulated += 1;
    if (changes.attribution_unknown_reason) report.chatwoot.unknownReasonPopulated += 1;
    if (dryRun) {
      report.chatwoot.conversationsUpdated += 1;
      continue;
    }
    try {
      await mergeChatwootConversationCustomAttributes(row.conversation_id, changes);
      report.chatwoot.conversationsUpdated += 1;
    } catch (error) {
      report.chatwoot.failures += 1;
      if (report.chatwoot.failureSamples.length < 10)
        report.chatwoot.failureSamples.push({
          conversationId: row.conversation_id,
          error: message(error),
        });
    }
  }
  return report;
}
