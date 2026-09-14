import { Pool } from "pg";
import {
  CHATWOOT_ATTRIBUTION_DEFINITIONS,
  CHATWOOT_ATTRIBUTION_KEYS,
  HISTORICAL_EVIDENCE_MISSING,
  buildChatwootAttributionAttributes,
  hasAttributionEvidence,
  planChatwootAttributionUpdate,
} from "./chatwoot-attribution-attributes";
import { inboxBranchMappingConfigured, resolveInboxBranch } from "./chatwoot-attribution.server";
import {
  configuredCustomerType,
  configuredMarketer,
  customerTypeRulesConfigured,
} from "./chatwoot-attribution-context.server";
import {
  chatwootConfigured,
  createChatwootConversationAttributeDefinition,
  getChatwootConversationCustomAttributes,
  listChatwootConversationAttributeDefinitions,
  listChatwootInboxes,
  renameChatwootConversationAttributeDefinition,
  updateChatwootConversationAttributes,
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
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  ad_id: string;
  ad_name: string;
  creative_id: string;
  creative_name: string;
  ctwa_clid: string;
  platform: string;
  medium: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
}

export interface ChatwootFactsBackfillReport {
  dryRun: boolean;
  offset: number;
  limit: number;
  nextOffset: number | null;
  totalConversations: number;
  scanned: number;
  branchMappingConfigured: boolean;
  customerTypeRulesConfigured: boolean;
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
    marketerPopulated: number;
    customerSourcePopulated: number;
    customerTypePopulated: number;
    campaignPopulated: number;
    adsetPopulated: number;
    adPopulated: number;
    ctwaPopulated: number;
    failures: number;
    failureSamples: { conversationId: number; error: string }[];
  };
  campaignFieldsUntouched: number;
  exactAttributionPreserved: number;
  definitions: {
    before: number;
    missing: string[];
    created: string[];
    relabel: string[];
    relabeled: string[];
  };
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
    customerTypeRulesConfigured: customerTypeRulesConfigured(),
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
      marketerPopulated: 0,
      customerSourcePopulated: 0,
      customerTypePopulated: 0,
      campaignPopulated: 0,
      adsetPopulated: 0,
      adPopulated: 0,
      ctwaPopulated: 0,
      failures: 0,
      failureSamples: [],
    },
    campaignFieldsUntouched: 0,
    exactAttributionPreserved: 0,
    definitions: { before: 0, missing: [], created: [], relabel: [], relabeled: [] },
  };

  const inboxChannels = new Map<number, string>();
  if (chatwootConfigured()) {
    for (const inbox of await listChatwootInboxes()) inboxChannels.set(inbox.id, inbox.channelType);
  }

  if (syncChatwoot && offset === 0) {
    const defined = new Map(
      (await listChatwootConversationAttributeDefinitions()).map((item) => [item.key, item]),
    );
    report.definitions.before = defined.size;
    for (const definition of CHATWOOT_ATTRIBUTION_DEFINITIONS) {
      const current = defined.get(definition.key);
      if (!current) report.definitions.missing.push(definition.key);
      else if (current.name !== definition.name) report.definitions.relabel.push(definition.key);
    }
    if (!dryRun) {
      for (const definition of CHATWOOT_ATTRIBUTION_DEFINITIONS) {
        const current = defined.get(definition.key);
        if (!current) {
          await createChatwootConversationAttributeDefinition({
            key: definition.key,
            name: definition.name,
            description: definition.description,
          });
          report.definitions.created.push(definition.key);
        } else if (current.name !== definition.name) {
          // Only the label of an attribution-owned definition changes; its key and values stay.
          await renameChatwootConversationAttributeDefinition(current.id, definition.name);
          report.definitions.relabeled.push(definition.key);
        }
      }
    }
  }

  const [count, rows] = await Promise.all([
    db.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM chatwoot_conversation_attribution`,
    ),
    db.query<ConversationFacts>(
      `SELECT conversation_id::int AS conversation_id, inbox_id::int AS inbox_id, channel, branch_id, branch_name,
              attribution_method, confidence, unknown_reason, campaign_id, campaign_name, adset_id,
              adset_name, ad_id, ad_name, creative_id, creative_name, ctwa_clid, platform, medium,
              utm_source, utm_medium, utm_campaign, utm_content, utm_term
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
    // Stored exact evidence travels with the row; the planner never lets it, or anything
    // weaker, replace attribution that is already on the conversation.
    const wanted = buildChatwootAttributionAttributes({
      channel,
      branch,
      attributionMethod: proven ? row.attribution_method : "unknown",
      confidence: row.confidence,
      unknownReason: row.unknown_reason,
      historical: true,
      source: row.platform,
      medium: row.medium,
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      adsetId: row.adset_id,
      adsetName: row.adset_name,
      adId: row.ad_id,
      adName: row.ad_name,
      creativeId: row.creative_id,
      creativeName: row.creative_name,
      ctwaClid: row.ctwa_clid,
      utmSource: row.utm_source,
      utmMedium: row.utm_medium,
      utmCampaign: row.utm_campaign,
      utmContent: row.utm_content,
      utmTerm: row.utm_term,
      marketer: configuredMarketer(row.campaign_id),
      customerType: configuredCustomerType(row.inbox_id),
    });
    let changes: Record<string, unknown>;
    try {
      if (dryRun) {
        const current = await getChatwootConversationCustomAttributes(row.conversation_id);
        changes = planChatwootAttributionUpdate(current, wanted, "backfill");
      } else {
        // Serialized, re-read immediately before the write, and limited to attribution keys.
        const result = await updateChatwootConversationAttributes(
          row.conversation_id,
          (latest) => planChatwootAttributionUpdate(latest, wanted, "backfill"),
          { ownedKeys: CHATWOOT_ATTRIBUTION_KEYS },
        );
        changes = result.written;
      }
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
    if (changes.marketer_name) report.chatwoot.marketerPopulated += 1;
    if (changes.customer_source) report.chatwoot.customerSourcePopulated += 1;
    if (changes.customer_type) report.chatwoot.customerTypePopulated += 1;
    if (changes.meta_campaign_id) report.chatwoot.campaignPopulated += 1;
    if (changes.meta_adset_id) report.chatwoot.adsetPopulated += 1;
    if (changes.meta_ad_id) report.chatwoot.adPopulated += 1;
    if (changes.ctwa_clid) report.chatwoot.ctwaPopulated += 1;
    report.chatwoot.conversationsUpdated += 1;
  }
  return report;
}
