# Permission request: `instagram_manage_messages` (Advanced Access)

## Use case

Engosoft Attribution records which Meta ad started an Instagram Direct conversation
with Engosoft's professional accounts (@engosoftofficial, @engosoft_eng). When a
person taps an Engosoft Click-to-Instagram-Direct ad and sends a message, Meta's
Instagram messaging webhook includes the ad referral (`referral.ad_id`,
`ads_context_data`). Our server stores only the ad ID, the message ID, the Instagram
account ID and the time, and links it to the conversation Engosoft's team handles in
its own inbox. Managers see which ads bring Instagram conversations that become
customers.

The app never sends or reads out messages and never stores message text, usernames
or contact details.

## Why the permission is needed

Instagram ad referrals are only delivered in the messaging webhook for incoming
Direct messages. Without Advanced Access, only app-role users' messages are
delivered, so real customers' ad-started conversations cannot be measured.

## Webhook fields requested (object `instagram`)

- `messages` (read `referral` on the first message; body ignored)
- `messaging_referral`
- `messaging_postbacks`

## Screen flow for the screencast (about 2 minutes)

1. Show Ads Manager with an Engosoft ad whose destination includes Instagram Direct.
2. From a test Instagram account, open the ad and tap **Send message**; send "Hi".
3. Show the conversation in Engosoft's inbox (no reply sent by this app).
4. Insights Hub → Acquisition Performance → Data coverage → View technical details →
   Messaging attribution readiness: the Instagram delivery is counted.
5. Show the attributed campaign, ad set, ad and creative for that conversation.

## Test setup

- Instagram professional account: @engosoftofficial, linked to the Engosoft Page.
- Test user with an Instagram tester role (App Dashboard → Roles → Instagram testers).
- Insights Hub URL: https://engosoft-insights-hub-production.up.railway.app/acquisition

## Data usage and privacy

Same as `pages_messaging`: advertising measurement only; IDs and referral data only;
no message content or personal data; 365-day retention; no sharing; deletion on
request within 30 days.
