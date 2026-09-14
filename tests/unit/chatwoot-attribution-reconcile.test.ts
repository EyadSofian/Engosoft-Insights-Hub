import { describe, expect, it } from "vitest";
import {
  WEBHOOK_DELIVERY_MISSED,
  classifyConversation,
  firstInboundMessage,
  isInboundMessage,
  replayPayload,
} from "@/lib/chatwoot-attribution-reconcile";
import { normalizeChatwootAttribution } from "@/lib/chatwoot-attribution.server";

describe("Chatwoot conversation reconciliation", () => {
  it("never leaves a conversation without a state", () => {
    expect(classifyConversation({ hasRow: true, firstInbound: null })).toBe("has_row");
    expect(classifyConversation({ hasRow: false, firstInbound: null })).toBe("no_inbound_message");
    expect(classifyConversation({ hasRow: false, firstInbound: { id: 1, message_type: 0 } })).toBe(
      "replayable",
    );
  });

  it("treats outgoing, template, activity and private notes as not inbound", () => {
    expect(isInboundMessage({ message_type: 1 })).toBe(false);
    expect(isInboundMessage({ message_type: 3 })).toBe(false);
    expect(isInboundMessage({ message_type: 2 })).toBe(false);
    expect(isInboundMessage({ message_type: 0, private: true })).toBe(false);
    expect(isInboundMessage({ message_type: 0 })).toBe(true);
  });

  it("picks the earliest inbound message, not the latest", () => {
    const first = firstInboundMessage([
      { id: 1300432, message_type: 0, created_at: 1757866395 },
      { id: 1300420, message_type: 1, created_at: 1757866348 },
      { id: 1300414, message_type: 0, created_at: 1757866332 },
    ]);
    expect(first?.id).toBe(1300414);
  });

  it("rebuilds a webhook payload the attribution pipeline reads as an unknown inbound conversation", () => {
    const payload = replayPayload(
      {
        id: 157064,
        inbox_id: 29,
        created_at: 1757866073,
        meta: { channel: "Channel::Api", sender: { id: 88, phone_number: "+201000000000" } },
      },
      { id: 1300414, message_type: 0, created_at: 1757866332, content: "hello" },
    );
    const normalized = normalizeChatwootAttribution(payload);
    expect(normalized.inbound).toBe(true);
    expect(normalized.conversationId).toBe(157064);
    expect(normalized.inboxId).toBe(29);
    expect(normalized.channel).toBe("Channel::Api");
    // The API keeps no referral, so a rebuilt conversation is never exact.
    expect(normalized.attributionMethod).toBe("unknown");
    expect(WEBHOOK_DELIVERY_MISSED).toBe("webhook_delivery_missed");
  });
});
