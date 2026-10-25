# Permission request: `pages_messaging` (Advanced Access)

## Use case (paste into "How will your app use this permission?")

Engosoft Attribution records which Meta ad started a Messenger conversation with
the Engosoft Page. When a person taps an Engosoft Click-to-Messenger ad and sends a
message, Meta's `messages` / `messaging_referrals` webhook includes the ad's
`referral.ad_id`. Our server stores only that ad ID, the message ID, the Page ID and
the time, and links it to the conversation our sales team is already handling in
Engosoft's own inbox. Managers then see which campaigns, ads and creatives create
conversations that become enrolled students and paid revenue.

The app never sends messages, never replies, and never stores message text, names
or contact details. It exists only to measure advertising.

## Why the permission is needed

The ad referral is only available in the Messenger webhook for an incoming message.
Without `pages_messaging`, Meta delivers those webhooks only for people with a role
on the app, so real customers' ad referrals cannot be attributed and advertising
spend on Click-to-Messenger ads cannot be measured.

## Webhook fields requested (object `page`)

- `messages` (read `referral` on the first message; body ignored)
- `messaging_referrals` (ad referral when the thread is already open)
- `messaging_postbacks` (Get Started with referral)
- `leadgen` (already approved use: instant-form leads)

## Screen flow for the screencast (about 2 minutes)

1. Show Meta Ads Manager with an Engosoft Click-to-Messenger ad (ad name visible).
2. From a test Facebook account, open the ad preview and tap **Send message**;
   send "Hello".
3. Show the message arriving in Engosoft's inbox (Chatwoot). Point out that the app
   sent nothing.
4. Open Insights Hub → Acquisition Performance → Data coverage → View technical
   details → Messaging attribution readiness. Show the Messenger delivery counted.
5. Open Ads & creatives → Creatives and click the same creative: the conversation is
   attributed to the exact campaign, ad set, ad and creative.
6. Close by showing the stored evidence has no message text (Technical details
   show IDs only).

## Test setup

- Page: Engosoft (1500414613618298), admin access for the reviewer through a test
  user if requested.
- Test user: add one in App Dashboard → Roles → Test users, and give it a Page role
  for the recording.
- Insights Hub URL: https://engosoft-insights-hub-production.up.railway.app/acquisition
  (read-only, no login needed).

## Data usage and privacy (paste into data handling questions)

- Purpose: advertising measurement for Engosoft's own ads only.
- Data processed: message ID, Page ID, timestamp, referral ad ID, referral source
  and type.
- Not processed: message content, attachments, names, profile data, phone numbers,
  emails.
- Storage: Engosoft's PostgreSQL database on Railway; encrypted in transit (TLS).
- Retention: deleted after 365 days (configurable).
- Sharing: none; no third parties; no data sold.
- Deletion: see the data deletion instructions URL; requests are handled by
  Engosoft within 30 days.
