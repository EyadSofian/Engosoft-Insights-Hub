import { describe, expect, it } from "vitest";
import { indexCallsByPhone, weeklyCallEvidence, weeklyWindow } from "../../src/lib/weekly-lead-followup";
import type { CallsHubLeadCallAggregate } from "../../src/lib/calls-hub.server";

const lead = { id: "42", createdAt: "2026-10-19", phone: "+201012345678", mobile: "" };
const call = (overrides: Partial<CallsHubLeadCallAggregate> = {}): CallsHubLeadCallAggregate => ({
  phone: "01012345678", agentName: "Agent", agentExtension: "101", callDate: "2026-10-19",
  totalCalls: 1, answeredCalls: 0, firstCallAt: "", latestCallAt: "", latestCallId: "1",
  ...overrides,
});

describe("weekly lead follow-up", () => {
  it("uses a Monday-start Cairo calendar week and rejects invalid dates", () => {
    expect(weeklyWindow("2026-10-19")).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(weeklyWindow("2026-10-18")).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    expect(weeklyWindow("2026-02-30")).toBeNull();
  });
  it("distinguishes missing PBX evidence from an upstream outage", () => {
    expect(weeklyCallEvidence(lead, new Map(), true).status).toBe("no_pbx_record");
    expect(weeklyCallEvidence(lead, new Map(), false).status).toBe("unknown");
    expect(weeklyCallEvidence({ ...lead, phone: "" }, new Map(), true).status).toBe("unknown");
  });
  it("counts unanswered retries only after lead creation, and deduplicates phone and mobile", () => {
    const before = call({ callDate: "2026-10-18", totalCalls: 10 });
    const retried = call({ totalCalls: 2 });
    const calls = indexCallsByPhone([before, retried]);
    expect(weeklyCallEvidence({ ...lead, mobile: "01012345678" }, calls, true)).toEqual({
      status: "attempted_no_answer", attempts: 2, answeredCalls: 0, retriedNoAnswer: true,
    });
    expect(weeklyCallEvidence(lead, indexCallsByPhone([call({ answeredCalls: 1 })]), true).status).toBe("answered");
  });
});
