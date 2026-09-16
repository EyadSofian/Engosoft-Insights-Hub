import {
  companyContext,
  m2oId,
  m2oName,
  odooCallWithPolicy,
  odooConfig,
  OdooError,
  searchRead,
  type M2O,
} from "./odoo.server";
import { loadCrmRawByIds } from "./crm-odoo.server";
import { crmStageKeyForExternalId } from "./crm-contract";
import {
  cairoDate,
  classifyLostEvents,
  lostEventWindow,
  summarizeLostEvents,
  type LifecycleChange,
  type LifecycleMessage,
} from "./crm-lost-events";
import {
  canonicalMainCategory,
  normalizeName,
  normalizeSource,
  type Snapshot,
} from "./sheet-cache.server";
import { canonicalCourseValue } from "./course-taxonomy";
import { matchesPerformanceDimensionFilters } from "./metrics.server";
import { PLATFORM_SOURCE_KEYS, isOrganicSourceKey } from "./acquisition-channel";
import type { GlobalFilters } from "./types";

interface TrackingRow {
  id: number;
  mail_message_id: M2O;
  field_id: M2O;
  old_value_integer?: number;
  new_value_integer?: number;
  old_value_char?: string | false;
  new_value_char?: string | false;
}
export interface LostMovementRecord {
  id: string;
  contact: string;
  createdAt: string;
  lostDate: string;
  occurredAtUtc: string;
  messageId: number;
  odooUrl: string;
  typeAtEvent: "lead" | "opportunity";
  currentType: string;
  originType: "lead" | "opportunity";
  source: string;
  salesperson: string;
  salesTeam: string;
  company: string;
  course: string;
  lossReason: string;
  lostCategory: string;
  eventCount: number;
}
export interface LostMovementResult {
  availability: "available" | "unavailable";
  error?: string;
  total: number | null;
  fresh: number | null;
  older: number | null;
  undated: number | null;
  eventCount: number | null;
  repeatedRecords: number | null;
  ambiguousEvents: number | null;
  unknownArchiveEvents: number | null;
  fetchedAt: string;
  integrationLogin: string;
  bounds: { start?: string; end?: string };
  companyIds: number[];
  confidence: "EXACT_WITH_TRACKING" | "UNAVAILABLE";
  records: LostMovementRecord[];
  freshRecords: LostMovementRecord[];
  olderRecords: LostMovementRecord[];
}
const context = () => companyContext({ active_test: false, lang: "en_US" });
const chunks = <T>(rows: readonly T[], size = 1000): T[][] =>
  Array.from({ length: Math.ceil(rows.length / size) }, (_, i) =>
    rows.slice(i * size, (i + 1) * size),
  );
const text = (value: unknown) => String(value || "").trim();

/** All dimensions are current values. No historical ownership attribution is claimed. */
export function matchesLostMovementDimensions(
  row: Record<string, string>,
  filters: GlobalFilters,
  snapshot: Snapshot,
): boolean {
  const sourceKey = normalizeSource(row["cleaned Source"] || row.Source || "");
  const course = canonicalCourseValue(row.Course);
  if (filters.company && row.Company !== filters.company) return false;
  if (filters.source && normalizeSource(filters.source) !== sourceKey) return false;
  if (filters.salesTeam && filters.salesTeam !== row["Sales Team"]) return false;
  if (filters.salesperson && filters.salesperson !== row.Salesperson) return false;
  if (filters.course && normalizeName(filters.course) !== normalizeName(course)) return false;
  if (filters.mainCategory && filters.mainCategory !== canonicalMainCategory("", course))
    return false;
  if (filters.campaign && filters.campaign !== (row["Campaign Name"] || "")) return false;
  if (filters.channel === "organic" && !isOrganicSourceKey(sourceKey)) return false;
  if (
    !filters.account &&
    !filters.platform &&
    !filters.campaignKey &&
    !filters.adKey &&
    !filters.adsetKey &&
    !filters.ad &&
    !filters.adset
  )
    return true;
  const campaignId = row["Campaign ID"] || "";
  const campaignName = row["Campaign Name"] || "";
  const name = normalizeName(campaignName);
  const knownCampaign = [...snapshot.campaigns.entries()].find(
    ([, c]) =>
      (campaignId && c.id === campaignId) || (!campaignId && normalizeName(c.name) === name),
  );
  const campaignKey = campaignId
    ? `id:${campaignId}`
    : knownCampaign?.[0] || (name ? `nm:${name}` : "");
  const adId = row["Ad ID"] || "";
  const adName = row["Ad Name"] || "";
  const adMatches = snapshot.ads.filter((a) => (adId ? a.adId === adId : a.ad === adName));
  const adsets = new Set(adMatches.map((a) => a.adset).filter(Boolean));
  const adset = row["Ad Set Name"] || (adsets.size === 1 ? [...adsets][0] : "");
  if (filters.company && row.Company !== filters.company) return false;
  if (filters.channel === "organic" && !isOrganicSourceKey(sourceKey)) return false;
  if (
    filters.platform &&
    filters.channel !== "organic" &&
    !PLATFORM_SOURCE_KEYS[filters.platform].includes(sourceKey) &&
    !snapshot.ads.some((a) => a.platform === filters.platform && a.campaignKey === campaignKey)
  )
    return false;
  if (
    filters.account &&
    (!campaignId ||
      !snapshot.ads.some((a) => a.account === filters.account && a.campaignId === campaignId))
  )
    return false;
  if (filters.campaign && filters.campaign !== campaignName) return false;
  if (filters.campaignKey && filters.campaignKey !== campaignKey) return false;
  if (filters.source && normalizeSource(filters.source) !== sourceKey) return false;
  if (filters.course && normalizeName(filters.course) !== normalizeName(course)) return false;
  if (filters.mainCategory && filters.mainCategory !== canonicalMainCategory("", course))
    return false;
  if (filters.salesTeam && filters.salesTeam !== row["Sales Team"]) return false;
  if (filters.salesperson && filters.salesperson !== row.Salesperson) return false;
  if (filters.ad && filters.ad !== adName) return false;
  if (filters.adset && filters.adset !== adset) return false;
  // Stable ad/adset keys require exactly the observed platform dimension;
  // ambiguous name-only matches are not guessed into the selected dimension.
  if (
    !matchesPerformanceDimensionFilters(
      { campaignId, campaignKey, campaignName, adId, adName, adset },
      filters,
      snapshot.ads,
    )
  )
    return false;
  return true;
}

/** Read only. An access denial is never a zero and never triggers an admin fallback. */
async function readLostMovement(
  filters: GlobalFilters,
  snapshot: Snapshot,
): Promise<LostMovementResult> {
  const policy = { attempts: 1, timeoutMs: 30_000, signal: AbortSignal.timeout(45_000) };
  const call = <T>(
    model: string,
    method: string,
    args: unknown[] = [],
    kwargs: Record<string, unknown> = {},
  ) => odooCallWithPolicy<T>(model, method, args, kwargs, policy);
  const read = <T extends { id: number }>(
    model: string,
    domain: unknown[],
    fields: string[],
    options: { context?: Record<string, unknown> } = {},
  ) => searchRead<T>(model, domain, fields, { ...options, policy });
  const cfg = odooConfig();
  const bounds = lostEventWindow(filters.from, filters.to);
  const base = {
    fetchedAt: new Date().toISOString(),
    integrationLogin: cfg.login,
    companyIds: cfg.companyIds,
    bounds,
  };
  try {
    const allowed = await call<boolean>(
      "mail.tracking.value",
      "check_access_rights",
      ["read", false],
      { context: context() },
    );
    if (!allowed)
      throw new OdooError(
        "The integration account needs read access to mail.tracking.value to verify Lost events.",
        "access",
      );
    const metadata = await read<{ id: number; name: string }>(
      "ir.model.fields",
      [
        ["model", "=", "crm.lead"],
        ["name", "in", ["type", "active", "stage_id", "lost_reason_id"]],
      ],
      ["name"],
      { context: context() },
    );
    const fieldNames = new Map(metadata.map((f) => [f.id, f.name]));
    if (metadata.length !== 4) throw new Error("Required CRM tracking metadata is incomplete");
    const stages = await read<{ id: number }>("crm.stage", [], ["id"], {
      context: context(),
    });
    const xmlids = await call<Record<string, string>>(
      "crm.stage",
      "get_external_id",
      [stages.map((s) => s.id)],
      { context: context() },
    );
    const lostStage = stages.find((s) => crmStageKeyForExternalId(xmlids[String(s.id)]) === "lost");
    if (!lostStage) throw new Error("Lost stage XMLID cannot be resolved");
    const trackingFields = [
      "mail_message_id",
      "field_id",
      "old_value_integer",
      "new_value_integer",
      "old_value_char",
      "new_value_char",
    ];
    const domain: unknown[] = [["mail_message_id.model", "=", "crm.lead"]];
    if (bounds.start) domain.push(["mail_message_id.date", ">=", bounds.start]);
    if (bounds.end) domain.push(["mail_message_id.date", "<", bounds.end]);
    const stageField = metadata.find((f) => f.name === "stage_id")!;
    const activeField = metadata.find((f) => f.name === "active")!;
    // Fetch only potential Lost transitions first, not every CRM edit or
    // conversion in the month. Then read evidence from those SAME messages.
    domain.push(
      "|",
      "&",
      "&",
      ["field_id", "=", stageField.id],
      ["new_value_integer", "=", lostStage.id],
      ["old_value_integer", "!=", lostStage.id],
      "&",
      "&",
      ["field_id", "=", activeField.id],
      ["old_value_integer", "=", 1],
      ["new_value_integer", "=", 0],
    );
    const transitions = await read<TrackingRow>("mail.tracking.value", domain, trackingFields, {
      context: context(),
    });
    const tracking: TrackingRow[] = [];
    for (const ids of chunks([...new Set(transitions.map((t) => m2oId(t.mail_message_id)))])) {
      tracking.push(
        ...(await read<TrackingRow>(
          "mail.tracking.value",
          [
            ["mail_message_id", "in", ids],
            ["field_id", "in", metadata.map((f) => f.id)],
          ],
          trackingFields,
          { context: context() },
        )),
      );
    }
    const messages: LifecycleMessage[] = [];
    for (const ids of chunks([...new Set(tracking.map((t) => m2oId(t.mail_message_id)))])) {
      messages.push(
        ...(await read<LifecycleMessage>(
          "mail.message",
          [
            ["id", "in", ids],
            ["model", "=", "crm.lead"],
          ],
          ["res_id", "date", "body"],
          { context: context() },
        )),
      );
    }
    const rawRecords = await loadCrmRawByIds([...new Set(messages.map((m) => m.res_id))], policy);
    const scoped = rawRecords.filter(
      (r) => !r["Inventory Bucket"] && matchesLostMovementDimensions(r, filters, snapshot),
    );
    const typeField = metadata.find((f) => f.name === "type")!;
    const typeTracking: TrackingRow[] = [];
    for (const ids of chunks(scoped.map((r) => Number(r.__odoo_id)))) {
      typeTracking.push(
        ...(await read<TrackingRow>(
          "mail.tracking.value",
          [
            ["mail_message_id.model", "=", "crm.lead"],
            ["mail_message_id.res_id", "in", ids],
            ["field_id", "=", typeField.id],
          ],
          trackingFields,
          { context: context() },
        )),
      );
    }
    const typeMessages: LifecycleMessage[] = [];
    for (const ids of chunks([...new Set(typeTracking.map((t) => m2oId(t.mail_message_id)))])) {
      typeMessages.push(
        ...(await read<LifecycleMessage>(
          "mail.message",
          [
            ["id", "in", ids],
            ["model", "=", "crm.lead"],
          ],
          ["res_id", "date"],
          { context: context() },
        )),
      );
    }
    const toChange = (t: TrackingRow): LifecycleChange => ({
      id: t.id,
      messageId: m2oId(t.mail_message_id),
      field: fieldNames.get(m2oId(t.field_id)) || "",
      oldInteger: t.old_value_integer || 0,
      newInteger: t.new_value_integer || 0,
      oldText: text(t.old_value_char),
      newText: text(t.new_value_char),
    });
    const classified = classifyLostEvents({
      messages,
      changes: tracking.map(toChange),
      typeMessages,
      typeChanges: typeTracking.map(toChange),
      currentTypes: new Map(scoped.map((r) => [Number(r.__odoo_id), r["Record Type"]])),
      lostStageId: lostStage.id,
    });
    const summary = summarizeLostEvents(
      classified.confirmed,
      new Map(scoped.map((r) => [Number(r.__odoo_id), r.__odoo_create_date_utc])),
      filters,
    );
    const creationDays = new Map(
      scoped.map((r) => [Number(r.__odoo_id), cairoDate(r.__odoo_create_date_utc)]),
    );
    const records: LostMovementRecord[] = [];
    const reasonIds = [...new Set(classified.confirmed.map((e) => e.reasonId).filter(Boolean))];
    const reasons = reasonIds.length
      ? await read<{ id: number; name: string; category_id?: M2O }>(
          "crm.lost.reason",
          [["id", "in", reasonIds]],
          ["name", "category_id"],
          { context: context() },
        )
      : [];
    const reasonMap = new Map(reasons.map((r) => [r.id, r]));
    for (const raw of scoped) {
      const id = Number(raw.__odoo_id),
        events = summary.byRecord.get(id);
      if (!events?.length) continue;
      const event = [...events].sort(
        (a, b) => b.occurredAtUtc.localeCompare(a.occurredAtUtc) || b.messageId - a.messageId,
      )[0];
      const converted = typeTracking.some((t) => {
        const m = typeMessages.find((m) => m.id === m2oId(t.mail_message_id));
        return (
          m?.res_id === id &&
          text(t.old_value_char).toLowerCase() === "lead" &&
          text(t.new_value_char).toLowerCase() === "opportunity"
        );
      });
      const reason = reasonMap.get(event.reasonId);
      records.push({
        id: String(id),
        contact: raw["اسم جهة الاتصال"],
        createdAt: creationDays.get(id) || "",
        lostDate: cairoDate(event.occurredAtUtc),
        occurredAtUtc: event.occurredAtUtc,
        messageId: event.messageId,
        odooUrl: `${cfg.url}/web#id=${id}&model=crm.lead&view_type=form`,
        typeAtEvent: event.typeAtEvent,
        currentType: raw["Record Type"],
        originType:
          raw["Record Type"] === "lead" || converted || raw["Conversion Date"]
            ? "lead"
            : "opportunity",
        source: raw["cleaned Source"] || raw.Source,
        salesperson: raw.Salesperson,
        salesTeam: raw["Sales Team"],
        company: raw.Company,
        course: canonicalCourseValue(raw.Course),
        lossReason: reason?.name || event.reasonText,
        lostCategory: m2oName(reason?.category_id),
        eventCount: events.length,
      });
    }
    const freshIds = new Set(summary.fresh),
      olderIds = new Set(summary.older);
    const freshRecords = records.filter((r) => freshIds.has(Number(r.id)));
    const olderRecords = records.filter((r) => olderIds.has(Number(r.id)));
    records.sort((a, b) => b.occurredAtUtc.localeCompare(a.occurredAtUtc));
    return {
      ...base,
      fetchedAt: new Date().toISOString(),
      availability: "available",
      confidence: "EXACT_WITH_TRACKING",
      total: records.length,
      fresh: freshRecords.length,
      older: olderRecords.length,
      undated: records.length - freshRecords.length - olderRecords.length,
      eventCount: summary.eventCount,
      repeatedRecords: summary.repeatedRecords,
      ambiguousEvents: classified.uncertain.filter(
        (e) => e.kind !== "archive_without_lost_evidence",
      ).length,
      unknownArchiveEvents: classified.uncertain.filter(
        (e) => e.kind === "archive_without_lost_evidence",
      ).length,
      records,
      freshRecords,
      olderRecords,
    };
  } catch (error) {
    return {
      ...base,
      availability: "unavailable",
      confidence: "UNAVAILABLE",
      error: error instanceof Error ? error.message : "Lost event evidence is unavailable",
      total: null,
      fresh: null,
      older: null,
      undated: null,
      eventCount: null,
      repeatedRecords: null,
      ambiguousEvents: null,
      unknownArchiveEvents: null,
      records: [],
      freshRecords: [],
      olderRecords: [],
    };
  }
}

// Short, non-persistent cache; coalesce concurrent reads. Denials never fall
// back to a last-good/Sheet timestamp. Entries are scoped to identity, companies,
// filters AND the attribution snapshot, with a bounded map.
const cache = new Map<
  string,
  { snapshot: Snapshot; expiresAt: number; promise: Promise<LostMovementResult> }
>();
export function loadLostMovement(
  filters: GlobalFilters,
  snapshot: Snapshot,
): Promise<LostMovementResult> {
  const cfg = odooConfig();
  const key = JSON.stringify([cfg.url, cfg.db, cfg.login, cfg.companyIds, filters]);
  const current = cache.get(key);
  if (current && current.snapshot === snapshot && current.expiresAt > Date.now())
    return current.promise;
  if (cache.size >= 20) cache.delete(cache.keys().next().value!);
  const promise = readLostMovement(filters, snapshot);
  const entry = { snapshot, expiresAt: Number.POSITIVE_INFINITY, promise };
  cache.set(key, entry);
  void promise.then(
    () => {
      entry.expiresAt = Date.now() + 15_000;
    },
    () => {
      cache.delete(key);
    },
  );
  return promise;
}
