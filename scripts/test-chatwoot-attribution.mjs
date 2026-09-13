import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  attributionPercentage,
  managedAttributionLabels,
  normalizeChatwootAttribution,
  verifyAttributionTrackingToken,
  verifyChatwootWebhookSignature,
} from "../src/lib/chatwoot-attribution.server.ts";
import {
  getChatwootConversationCustomAttributes,
  getChatwootConversationLabels,
} from "../src/lib/chatwoot.server.ts";

process.env.CHATWOOT_ATTRIBUTION_TOKEN_SECRET = "test-attribution-token-secret";
process.env.CHATWOOT_BASE_URL = "https://chat.example.test";
process.env.CHATWOOT_ACCOUNT_ID = "2";
process.env.CHATWOOT_API_TOKEN = "test-token";
process.env.CHATWOOT_ATTRIBUTION_BRANCH_MAP_JSON = JSON.stringify({
  inboxes: { 15: { id: "riyadh", name: "Riyadh" } },
});

assert.equal(attributionPercentage(48, 48), 100);
assert.equal(attributionPercentage(1, 4), 25);
assert.equal(attributionPercentage(0, 0), null);

const signedToken = (nonce) =>
  `${nonce}.${createHmac("sha256", process.env.CHATWOOT_ATTRIBUTION_TOKEN_SECRET)
    .update(`chatwoot-attribution:${nonce}`)
    .digest("base64url")}`;

{
  const raw = JSON.stringify({ id: 1, event: "message_created" });
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = `sha256=${createHmac("sha256", "native-webhook-secret")
    .update(`${timestamp}.${raw}`)
    .digest("hex")}`;
  assert.equal(
    verifyChatwootWebhookSignature({
      rawBody: raw,
      timestamp,
      signature,
      secret: "native-webhook-secret",
    }),
    true,
  );
  assert.equal(
    verifyChatwootWebhookSignature({
      rawBody: raw,
      timestamp,
      signature: "sha256=bad",
      secret: "native-webhook-secret",
    }),
    false,
  );
  assert.equal(
    verifyChatwootWebhookSignature({
      rawBody: raw,
      timestamp: "1",
      signature,
      secret: "native-webhook-secret",
    }),
    false,
  );
}

{
  const native = normalizeChatwootAttribution({
    event: "message_created",
    message: {
      id: 701,
      message_type: 0,
      sender_type: "Contact",
      created_at: "2030-05-01T12:00:00Z",
      content: "Interested in the course",
      content_attributes: {
        referral: {
          source_id: "opaque-meta-ad-or-creative-id",
          source_type: "ad",
          ctwa_clid: "click-opaque-123",
          source_url:
            "https://www.instagram.com/p/test?utm_source=instagram&utm_medium=cpc&utm_campaign=spring",
        },
      },
    },
    conversation: { id: 700, inbox_id: 15, meta: { assignee: { id: 9 } } },
    contact: { id: 88, phone_number: "+966 50 000 0001" },
  });
  assert.equal(native.inbound, true);
  assert.equal(native.attributionMethod, "meta_referral");
  assert.equal(native.confidence, "exact");
  assert.equal(native.referralSourceId, "opaque-meta-ad-or-creative-id");
  assert.equal(native.ctwaClid, "click-opaque-123");
  assert.equal(native.platform, "instagram");
  assert.equal(native.utmCampaign, "spring");
  assert.equal(native.branchId, "riyadh");
  assert.equal(native.phoneKey, "500000001");
  assert.equal(
    JSON.stringify(native.evidence).includes("500000001"),
    false,
    "evidence must not retain phone PII",
  );
  assert.equal(
    JSON.stringify(native.evidence).includes("Interested"),
    false,
    "evidence must not retain message text",
  );
}

{
  const token = signedToken("nonceForAttribution123");
  assert.equal(verifyAttributionTrackingToken(token), true);
  assert.equal(verifyAttributionTrackingToken(`${token}x`), false);
  const website = normalizeChatwootAttribution({
    event: "message_created",
    message: {
      id: 702,
      message_type: "incoming",
      sender_type: "contact",
      content: `Hello [ref:${token}]`,
    },
    conversation: {
      id: 700,
      inbox_id: 15,
      custom_attributes: { utm_source: "google", utm_medium: "cpc", utm_campaign: "pmp" },
    },
  });
  assert.equal(website.attributionMethod, "signed_tracking_token");
  assert.equal(website.confidence, "strong");
  assert.equal(website.trackingToken, token);
  assert.equal(website.utmCampaign, "pmp");
}

{
  const direct = normalizeChatwootAttribution({
    event: "message_created",
    id: 703,
    message_type: "incoming",
    sender_type: "contact",
    conversation: { id: 7030, inbox_id: 15 },
  });
  assert.equal(direct.attributionMethod, "inbox_mapping");
  assert.equal(direct.confidence, "inferred");

  const outbound = normalizeChatwootAttribution({
    event: "message_created",
    message: { id: 704, message_type: "outgoing", sender_type: "user" },
    conversation: { id: 7040, inbox_id: 15 },
  });
  assert.equal(outbound.inbound, false);
}

assert.deepEqual(
  managedAttributionLabels({
    platform: "Facebook / Instagram",
    source: "",
    medium: "Click To WhatsApp",
    branchId: "Riyadh North",
  }),
  ["src:facebook-instagram", "medium:click-to-whatsapp", "branch:riyadh-north"],
);

{
  const seen = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    seen.push(url);
    if (url.endsWith("/conversations/700")) {
      return new Response(
        JSON.stringify({ custom_attributes: { attribution_source: "instagram" } }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (url.endsWith("/conversations/700/labels")) {
      return new Response(JSON.stringify({ payload: ["sales", "src:instagram"] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected Chatwoot URL: ${url}`);
  };
  assert.deepEqual(await getChatwootConversationCustomAttributes(700), {
    attribution_source: "instagram",
  });
  assert.deepEqual(await getChatwootConversationLabels(700), ["sales", "src:instagram"]);
  assert.ok(
    seen.every((url) => !url.includes("/conversations?")),
    "sync helpers must never enumerate conversations",
  );
}

console.log("Chatwoot attribution fixtures passed.");
