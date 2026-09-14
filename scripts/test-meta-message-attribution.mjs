import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  normalizeMetaMessageWebhook,
  verifyMetaWebhookChallenge,
  verifyMetaWebhookSignature,
} from "../src/lib/meta-message-attribution.server.ts";

{
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-1",
        changes: [
          {
            field: "messages",
            value: {
              metadata: {
                phone_number_id: "phone-number-id",
                display_phone_number: "+201000000000",
              },
              contacts: [{ profile: { name: "Private Person" }, wa_id: "201000000000" }],
              messages: [
                {
                  id: "wamid.exact-1",
                  from: "201000000000",
                  timestamp: "1893456000",
                  type: "text",
                  text: { body: "private message body" },
                  referral: {
                    source_id: "120000000000001",
                    source_type: "ad",
                    source_url:
                      "https://www.instagram.com/p/x/?utm_source=instagram&utm_campaign=summer_m",
                    ctwa_clid: "opaque-click-id",
                    headline: "private-ish ad copy",
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };
  const [event] = normalizeMetaMessageWebhook(payload);
  assert.equal(event.provider, "whatsapp");
  assert.equal(event.providerMessageId, "wamid.exact-1");
  assert.equal(event.destinationPhoneNumberId, "phone-number-id");
  assert.equal(event.sourcePlatform, "instagram");
  assert.equal(event.referralSourceId, "120000000000001");
  assert.equal(event.attributionMethod, "meta_whatsapp_referral");
  const reduced = JSON.stringify(event.reducedEvidence);
  assert.equal(reduced.includes("private message body"), false);
  assert.equal(reduced.includes("Private Person"), false);
  assert.equal(reduced.includes("201000000000"), false);
  assert.equal(reduced.includes("private-ish ad copy"), false);
}

{
  const [event] = normalizeMetaMessageWebhook({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "p" },
              messages: [{ id: "wamid.direct", timestamp: "1893456000", text: { body: "hello" } }],
            },
          },
        ],
      },
    ],
  });
  assert.equal(event.channel, "whatsapp");
  assert.equal(event.sourcePlatform, "direct_or_unknown");
  assert.equal(event.attributionMethod, "inbox_only");
  assert.equal(event.unknownReason, "no_paid_referral");
}

{
  const [event] = normalizeMetaMessageWebhook({
    object: "page",
    entry: [
      {
        id: "page-1",
        messaging: [
          {
            timestamp: 1893456000000,
            recipient: { id: "page-1" },
            sender: { id: "private-psid" },
            message: {
              mid: "m_exact",
              text: "secret",
              referral: { ad_id: "ad-1", source_url: "https://facebook.com/ad" },
            },
          },
        ],
      },
    ],
  });
  assert.equal(event.provider, "messenger");
  assert.equal(event.channel, "messenger");
  assert.equal(event.providerMessageId, "m_exact");
  assert.equal(event.attributionMethod, "meta_messenger_referral");
  assert.equal(JSON.stringify(event.reducedEvidence).includes("private-psid"), false);
  assert.equal(JSON.stringify(event.reducedEvidence).includes("secret"), false);
}

{
  const events = normalizeMetaMessageWebhook({
    object: "page",
    entry: [
      {
        id: "page-1",
        messaging: [
          {
            timestamp: 1893456000000,
            recipient: { id: "private-psid" },
            message: { mid: "m_echo", is_echo: true, text: "outbound agent reply" },
          },
        ],
      },
    ],
  });
  assert.deepEqual(events, []);
}

{
  const [event] = normalizeMetaMessageWebhook({
    object: "instagram",
    entry: [
      {
        id: "ig-1",
        messaging: [
          {
            timestamp: 1893456000000,
            recipient: { id: "ig-1" },
            message: { mid: "igmid-1", text: "secret" },
          },
        ],
      },
    ],
  });
  assert.equal(event.provider, "instagram");
  assert.equal(event.channel, "instagram_dm");
  assert.equal(event.sourcePlatform, "instagram");
  assert.equal(event.attributionMethod, "inbox_only");
  assert.equal(event.unknownReason, "organic_direct");
}

{
  const raw = JSON.stringify({ object: "page", entry: [] });
  const secret = "app-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  assert.equal(verifyMetaWebhookSignature(raw, signature, secret), true);
  assert.equal(verifyMetaWebhookSignature(`${raw}x`, signature, secret), false);
  assert.equal(verifyMetaWebhookSignature(raw, "sha256=bad", secret), false);
  assert.equal(
    verifyMetaWebhookChallenge({
      mode: "subscribe",
      verifyToken: "token",
      expectedToken: "token",
      challenge: "123",
    }),
    "123",
  );
  assert.equal(
    verifyMetaWebhookChallenge({
      mode: "subscribe",
      verifyToken: "bad",
      expectedToken: "token",
      challenge: "123",
    }),
    null,
  );
}

console.log("Meta message attribution fixtures passed.");
