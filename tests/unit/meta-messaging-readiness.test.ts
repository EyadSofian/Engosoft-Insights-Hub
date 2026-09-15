import { describe, expect, it } from "vitest";
import {
  isSelfTestMessageId,
  normalizeMetaMessageWebhook,
  verifyMetaWebhookSignature,
} from "@/lib/meta-message-attribution.server";
import {
  channelStatus,
  missingAppFields,
  selfTestPayload,
  signWebhookBody,
  type ReadinessCheck,
} from "@/lib/meta-messaging-readiness";
import { credentialFingerprint } from "@/lib/meta-credential-health.server";

const identity = {
  adId: "120253702302880712",
  pageId: "1500414613618298",
  instagramAccountId: "17841402680887554",
  phoneNumberId: "",
  stamp: "2026-09-15T01:00:00.000Z",
};

describe("self-test payloads parse exactly like Meta's own", () => {
  it("WhatsApp CTWA: ad ID and click ID become exact evidence", () => {
    const { messageId, payload } = selfTestPayload("whatsapp", identity);
    const [event] = normalizeMetaMessageWebhook(payload);
    expect(event).toMatchObject({
      provider: "whatsapp",
      channel: "whatsapp",
      providerMessageId: messageId,
      referralSourceId: identity.adId,
      attributionMethod: "meta_whatsapp_referral",
      attributionConfidence: "exact",
    });
    expect(event!.ctwaClid).toContain("selftest");
  });

  it("Messenger: the referral ad_id becomes exact evidence on the Page", () => {
    const { messageId, payload } = selfTestPayload("messenger", identity);
    const [event] = normalizeMetaMessageWebhook(payload);
    expect(event).toMatchObject({
      provider: "messenger",
      channel: "messenger",
      providerMessageId: messageId,
      referralSourceId: identity.adId,
      destinationPageId: identity.pageId,
      attributionMethod: "meta_messenger_referral",
      attributionConfidence: "exact",
    });
  });

  it("Instagram: the referral ad_id becomes exact evidence on the Instagram account", () => {
    const { payload } = selfTestPayload("instagram", identity);
    const [event] = normalizeMetaMessageWebhook(payload);
    expect(event).toMatchObject({
      provider: "instagram",
      channel: "instagram_dm",
      referralSourceId: identity.adId,
      destinationPageId: identity.instagramAccountId,
      attributionMethod: "meta_instagram_referral",
      attributionConfidence: "exact",
    });
  });

  it("an organic Messenger message is never exact", () => {
    const [event] = normalizeMetaMessageWebhook({
      object: "page",
      entry: [
        {
          id: "p",
          messaging: [{ recipient: { id: "p" }, timestamp: 1, message: { mid: "m_organic" } }],
        },
      ],
    });
    expect(event!.attributionConfidence).toBe("inferred");
    expect(event!.referralSourceId).toBe("");
  });

  it("never copies message text, names or phone numbers into evidence", () => {
    const payload = selfTestPayload("whatsapp", identity).payload as {
      entry: {
        changes: { value: { messages: Record<string, unknown>[]; contacts?: unknown[] } }[];
      }[];
    };
    payload.entry[0]!.changes[0]!.value.messages[0]!.text = { body: "my phone is +201000000000" };
    payload.entry[0]!.changes[0]!.value.contacts = [
      { profile: { name: "Private Person" }, wa_id: "201000000000" },
    ];
    const [event] = normalizeMetaMessageWebhook(payload);
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("201000000000");
    expect(serialized).not.toContain("Private Person");
  });
});

describe("signature and self-test isolation", () => {
  it("accepts Meta's signature and rejects a forged one", () => {
    const raw = JSON.stringify(selfTestPayload("messenger", identity).payload);
    expect(verifyMetaWebhookSignature(raw, signWebhookBody(raw, "app-secret"), "app-secret")).toBe(
      true,
    );
    expect(verifyMetaWebhookSignature(raw, `sha256=${"0".repeat(64)}`, "app-secret")).toBe(false);
    expect(verifyMetaWebhookSignature(raw, signWebhookBody(raw, "other"), "app-secret")).toBe(
      false,
    );
  });

  it("marks self-test IDs, and no real Meta ID looks like one", () => {
    for (const provider of ["whatsapp", "messenger", "instagram"] as const) {
      expect(isSelfTestMessageId(selfTestPayload(provider, identity).messageId)).toBe(true);
    }
    for (const real of ["wamid.HBgMOTY2NTg", "m_AbCdEf", "aWdfZAG1faXRlbTo"]) {
      expect(isSelfTestMessageId(real)).toBe(false);
    }
  });

  it("fingerprints a credential without being reversible or empty-equal", () => {
    expect(credentialFingerprint("")).toBe("");
    expect(credentialFingerprint("EAAB-token")).toHaveLength(16);
    expect(credentialFingerprint("EAAB-token")).not.toContain("EAAB");
    expect(credentialFingerprint("EAAB-token")).not.toBe(credentialFingerprint("EAAB-token2"));
  });
});

describe("channel status is words, never a zero", () => {
  const check = (state: ReadinessCheck["state"]): ReadinessCheck => ({
    key: state,
    label: state,
    state,
    detail: "",
  });

  it("is connected only when real deliveries resolved", () => {
    expect(channelStatus([check("ready")], 3)).toBe("connected");
  });

  it("is infrastructure ready when only a Meta permission is outstanding", () => {
    expect(channelStatus([check("ready"), check("permission_pending")], 0)).toBe(
      "infrastructure_ready_permission_pending",
    );
  });

  it("is not connected when anything Engosoft controls is not ready or unverified", () => {
    expect(
      channelStatus([check("ready"), check("permission_pending"), check("not_ready")], 0),
    ).toBe("not_connected");
    expect(channelStatus([check("ready"), check("unverified")], 0)).toBe("not_connected");
  });

  it("knows which app webhook fields are missing", () => {
    expect(missingAppFields("page", ["leadgen"])).toEqual([
      "messages",
      "messaging_referrals",
      "messaging_postbacks",
    ]);
    expect(missingAppFields("whatsapp_business_account", ["messages"])).toEqual([]);
  });
});
