import { describe, expect, it } from "vitest";
import {
  cairoDayBoundsUnix,
  indexCallsByPhone,
  normalizePhone,
  phoneMatchKey,
  resolveLeadContactEvidence,
  samePhoneIdentity,
  type ContactEvidenceContext,
  type EvidenceCall,
  type EvidenceChat,
} from "@/lib/lead-contact-evidence";

const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

const call = (over: Partial<EvidenceCall>): EvidenceCall => ({
  phone: "+966500000001",
  agentName: "Owner Person",
  agentExtension: "101",
  callDate: "2026-09-03",
  firstCallAt: "2026-09-03T08:00:00Z",
  latestCallAt: "2026-09-03T08:05:00Z",
  totalCalls: 2,
  latestCallId: "call-1",
  ...over,
});

const chat = (over: Partial<EvidenceChat>): EvidenceChat => ({
  phoneKey: "500000001",
  conversationId: 1,
  status: "open",
  assigneeName: "",
  agentNames: [],
  lastActivityAt: unix("2026-09-04T10:00:00Z"),
  agentContactedAt: 0,
  customerMessagedAt: 0,
  awaitingReply: false,
  url: "https://chat.example/conversations/1",
  ...over,
});

const lead = { id: "11", phone: "", mobile: "0500000001", createdAt: "2026-09-02" };

const context = (over: Partial<ContactEvidenceContext> = {}): ContactEvidenceContext => ({
  window: { from: "2026-09-01", to: "2026-09-15" },
  callsByPhone: new Map(),
  callsAvailable: true,
  chatsByPhone: new Map([["500000001", []]]),
  chatwootAvailable: true,
  isOwnerCall: (c) => c.agentName === "Owner Person",
  isOwnerChatName: (name) => name === "Owner Person",
  callUrl: (id) => `https://calls.example/?call=${id}`,
  ...over,
});

describe("phone number normalisation", () => {
  it.each(["01012345678", "+20 101 234 5678", "0020-1012345678", "201012345678", "٠١٠١٢٣٤٥٦٧٨"])(
    "reads %s as the Egyptian mobile +201012345678",
    (value) => {
      const phone = normalizePhone(value);
      expect(phone.e164).toBe("+201012345678");
      expect(phone.country).toBe("EG");
    },
  );

  it.each(["0501234567", "501234567", "966501234567", "+966 50 123 4567", "00966501234567"])(
    "reads %s as the Saudi mobile +966501234567",
    (value) => {
      const phone = normalizePhone(value);
      expect(phone.e164).toBe("+966501234567");
      expect(phone.country).toBe("SA");
    },
  );

  it("never keys a short extension", () => {
    expect(phoneMatchKey("3029")).toBe("");
    expect(normalizePhone("101").key).toBe("");
  });

  it("refuses to match an Egyptian and a Saudi number that share their last nine digits", () => {
    const egypt = normalizePhone("01512345678");
    const saudi = normalizePhone("0512345678");
    expect(egypt.key).toBe(saudi.key);
    expect(samePhoneIdentity(egypt, saudi)).toBe(false);
    expect(samePhoneIdentity(normalizePhone("+966512345678"), saudi)).toBe(true);
  });
});

describe("phone + mobile contact matching", () => {
  it("finds a call placed to the lead's mobile when the phone field is empty", () => {
    const evidence = resolveLeadContactEvidence(
      lead,
      context({ callsByPhone: indexCallsByPhone([call({})]) }),
    );
    expect(evidence.calledByAny).toBe(true);
    expect(evidence.calledByOwner).toBe(true);
    expect(evidence.totalCalls).toBe(2);
    expect(evidence.latestCallUrl).toBe("https://calls.example/?call=call-1");
    expect(evidence.contactStatus).toBe("contacted");
  });

  it("matches on both numbers and counts a call on each", () => {
    const both = { ...lead, phone: "+20 100 000 0002" };
    const calls = indexCallsByPhone([
      call({}),
      call({ phone: "01000000002", latestCallId: "call-2", totalCalls: 1 }),
    ]);
    const evidence = resolveLeadContactEvidence(
      both,
      context({
        callsByPhone: calls,
        chatsByPhone: new Map([
          ["500000001", []],
          ["000000002", []],
        ]),
      }),
    );
    expect(evidence.phoneKeys).toHaveLength(2);
    expect(evidence.totalCalls).toBe(3);
  });

  it("ignores a call made before the lead existed", () => {
    const early = call({
      callDate: "2026-08-30",
      firstCallAt: "2026-08-30T08:00:00Z",
      latestCallAt: "2026-08-30T08:00:00Z",
    });
    const evidence = resolveLeadContactEvidence(
      lead,
      context({ callsByPhone: indexCallsByPhone([early]) }),
    );
    expect(evidence.calledByAny).toBe(false);
    expect(evidence.contactStatus).toBe("not_contacted");
  });

  it("separates a colleague's call from the owner's", () => {
    const colleague = call({ agentName: "Colleague", agentExtension: "202" });
    const evidence = resolveLeadContactEvidence(
      lead,
      context({ callsByPhone: indexCallsByPhone([colleague]) }),
    );
    expect(evidence.calledByAny).toBe(true);
    expect(evidence.calledByOwner).toBe(false);
    expect(evidence.callers).toEqual(["Colleague"]);
    expect(evidence.ownerContactStatus).toBe("not_contacted");
  });
});

describe("Yeastar + Chatwoot evidence reconciliation", () => {
  it("credits an owner Chatwoot reply even when only a colleague called", () => {
    const evidence = resolveLeadContactEvidence(
      lead,
      context({
        callsByPhone: indexCallsByPhone([call({ agentName: "Colleague" })]),
        chatsByPhone: new Map([
          [
            "500000001",
            [
              chat({
                agentNames: ["Owner Person"],
                agentContactedAt: unix("2026-09-05T09:00:00Z"),
              }),
            ],
          ],
        ]),
      }),
    );
    expect(evidence.calledByOwner).toBe(false);
    expect(evidence.chatByOwner).toBe(true);
    expect(evidence.contactedByOwner).toBe(true);
    expect(evidence.evidenceSources).toEqual(["yeastar", "chatwoot"]);
    expect(evidence.evidenceComplete).toBe(true);
  });

  it("keeps a customer-only conversation awaiting a reply and does not count it as contact", () => {
    const evidence = resolveLeadContactEvidence(
      lead,
      context({
        chatsByPhone: new Map([
          [
            "500000001",
            [chat({ customerMessagedAt: unix("2026-09-04T09:00:00Z"), awaitingReply: true })],
          ],
        ]),
      }),
    );
    expect(evidence.contactedViaChat).toBe(false);
    expect(evidence.customerOnlyChat).toBe(true);
    expect(evidence.chatAwaitingReply).toBe(true);
    expect(evidence.contactStatus).toBe("not_contacted");
    expect(evidence.latestChatUrl).toContain("/conversations/1");
  });

  it("ignores an employee reply outside the reporting window", () => {
    const evidence = resolveLeadContactEvidence(
      lead,
      context({
        chatsByPhone: new Map([
          ["500000001", [chat({ agentContactedAt: unix("2026-09-20T09:00:00Z") })]],
        ]),
      }),
    );
    expect(evidence.contactedViaChat).toBe(false);
  });

  it("uses Cairo business days for the window edges", () => {
    const bounds = cairoDayBoundsUnix("2026-09-01")!;
    expect(bounds.end - bounds.start).toBe(86_399);
    expect(bounds.start).toBeLessThanOrEqual(unix("2026-09-01T00:00:00Z"));
    expect(bounds.start).toBeGreaterThan(unix("2026-08-31T20:00:00Z"));
  });
});

describe("evidence-incomplete behavior", () => {
  it("reports unknown, not 'not contacted', when the Calls Hub read failed", () => {
    const evidence = resolveLeadContactEvidence(lead, context({ callsAvailable: false }));
    expect(evidence.contactStatus).toBe("unknown");
    expect(evidence.missingSources).toContain("yeastar");
    expect(evidence.evidenceComplete).toBe(false);
  });

  it("reports unknown when Chatwoot has no evidence for one of the lead's numbers", () => {
    const evidence = resolveLeadContactEvidence(
      { ...lead, phone: "0555555555" },
      context({ chatsByPhone: new Map([["500000001", []]]) }),
    );
    expect(evidence.contactStatus).toBe("unknown");
    expect(evidence.missingSources).toEqual(["chatwoot"]);
  });

  it("reports unknown when Chatwoot is unavailable", () => {
    expect(
      resolveLeadContactEvidence(lead, context({ chatwootAvailable: false })).contactStatus,
    ).toBe("unknown");
  });

  it("reports unknown for a lead without any phone number", () => {
    const evidence = resolveLeadContactEvidence({ ...lead, mobile: "" }, context());
    expect(evidence.unmatchableReason).toBe("no_phone");
    expect(evidence.contactStatus).toBe("unknown");
  });

  it("still reports contacted when the contact itself is proven, whatever else is missing", () => {
    const evidence = resolveLeadContactEvidence(
      lead,
      context({ chatwootAvailable: false, callsByPhone: indexCallsByPhone([call({})]) }),
    );
    expect(evidence.contactStatus).toBe("contacted");
  });
});
