# Engosoft Attribution — Meta App Review readiness

App: **Engosoft Attribution** (App ID 1385923989778622), owned by the Engosoft
business portfolio (147679829607313, **verified**). Mode: Live.

**Copy-paste submission text for every field: [`META_APP_REVIEW_SUBMISSION.md`](./META_APP_REVIEW_SUBMISSION.md).**

This folder is the complete submission package for the two permissions that need
Meta Advanced Access before real customers' Messenger and Instagram messages can
be attributed:

- [`pages_messaging`](./pages_messaging.md)
- [`instagram_manage_messages`](./instagram_manage_messages.md)

Everything the reviewer needs is prepared. What remains is the submission itself in
the App Dashboard and Meta's human review.

## Readiness status (verified 2026-09-15 through the Graph API)

| Item | Status | Evidence / action |
|---|---|---|
| Business verification | READY | Business `verification_status = verified` |
| App owned by the verified business | READY | `owned_apps` lists Engosoft Attribution |
| App mode | READY | Live (webhooks deliver; app subscriptions active) |
| Privacy policy URL | READY | `https://engosoft.com/privacy` (HTTP 200) |
| Terms of service URL | VALUE READY | `https://engosoft.com/terms-and-conditions` (Engosoft's real terms, HTTP 200). Currently `https://www.facebook.com/`; API changes are disabled for this app, so it is set in App settings → Basic |
| Data deletion instructions URL | VALUE READY | `https://engosoft-insights-hub-production.up.railway.app/legal/data-deletion.html` (public HTTPS, 200, no login) |
| App icon (1024×1024) | FILE READY | `https://engosoft-insights-hub-production.up.railway.app/brand/engosoft-attribution-icon-1024.png` (official engosoft.com logo) |
| App category | VALUE READY | **Business and pages** (fallback **Business**) |
| Contact email | READY | Set |
| Pages | READY | Engosoft (1500414613618298), Engosoft Saudi Arabia (125287657625184), both owned by the business |
| Instagram professional accounts | READY | engosoftofficial ↔ Engosoft Page; engosoft_eng ↔ Engosoft Saudi Arabia |
| System user and Page tasks | READY | n8n-api-user has MANAGE_LEADS on both Pages and a Developer role on the app |
| Webhook callbacks | READY | Verify-token handshake and signature verification proven by the production self-test |
| App webhook subscriptions | READY | `page`: leadgen, messages, messaging_referrals, messaging_postbacks · `instagram`: messages, messaging_referral, messaging_postbacks · `whatsapp_business_account`: messages (added through the API on 2026-09-15; Meta verified the callbacks) |
| Page-level subscription for this app | AUTOMATIC | Done by the credential bootstrap as soon as a credential with `pages_manage_metadata` exists |
| Lead Ads Terms on the Pages | CHECK | Both Pages report `leadgen_tos_accepted = false` to the system user; accept at facebook.com/ads/leadgen/tos if Meta asks during review |
| Webhook handling code | READY | Page/Instagram `messaging` routed to the attribution listener; tests + signed self-test |
| Screencast | TO RECORD | Script below in each permission file (about 2 minutes each) |

App settings that say NEEDS UPDATE / NEEDS SETTING / NEEDS UPLOAD are App
Dashboard fields, fixed in **App settings → Basic** before submitting.

## What the app does (for every submission)

Engosoft runs Meta ads that start conversations (Click-to-Messenger,
Click-to-Instagram-Direct, Click-to-WhatsApp). Engosoft's sales team answers those
conversations in its own inbox (Chatwoot). The **Engosoft Attribution** app does not
send, read aloud, or reply to messages. It receives the webhook for an incoming
message only to record **which ad started the conversation** (the `referral.ad_id`),
matches it to the conversation already in Engosoft's inbox by the provider message
ID, and shows Engosoft's managers which campaigns, ads and creatives produce real
customers and revenue.

Data minimisation, enforced in code (`normalizeMetaMessageWebhook`):

- Kept: message ID, Page / Instagram account ID, timestamp, referral `ad_id`,
  `source`, `type`, click ID.
- Never stored: message text, attachments, sender name, profile picture, phone
  number or email.
- Retention: attribution evidence is deleted after
  `CHATWOOT_ATTRIBUTION_RETENTION_DAYS` (365 by default).
- Access: internal Engosoft staff only; nothing is sold or shared.

## Test instructions for the reviewer

1. Open the Engosoft Page (or @engosoftofficial on Instagram) and send any message
   from a test account. For the ad path, the reviewer can use the app's test user
   or send a message from an ad preview of any Engosoft Click-to-Messenger ad.
2. The message appears in Engosoft's inbox as usual (no reply is sent by this app).
3. Open the Insights Hub → Acquisition Performance → Data coverage → View
   technical details. The Messaging attribution readiness panel shows the
   delivery counted for Messenger or Instagram. For an ad-started conversation,
   the conversation's campaign, ad set, ad and creative are shown.
