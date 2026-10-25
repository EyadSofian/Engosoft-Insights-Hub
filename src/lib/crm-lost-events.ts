/** Deterministic Lost evidence, CRM Dashboard Data Contract §§14, 15, 21.
 * No current-state predicate or mutable CRM timestamp can prove a Lost event.
 */
export type EventRecordType = "lead" | "opportunity";
export interface LifecycleMessage {
  id: number;
  res_id: number;
  date: string;
  body?: string | false;
}
export interface LifecycleChange {
  id: number;
  messageId: number;
  field: string;
  oldInteger: number;
  newInteger: number;
  oldText: string;
  newText: string;
}
export interface LostEvent {
  messageId: number;
  recordId: number;
  occurredAtUtc: string;
  typeAtEvent: EventRecordType;
  reasonId: number;
  reasonText: string;
  kind: "lost_stage_with_reason" | "archive_with_reason" | "archive_with_lost_comment";
}
export interface UncertainEvent {
  messageId: number;
  recordId: number;
  occurredAtUtc: string;
  kind: "lost_stage_without_reason" | "archive_without_lost_evidence" | "unknown_type";
}
const validType = (text: string): EventRecordType | null => {
  const value = text.trim().toLowerCase();
  return value === "lead" || value === "opportunity" ? value : null;
};
const compare = (a: LifecycleMessage, b: LifecycleMessage) =>
  a.date.localeCompare(b.date) || a.id - b.id;

/** Latest type change through the event, else earliest later old value, else current type.
 * Historical display values of the selection are English under an explicit en_US context.
 */
export function typeAtEvent(
  event: LifecycleMessage,
  messages: readonly LifecycleMessage[],
  changes: readonly LifecycleChange[],
  currentType: string,
): EventRecordType | null {
  const messageMap = new Map(messages.map((m) => [m.id, m]));
  const history = changes
    .filter((t) => t.field === "type")
    .map((t) => ({ change: t, message: messageMap.get(t.messageId) }))
    .filter(
      (t): t is { change: LifecycleChange; message: LifecycleMessage } =>
        !!t.message && t.message.res_id === event.res_id,
    )
    .sort((a, b) => compare(a.message, b.message) || a.change.id - b.change.id);
  const before = history.filter((t) => compare(t.message, event) <= 0).at(-1);
  const after = history.find((t) => compare(t.message, event) > 0);
  return before
    ? validType(before.change.newText)
    : after
      ? validType(after.change.oldText)
      : validType(currentType);
}

export function classifyLostEvents(input: {
  messages: readonly LifecycleMessage[];
  changes: readonly LifecycleChange[];
  typeMessages?: readonly LifecycleMessage[];
  typeChanges?: readonly LifecycleChange[];
  currentTypes: ReadonlyMap<number, string>;
  lostStageId: number;
}): { confirmed: LostEvent[]; uncertain: UncertainEvent[] } {
  const confirmed: LostEvent[] = [];
  const uncertain: UncertainEvent[] = [];
  const byMessage = new Map<number, LifecycleChange[]>();
  for (const change of input.changes) {
    const group = byMessage.get(change.messageId) ?? [];
    group.push(change);
    byMessage.set(change.messageId, group);
  }
  const seen = new Set<number>();
  for (const message of [...input.messages].sort(compare)) {
    if (seen.has(message.id) || !input.currentTypes.has(message.res_id)) continue;
    seen.add(message.id);
    const changes = byMessage.get(message.id) ?? [];
    const toLost = changes.some(
      (t) =>
        t.field === "stage_id" &&
        t.newInteger === input.lostStageId &&
        t.oldInteger !== input.lostStageId,
    );
    const archived = changes.some(
      (t) => t.field === "active" && t.oldInteger === 1 && t.newInteger === 0,
    );
    if (!toLost && !archived) continue;
    const reasonChange = changes.find(
      (t) => t.field === "lost_reason_id" && (!!t.newInteger || !!t.newText.trim()),
    );
    const reason = !!reasonChange;
    const comment = /Lost Comment/i.test(String(message.body || ""));
    const base = { messageId: message.id, recordId: message.res_id, occurredAtUtc: message.date };
    const type = typeAtEvent(
      message,
      input.typeMessages ?? input.messages,
      input.typeChanges ?? input.changes,
      input.currentTypes.get(message.res_id) ?? "",
    );
    if (!type) {
      uncertain.push({ ...base, kind: "unknown_type" });
      continue;
    }
    const evidence = {
      reasonId: reasonChange?.newInteger ?? 0,
      reasonText: reasonChange?.newText ?? "",
    };
    if (toLost) {
      // A reason in another message, or a reason left on the current record,
      // is never silently joined onto this event.
      if (reason && type === "opportunity")
        confirmed.push({ ...base, ...evidence, typeAtEvent: type, kind: "lost_stage_with_reason" });
      else uncertain.push({ ...base, kind: "lost_stage_without_reason" });
    } else if (reason || comment) {
      confirmed.push({
        ...base,
        ...evidence,
        typeAtEvent: type,
        kind: reason ? "archive_with_reason" : "archive_with_lost_comment",
      });
    } else uncertain.push({ ...base, kind: "archive_without_lost_evidence" });
  }
  return { confirmed, uncertain };
}

export function cairoDate(utc: string): string {
  const date = new Date(utc.replace(" ", "T") + (/Z$|[+-]\d\d:\d\d$/.test(utc) ? "" : "Z"));
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
/** Resolve each local midnight independently (including Cairo DST changes). */
export function cairoMidnightUtc(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Invalid reporting date");
  const target = Date.parse(day + "T00:00:00Z");
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 10) !== day)
    throw new Error("Invalid reporting date");
  let instant = target;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(instant)).map((p) => [p.type, p.value]),
    );
    const wall = Date.parse(
      `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`,
    );
    const correction = target - wall;
    if (!correction) return new Date(instant).toISOString().slice(0, 19).replace("T", " ");
    instant += correction;
  }
  // Cairo skips midnight when DST begins. The boundary is the first instant
  // whose local calendar day is the requested day, not an invented 00:00.
  let lo = target - 12 * 3600_000,
    hi = target + 12 * 3600_000;
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2000) * 1000;
    if (cairoDate(new Date(mid).toISOString()) < day) lo = mid;
    else hi = mid;
  }
  return new Date(hi).toISOString().slice(0, 19).replace("T", " ");
}
export function lostEventWindow(from?: string, to?: string): { start?: string; end?: string } {
  const start = from ? cairoMidnightUtc(from) : undefined;
  let end: string | undefined;
  if (to) {
    cairoMidnightUtc(to); // Validate before calendar arithmetic.
    const next = new Date(to + "T00:00:00Z");
    next.setUTCDate(next.getUTCDate() + 1);
    end = cairoMidnightUtc(next.toISOString().slice(0, 10));
  }
  if (start && end && start >= end) throw new Error("Invalid reporting window");
  return { start, end };
}

/** A repeated loss contributes multiple events but exactly one record to a card. */
export function summarizeLostEvents(
  events: readonly LostEvent[],
  creationDates: ReadonlyMap<number, string>,
  window: { from?: string; to?: string },
) {
  const bounds = lostEventWindow(window.from, window.to);
  const inPeriod = events.filter(
    (e) =>
      (!bounds.start || e.occurredAtUtc >= bounds.start) &&
      (!bounds.end || e.occurredAtUtc < bounds.end),
  );
  const byRecord = new Map<number, LostEvent[]>();
  for (const event of inPeriod) {
    const group = byRecord.get(event.recordId) ?? [];
    if (!group.some((e) => e.messageId === event.messageId)) group.push(event);
    byRecord.set(event.recordId, group);
  }
  const fresh: number[] = [],
    older: number[] = [],
    undated: number[] = [];
  for (const id of byRecord.keys()) {
    const created = cairoDate(creationDates.get(id) ?? "");
    if (created && (!window.from || created >= window.from) && (!window.to || created <= window.to))
      fresh.push(id);
    else if (created && window.from && created < window.from) older.push(id);
    else undated.push(id);
  }
  return {
    byRecord,
    fresh,
    older,
    undated,
    total: byRecord.size,
    eventCount: [...byRecord.values()].reduce((sum, rows) => sum + rows.length, 0),
    repeatedRecords: [...byRecord.values()].filter((rows) => rows.length > 1).length,
  };
}
