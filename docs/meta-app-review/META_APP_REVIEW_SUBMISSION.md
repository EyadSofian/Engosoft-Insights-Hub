# Engosoft Attribution — Meta App Review submission (copy-paste)

App: **Engosoft Attribution** · App ID `1385923989778622` · Business: انجو سوفت للتدريب والتوظيف
(`147679829607313`, verified) · Mode: Live.

Everything below is final text. Paste each block into the matching App Dashboard field.

---

## Part A — App settings → Basic (before submitting)

Meta blocks changing these through the API for this app ("Changing app settings through API
calls has been disabled"), so they are set once in the dashboard.

| Field | Value |
|---|---|
| Display name | `Engosoft Attribution` (unchanged) |
| Contact email | unchanged |
| Privacy policy URL | `https://engosoft.com/privacy` (already set; public, HTTP 200) |
| Terms of Service URL | `https://engosoft.com/terms-and-conditions` (replace `https://www.facebook.com/`) |
| User data deletion | Choose **Data deletion instructions URL** → `https://engosoft-insights-hub-production.up.railway.app/legal/data-deletion.html` |
| App icon (1024×1024) | Download `https://engosoft-insights-hub-production.up.railway.app/brand/engosoft-attribution-icon-1024.png` and upload (official Engosoft logo from engosoft.com, centred on white) |
| Category | **Business and pages** (if the dropdown in your dashboard does not list it, choose **Business**; do not pick Messenger bots — the app never replies) |
| App domains | `engosoft.com`, `engosoft-insights-hub-production.up.railway.app` |
| Website (Add platform → Website) | Site URL `https://engosoft.com/` |

Then **Save changes**.

Exact clicks: developers.facebook.com → My Apps → Engosoft Attribution → App settings → Basic →
fill the fields above → Save changes.

---

## Part B — App Review → Permissions and features

Request **Advanced Access** for:

1. `pages_messaging`
2. `instagram_manage_messages`

(Already used and not part of this submission: `leads_retrieval`, `pages_manage_metadata`,
`pages_show_list`, `pages_read_engagement`, `ads_read`, `business_management`.)

### B1. `pages_messaging`

**"Tell us how you're using this permission" (paste):**

> Engosoft is a professional training company that advertises its courses on Facebook with
> Click-to-Messenger ads. Engosoft Attribution is Engosoft's own internal advertising-measurement
> app. When a person taps an Engosoft Click-to-Messenger ad and sends a message to the Engosoft
> Page, the Messenger webhook contains the ad referral (`referral.ad_id`, `source: ADS`). Our
> server stores only that ad ID together with the Page ID, the message ID and the time, and links
> it to the conversation that Engosoft's sales team already handles in Engosoft's own inbox.
> Engosoft's managers then see which campaigns, ads and creatives start conversations that become
> enrolled students and paid revenue, so advertising budget goes to ads that produce real
> customers.
>
> The app never sends, replies to, or reads out messages. It never stores message text,
> attachments, names, profile pictures, phone numbers or email addresses.

**"How does this permission benefit people using your app?" (paste):**

> People who message Engosoft from an ad reach the right course advisor faster, because Engosoft
> can see which course and campaign the conversation came from and invest in the ads that actually
> help people find the training they need, instead of ads that only produce cheap clicks.

**Webhook fields used (object `page`):** `messages`, `messaging_referrals`, `messaging_postbacks`
(plus the already-approved `leadgen`).

**Platforms:** Web (server-to-server webhooks). No Facebook Login on the web.

### B2. `instagram_manage_messages`

**"Tell us how you're using this permission" (paste):**

> Engosoft advertises its training courses on Instagram with ads whose destination is Instagram
> Direct. Engosoft Attribution is Engosoft's internal advertising-measurement app. When a person
> taps an Engosoft ad and sends a Direct message to @engosoftofficial or @engosoft_eng, the
> Instagram messaging webhook includes the ad referral (`referral.ad_id`, `ads_context_data`). Our
> server stores only the ad ID, the Instagram account ID, the message ID and the time, and links it
> to the conversation Engosoft's team handles in its own inbox. Managers see which ads produce
> Instagram conversations that become customers.
>
> The app never sends or reads out messages and never stores message text, usernames, profile data
> or contact details.

**"How does this permission benefit people using your app?" (paste):**

> Engosoft can put its advertising into the Instagram ads that genuinely help people find the right
> course, and route Direct messages from those ads to the matching course advisor.

**Webhook fields used (object `instagram`):** `messages`, `messaging_referral`,
`messaging_postbacks`.

---

## Part C — Data handling questions (paste the same answers for both permissions)

| Question | Answer |
|---|---|
| Do you share or sell data with third parties? | No. Data is used only by Engosoft staff for Engosoft's own advertising measurement. |
| What data do you access? | Webhook metadata for incoming messages: message ID, Page / Instagram account ID, timestamp, ad referral (ad ID, source, type). |
| Do you store message content? | No. Message text, attachments, names, profile pictures, phone numbers and emails are discarded before storage. |
| Where is it stored? | Engosoft's PostgreSQL database hosted on Railway; encrypted in transit (TLS). Access is restricted to Engosoft administrators. |
| How long is it kept? | Automatically deleted after 365 days. |
| How can a person request deletion? | `https://engosoft-insights-hub-production.up.railway.app/legal/data-deletion.html` — requests through engosoft.com/contact-us are completed within 30 days. |
| Data processors / service providers | Railway (hosting). No other processors. |
| Responsible for data security | Engosoft (the business portfolio owner). |
| Do you use the data for tracking across apps or for profiling? | No. Only aggregate measurement of Engosoft's own ads. |

---

## Part D — Reviewer instructions (paste into "Testing instructions")

> **What the app does:** it records which Engosoft ad started a Messenger / Instagram Direct
> conversation. It has no user-facing login and never sends a message.
>
> **Steps to verify (about 3 minutes):**
> 1. From your test Facebook account, open the Engosoft Page
>    (https://www.facebook.com/1500414613618298) and send any message. For Instagram, send a
>    Direct message to @engosoftofficial from your test Instagram account.
> 2. Engosoft's team inbox receives the message as usual. The Engosoft Attribution app sends no
>    reply (it has no messaging send capability).
> 3. Open https://engosoft-insights-hub-production.up.railway.app/acquisition?section=coverage
>    (no login required, read-only).
> 4. Click **View technical details** → **Messaging attribution readiness**. The Messenger (or
>    Instagram) card shows the delivery counted under "Real deliveries". For a conversation that
>    started from an Engosoft ad, the campaign, ad set, ad and creative are resolved.
> 5. The panel shows identifiers only — no message text or personal data is stored.
>
> **Test assets:** Page "Engosoft" (1500414613618298); Instagram professional account
> @engosoftofficial (17841402680887554), linked to that Page.

---

## Part E — Screencast (one video per permission, 90–120 seconds)

Record at 1080p, English UI, no audio required (add captions).

**`pages_messaging`**
1. (0:00) Title card: "Engosoft Attribution — measuring which ads start Messenger conversations".
2. (0:10) Ads Manager: show an Engosoft Click-to-Messenger ad name and its ad ID.
3. (0:25) Test Facebook account → Engosoft Page → **Send message** from the ad preview → type "Hello".
4. (0:40) Engosoft's inbox: the conversation arrives; point out no reply came from the app.
5. (0:55) Insights Hub → Acquisition Performance → Data coverage → **View technical details** →
   Messaging attribution readiness: Messenger delivery counted.
6. (1:15) Ads & creatives → open the creative: the conversation attributed to that exact campaign,
   ad set, ad and creative.
7. (1:35) Show that stored evidence has IDs only (no text). End card.

**`instagram_manage_messages`**
Same flow with an Engosoft ad whose destination includes Instagram Direct, the @engosoftofficial
account, and the Instagram card in the readiness panel.

## Part F — Screenshots to attach

1. App settings → Basic after Part A (privacy, terms, data deletion, icon visible).
2. Webhooks page showing `page` fields `leadgen, messages, messaging_referrals, messaging_postbacks`
   and `instagram` fields `messages, messaging_referral, messaging_postbacks` with the callback
   verified.
3. Insights Hub → Data coverage → View technical details → Messaging attribution readiness
   (self-test passed for Messenger and Instagram).
4. The data deletion instructions page.
5. The Creative detail panel showing a conversation attributed to campaign / ad set / ad / creative.

## Part G — What success looks like

- Meta approves Advanced Access for both permissions.
- Within minutes of approval (and with the Attribution credential in Railway), the automatic
  bootstrap subscribes the Pages to the messaging fields; the Data coverage panel changes Messenger
  from "Infrastructure ready / Meta approval pending" to "Connected" on the first real ad-started
  message, with no code change and no manual step.
