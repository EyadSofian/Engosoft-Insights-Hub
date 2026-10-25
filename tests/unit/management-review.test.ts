import { describe, expect, it } from "vitest";
import { funnelFromHistory, funnelFromLive, summarizeFunnel } from "@/lib/management-review";
import type { CrmLeadRow, LostRow } from "@/lib/types";

describe("management review funnel", () => {
  it("uses one lead per Odoo id, documented close dates, and explicit Fresh/Old tags", () => {
    const base = {
      id: "1",
      course: "PMP",
      createdAt: "2026-09-01",
      callingReply: "Answered",
      leadSegment: "Fresh",
      lossReason: "",
      wonDate: "2026-09-04",
      closedAt: "2026-09-04",
      isWon: true,
    } as CrmLeadRow;
    const old = { ...base, id: "2", leadSegment: "Old Data", isWon: false, closedAt: "" };
    const lost = {
      id: "3",
      course: "PMP",
      createdAt: "2026-09-02",
      callingReply: "Not answer",
      leadSegment: "",
      lossReason: "لا يرد",
      closeDate: "2026-09-07",
      lostDate: "",
    } as LostRow;
    const summary = summarizeFunnel(funnelFromLive([base, old], [lost, { ...lost }]));
    expect(summary.leads).toBe(3);
    expect(summary.won).toBe(1);
    expect(summary.lost).toBe(1);
    expect(summary.noAnswer).toBe(1);
    expect(summary.lostRate).toBeCloseTo(1 / 3);
    expect(summary.freshConversion).toBe(1);
    expect(summary.oldConversion).toBe(0);
    expect(summary.segmentCoverage).toBeCloseTo(2 / 3);
    expect(summary.turnaroundDays).toBe(4);
    expect(summary.reasons).toEqual([
      expect.objectContaining({ key: "not_reached", count: 1, share: 1 }),
    ]);
  });

  it("aggregates historical Odoo creation days without manufacturing missing rates", () => {
    const summary = summarizeFunnel(
      funnelFromHistory([
        {
          createdAt: "2025-02-01",
          course: "CFM",
          leads: 10,
          won: 2,
          lost: 4,
          inventoryLeads: 3,
          noAnswer: 2,
          replyKnown: 4,
          freshLeads: 5,
          freshWon: 2,
          oldLeads: 0,
          oldWon: 0,
          turnaroundDaysSum: 12,
          turnaroundSamples: 3,
          lostReasons: { not_interested: 3, unknown: 1 },
        },
      ]),
    );
    expect(summary.lostRate).toBe(0.4);
    expect(summary.noAnswerRate).toBe(0.2);
    expect(summary.freshConversion).toBe(0.4);
    expect(summary.oldConversion).toBeNull();
    expect(summary.turnaroundDays).toBe(4);
    expect(summary.reasons.reduce((sum, reason) => sum + reason.count, 0)).toBe(4);
  });
});
