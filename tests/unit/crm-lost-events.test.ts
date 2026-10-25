import { describe, expect, it } from "vitest";
import {
  cairoDate,
  cairoMidnightUtc,
  classifyLostEvents,
  lostEventWindow,
  summarizeLostEvents,
  type LifecycleChange,
  type LifecycleMessage,
  type LostEvent,
} from "@/lib/crm-lost-events";
const message = (
  id: number,
  res_id = id,
  date = "2026-09-10 10:00:00",
  body = "",
): LifecycleMessage => ({ id, res_id, date, body });
const change = (
  messageId: number,
  field: string,
  oldInteger = 0,
  newInteger = 0,
  oldText = "",
  newText = "",
): LifecycleChange => ({
  id: messageId * 100 + field.length,
  messageId,
  field,
  oldInteger,
  newInteger,
  oldText,
  newText,
});
const lost = (id: number): LifecycleChange[] => [
  change(id, "stage_id", 10, 99),
  change(id, "lost_reason_id", 0, 2, "", "Commercial"),
];
const archive = (id: number): LifecycleChange => change(id, "active", 1, 0);
describe("verified Lost history — contract §14.2", () => {
  it("classifies stage losses, Lead archive losses and legacy Opportunity Lost Comments; keeps manual archives/ambiguous stage events out", () => {
    const messages = [
      message(1),
      message(2),
      message(3, 3, undefined, "<p>Lost Comment: no answer</p>"),
      message(4),
      message(5),
    ];
    const result = classifyLostEvents({
      messages,
      changes: [
        ...lost(1),
        archive(2),
        change(2, "lost_reason_id", 0, 7),
        archive(3),
        archive(4),
        change(5, "stage_id", 10, 99),
      ],
      currentTypes: new Map([
        [1, "opportunity"],
        [2, "lead"],
        [3, "opportunity"],
        [4, "lead"],
        [5, "opportunity"],
      ]),
      lostStageId: 99,
    });
    expect(result.confirmed.map((e) => [e.recordId, e.kind])).toEqual([
      [1, "lost_stage_with_reason"],
      [2, "archive_with_reason"],
      [3, "archive_with_lost_comment"],
    ]);
    expect(result.uncertain.map((e) => e.kind)).toEqual([
      "archive_without_lost_evidence",
      "lost_stage_without_reason",
    ]);
  });
  it("does not silently borrow a current/adjacent reason or a comment-only message to prove loss", () => {
    const result = classifyLostEvents({
      messages: [message(1, 1), message(2, 1), message(3, 3, undefined, "Lost Comment")],
      changes: [change(1, "stage_id", 10, 99), change(2, "lost_reason_id", 0, 2)],
      currentTypes: new Map([
        [1, "opportunity"],
        [3, "lead"],
      ]),
      lostStageId: 99,
    });
    expect(result.confirmed).toEqual([]);
    expect(result.uncertain).toHaveLength(1);
  });
  it("uses integer stage identity, not historical labels, and requires a transition", () => {
    const result = classifyLostEvents({
      messages: [message(1), message(2), message(3)],
      changes: [
        change(1, "stage_id", 10, 99, "Open", "Old renamed stage"),
        change(1, "lost_reason_id", 0, 2),
        change(2, "stage_id", 10, 55, "Open", "Lost"),
        change(2, "lost_reason_id", 0, 2),
        change(3, "stage_id", 99, 99),
        change(3, "lost_reason_id", 0, 2),
      ],
      currentTypes: new Map([
        [1, "opportunity"],
        [2, "opportunity"],
        [3, "opportunity"],
      ]),
      lostStageId: 99,
    });
    expect(result.confirmed.map((e) => e.recordId)).toEqual([1]);
  });
  it("counts a Lead loss before conversion as Lead; reconstructs type from earliest later change and latest earlier change", () => {
    const messages = [
      message(10, 1),
      message(20, 1, "2026-09-11 10:00:00"),
      message(30, 1, "2026-09-12 10:00:00"),
    ];
    const changes = [
      archive(10),
      change(10, "lost_reason_id", 0, 2),
      change(20, "type", 0, 0, "Lead", "Opportunity"),
      ...lost(30),
    ];
    const result = classifyLostEvents({
      messages,
      changes,
      currentTypes: new Map([[1, "opportunity"]]),
      lostStageId: 99,
    });
    expect(result.confirmed.map((e) => e.typeAtEvent)).toEqual(["lead", "opportunity"]);
  });
  it("ignores records outside explicit readable scope and reports unknown types without guessing", () => {
    const result = classifyLostEvents({
      messages: [message(1), message(2)],
      changes: [...lost(1), ...lost(2)],
      currentTypes: new Map([[2, "unknown"]]),
      lostStageId: 99,
    });
    expect(result.confirmed).toHaveLength(0);
    expect(result.uncertain.map((e) => e.recordId)).toEqual([2]);
  });
});
const event = (messageId: number, recordId: number, occurredAtUtc: string): LostEvent => ({
  messageId,
  recordId,
  occurredAtUtc,
  typeAtEvent: "opportunity",
  reasonId: 2,
  reasonText: "Reason",
  kind: "lost_stage_with_reason",
});
describe("Cairo half-open event windows and disjoint cohorts", () => {
  it("converts summer and winter midnight independently and includes the whole final Cairo day", () => {
    expect(cairoMidnightUtc("2026-09-01")).toBe("2026-08-31 21:00:00");
    expect(cairoMidnightUtc("2026-01-01")).toBe("2025-12-31 22:00:00");
    expect(lostEventWindow("2026-09-01", "2026-09-30")).toEqual({
      start: "2026-08-31 21:00:00",
      end: "2026-09-30 21:00:00",
    });
    expect(cairoDate("2026-08-31 21:00:00")).toBe("2026-09-01");
  });
  it("handles the DST-skipped Cairo midnight without inventing a business hour", () => {
    expect(cairoMidnightUtc("2026-04-24")).toBe("2026-04-23 22:00:00");
    expect(lostEventWindow("2026-04-23", "2026-04-24")).toEqual({
      start: "2026-04-22 22:00:00",
      end: "2026-04-24 21:00:00",
    });
  });
  it("counts unique records, repeated events and invalid creation dates separately, without requiring current Lost state", () => {
    const first = event(1, 1, "2026-08-31 21:00:00");
    const result = summarizeLostEvents(
      [
        first,
        first,
        event(2, 1, "2026-09-10 12:00:00"),
        event(3, 2, "2026-09-30 20:59:59"),
        event(4, 3, "2026-09-30 21:00:00"),
        event(5, 4, "2026-09-10 10:00:00"),
      ],
      new Map([
        [1, "2026-08-31 21:00:00"],
        [2, "2026-07-01 10:00:00"],
      ]),
      { from: "2026-09-01", to: "2026-09-30" },
    );
    expect(result.total).toBe(3);
    expect(result.eventCount).toBe(4);
    expect(result.repeatedRecords).toBe(1);
    expect(result.fresh).toEqual([1]);
    expect(result.older).toEqual([2]);
    expect(result.undated).toEqual([4]);
  });
  it("rejects invalid/inverted boundaries instead of broadening the reporting scope", () => {
    expect(() => cairoMidnightUtc("2026-02-30")).toThrow();
    expect(() => lostEventWindow("2026-09-20", "2026-09-01")).toThrow();
  });
});
