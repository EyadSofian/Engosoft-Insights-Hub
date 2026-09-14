# Chatwoot Attribution Production Runtime Audit

Audit timestamp: **2026-09-14 00:07 UTC / 03:07 Africa/Cairo**  
Frozen reporting window: **`2026-09-01T00:00:00Z <= first_touch_at < 2026-09-14T00:00:00Z`**  
Production application: `https://engosoft-insights-hub-production.up.railway.app`  
Scope: Chatwoot → Meta → attribution projection → Chatwoot attributes/labels → Insights dashboard

> This is a runtime audit, not a completion claim. The mandatory real CTWA
> acceptance test is blocked because the accessible Meta accounts contain **zero
> currently active CTWA ads**. No paused campaign was reactivated and no customer
> message was sent during this audit.

| Runtime component     | Status | Production evidence                                                                                                                      |
| --------------------- | -----: | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Chatwoot Webhook      |   PASS | 834 events received, 0 failed, 0 pending; last event processed at `2026-09-14T00:02:13Z`.                                                |
| CTWA Referral Capture |   FAIL | 0/837 scanned inbound WhatsApp messages expose referral data; Chatwoot 4.12.1 drops it while creating the message.                       |
| Meta Data Freshness   |   FAIL | Sync state says success, but 22/192 active ad IDs and 31/192 active creative-ad rows are absent; stored post/source ID coverage is zero. |
| Meta ID Matching      |   FAIL | No real `referral.source_id` reached the service, and post/effective-story IDs are not persisted locally.                                |
| Campaign Attribution  |   FAIL | 0/91 conversations have an attribution method other than `unknown`; 0 have campaign/ad IDs.                                              |
| Custom Attributes     |   FAIL | 15 definitions exist, but only method/confidence were written on 50/91 conversations; campaign attributes are 0/91.                      |
| Conversation Labels   |   FAIL | Production is `attributes` mode and managed campaign labels are not implemented; 0 managed labels were found.                            |
| Dashboard Attribution |   FAIL | 91/91 are Unknown; campaign spend, cost per conversation, CPA, and ROAS are unavailable.                                                 |
| CRM/Revenue Join      |   FAIL | 35/91 match CRM and 15 are Won, but 0/91 have attributed revenue; exact CRM campaign/ad IDs are currently discarded by `crmMatch()`.     |

## 1. Executive diagnosis

The webhook and durable database pipeline are running. The attribution evidence is
lost **before** the Engosoft parser receives it.

The deployed Chatwoot instance reports version **4.12.1**. In that exact version,
`Whatsapp::IncomingMessageWhatsappCloudService` extracts the WhatsApp Cloud
`entry[0].changes[0].value` payload, including its `messages` array. However,
`Whatsapp::IncomingMessageBaseService#create_message` creates
`content_attributes` only from `external_echo` and
`in_reply_to_external_id`; it never copies `message[:referral]`. The relevant
upstream source is:

- <https://github.com/chatwoot/chatwoot/blob/v4.12.1/app/services/whatsapp/incoming_message_whatsapp_cloud_service.rb>
- <https://github.com/chatwoot/chatwoot/blob/v4.12.1/app/services/whatsapp/incoming_message_base_service.rb#L177-L191>

This proves case **B** for the deployed WhatsApp Cloud code path: when Meta sends a
CTWA referral, Chatwoot 4.12.1 discards it while materializing the Chatwoot message.
Consequently, it is neither stored in Chatwoot nor included in Chatwoot's outgoing
webhook. Chatwoot's open upstream issue #12560 describes the same missing Cloud API
behavior and targets a future v4.22.0 milestone:
<https://github.com/chatwoot/chatwoot/issues/12560>.

For any particular historical conversation, this does **not** prove whether Meta
sent referral data or whether the conversation was organic. The original provider
payload is already gone. A real first-message CTWA test after referral preservation
is required to distinguish A from F per conversation.

There are four additional independent defects:

1. `meta_ad_creatives` fetches `effective_object_story_id` from Graph API but
   `normalizeMetaGraphAd()`/`storageRow()` discard it. Local post/source ID coverage
   is therefore 0 even though the live active ads expose 154 distinct story IDs.
2. The Meta creative cache is an on-demand partial catalog, not a complete
   active/recent ad catalog. The latest sync metadata says `requested=1`,
   `fetched=1`, while 31 active ads have no creative row.
3. Production is deliberately still in `CHATWOOT_ATTRIBUTION_SYNC_MODE=attributes`.
   This is the direct reason no attribution labels are written. Switching to
   `both` now would still be wrong because all current attribution is Unknown.
4. Managed labels currently support only `src:`, `medium:`, and `branch:`. There
   is no `campaign:` label implementation, so even a resolved campaign would not
   satisfy the conversation-list requirement.

## 2. Production configuration

Repository and Railway were inspected with the CLI. No secret values were printed.

| Item                                   | Runtime value                              |
| -------------------------------------- | ------------------------------------------ |
| Local HEAD                             | `bb463423dfa83fbce0565e823513589089ad14be` |
| `origin/main`                          | `bb463423dfa83fbce0565e823513589089ad14be` |
| Railway deployment                     | `bd55658e-3b0a-4474-b19d-61e87e676d3d`     |
| Railway deployed commit                | `bb463423dfa83fbce0565e823513589089ad14be` |
| Branch / state                         | `main` / `SUCCESS`, instance `RUNNING`     |
| `CHATWOOT_ATTRIBUTION_SYNC_MODE`       | `attributes`                               |
| `CHATWOOT_LEGACY_WEBHOOK_ENABLED`      | `true`                                     |
| `CHATWOOT_WEBHOOK_MAX_AGE_SECONDS`     | `300`                                      |
| `CHATWOOT_ATTRIBUTION_BRANCH_MAP_JSON` | not configured                             |
| `CHATWOOT_WEBHOOK_SECRET`              | configured: **false**                      |
| `CHATWOOT_ATTRIBUTION_TOKEN_SECRET`    | configured: **true**                       |
| `META_ACCESS_TOKEN`                    | configured: **true**                       |

The deployed revision exactly matches the latest `main` revision.

The account still uses the legacy shared-secret webhook path. Native Chatwoot HMAC
verification is not active because `CHATWOOT_WEBHOOK_SECRET` is absent. This is a
security rollout gap, not the cause of missing referral evidence.

## 3. Database funnel counts

The application stores `meta_ads` and `meta_ad_creatives` as datasets inside
`dashboard_rows`; they are not standalone physical PostgreSQL tables. Attribution
uses three relational tables: `chatwoot_event_inbox`,
`chatwoot_attribution_touches`, and `chatwoot_conversation_attribution`.

| Funnel step                              | Count | Interpretation                                                                                    |
| ---------------------------------------- | ----: | ------------------------------------------------------------------------------------------------- |
| Total conversations                      |    91 | Frozen window above.                                                                              |
| Inbound messages received/projected      |   327 | Distinct inbound message IDs that produced touches.                                               |
| Messages containing attribution evidence |     0 | No referral, CTWA CLID, UTM, referrer, or signed token.                                           |
| Meta referral evidence                   |     0 | `referral_source_id` or `ctwa_clid`.                                                              |
| Referral source ID present/resolved      |     0 | No source ID reached enrichment.                                                                  |
| Meta ad resolved                         |     0 | No touch has an ad ID.                                                                            |
| Campaign resolved                        |     0 | No touch has a campaign ID.                                                                       |
| Chatwoot attributes written              |    50 | Only `attribution_method=unknown` and `attribution_confidence=unknown`; not campaign attribution. |
| Chatwoot campaign attributes written     |     0 | `attribution_campaign`/Meta ID values absent.                                                     |
| Chatwoot managed labels written          |     0 | Expected in `attributes` mode.                                                                    |

The event inbox health snapshot is healthy as transport: 834 total received, 0
failed, 0 pending, 34 duplicate deliveries recorded. Duplicate delivery accounting
works, but real CTWA idempotency remains unproven until the real test is replayed.

## 4. Breakdown of the dashboard conversations

The browser tab had an older in-memory render of 89 rows. Direct API and PostgreSQL
queries at the frozen cutoff returned 91 because live events arrived during the
audit. The attribution result is unchanged.

### Summary

| Metric                                  |  Count |
| --------------------------------------- | -----: |
| Total conversation attribution rows     |     91 |
| Attributed conversations                |      0 |
| Unknown conversations                   |     91 |
| Unknown percentage                      | 100.0% |
| Unique contacts                         |     90 |
| CRM matched                             |     35 |
| Won CRM leads                           |     15 |
| Conversations with revenue              |      0 |
| Conversations with `referral_source_id` |      0 |
| Conversations with `ctwa_clid`          |      0 |
| Conversations with `campaign_id`        |      0 |
| Conversations with `ad_id`              |      0 |
| Conversations with `campaign_name`      |      0 |
| Conversations with `branch_id`          |      0 |

### Attribution methods

| Method                  | Conversations |
| ----------------------- | ------------: |
| `meta_referral`         |             0 |
| `signed_tracking_token` |             0 |
| `utm`                   |             0 |
| `referrer`              |             0 |
| `inbox_mapping`         |             0 |
| `manual`                |             0 |
| `unknown`               |            91 |

Source, platform, and medium are empty/Unknown for all 91 rows:

| Dimension | Stored value    | Conversations |
| --------- | --------------- | ------------: |
| Source    | empty / Unknown |            91 |
| Platform  | empty / Unknown |            91 |
| Medium    | empty / Unknown |            91 |

The inbox split is
56 WhatsApp conversations, 21 Facebook Page conversations, and 14 API-channel
conversations, for 35 unsupported non-WhatsApp rows in this WhatsApp-attribution
view.

### Derived Unknown reasons

These reasons are an audit-only deterministic classification. The current schema
does not persist an `unknown_reason` field.

| Proposed reason               | Conversations | Rule used                                                                          |
| ----------------------------- | ------------: | ---------------------------------------------------------------------------------- |
| `unsupported_channel`         |            35 | Inbox is not one of the four WhatsApp Cloud inboxes.                               |
| `historical_evidence_missing` |            29 | Latest WhatsApp touch came from history backfill and contains no durable evidence. |
| `no_referral_received`        |            27 | Live WhatsApp webhook/API projection contains no referral evidence.                |

Do not relabel `no_referral_received` as `organic_direct`: the current Chatwoot
version discards referral, so the evidence is insufficient to make that claim.

### Current dashboard answers

| Business question                               | Current evidence-backed answer                                                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Facebook conversations                          | 0 attributed; channel alone must not be presented as paid Facebook attribution.                                         |
| Instagram conversations                         | 0 attributed.                                                                                                           |
| Exact campaign/ad                               | None resolved.                                                                                                          |
| Inbox/branch                                    | Inbox is stored; branch is unresolved for all 91 because the reviewed map is absent.                                    |
| Campaigns producing real WhatsApp conversations | Not measurable yet.                                                                                                     |
| Unknown and why                                 | UI shows 91 generic Unknown; the audit derives 35 unsupported, 29 historical-evidence-missing, and 27 live-no-referral. |
| Spend / cost per real conversation              | Unavailable without exact campaign IDs.                                                                                 |
| Won / revenue / CPA / ROAS                      | 15 Won phone matches; attributed revenue, CPA, and ROAS are unavailable.                                                |

## 5. Chatwoot payload findings

The Chatwoot API was scanned without logging phone numbers, names, emails, bodies,
or tokens:

- WhatsApp conversations scanned: **56**
- messages scanned: **2,384**
- inbound messages scanned: **837**
- inbound messages with a `content_attributes` object: **837**
- messages with any referral path: **0**
- messages with `ctwa_clid`: **0**
- messages with referral/source ID: **0**

### 10 recent Unknown WhatsApp conversations

`type=0` is Chatwoot's incoming message type. `—` means absent. Every selected
method is `unknown` because no native referral, signed token, UTM, referrer, or
configured inbox map was present.

| Conversation | Inbox | Event             | Type | `content_attributes` | Keys                                     | referral | nested referral | source ID/type | CTWA | URL pattern | Method / reason         |
| -----------: | ----: | ----------------- | ---: | -------------------: | ---------------------------------------- | -------: | --------------: | -------------- | ---: | ----------- | ----------------------- |
|        63005 |    27 | `message_created` |    0 |                  yes | none                                     |       no |              no | — / —          |   no | —           | `unknown` / no evidence |
|        38416 |    25 | `message_created` |    0 |                  yes | none                                     |       no |              no | — / —          |   no | —           | `unknown` / no evidence |
|        76521 |    24 | `message_created` |    0 |                  yes | `in_reply_to`, `in_reply_to_external_id` |       no |              no | — / —          |   no | —           | `unknown` / no evidence |
|       153297 |    24 | `message_created` |    0 |                  yes | none                                     |       no |              no | — / —          |   no | —           | `unknown` / no evidence |
|       155243 |    24 | `message_created` |    0 |                  yes | none                                     |       no |              no | — / —          |   no | —           | `unknown` / no evidence |
|       156682 |    25 | `message_created` |    0 |                  yes | none                                     |       no |              no | — / —          |   no | —           | `unknown` / no evidence |
|       155011 |    24 | `message_created` |    0 |                  yes | none                                     |       no |              no | — / —          |   no | —           | `unknown` / no evidence |
|       156680 |    25 | `message_created` |    0 |                  yes | none                                     |       no |              no | — / —          |   no | —           | `unknown` / no evidence |
|        70030 |    24 | `message_created` |    0 |                  yes | none                                     |       no |              no | — / —          |   no | —           | `unknown` / no evidence |
|        67405 |    24 | `message_created` |    0 |                  yes | none                                     |       no |              no | — / —          |   no | —           | `unknown` / no evidence |

### 10 likely-CTWA candidates

No conversation can be proven CTWA from its payload. These ten were selected only
because an agent-created label looked source-related. That label is a triage hint,
not attribution evidence.

| Conversation | Inbox | Event             | Type | `content_attributes` keys                | referral/source ID/CTWA | URL | Method / reason                |
| -----------: | ----: | ----------------- | ---: | ---------------------------------------- | ----------------------- | --- | ------------------------------ |
|        63005 |    27 | `message_created` |    0 | none                                     | absent                  | —   | `unknown` / label is not proof |
|       155011 |    24 | `message_created` |    0 | none                                     | absent                  | —   | `unknown` / label is not proof |
|        70030 |    24 | `message_created` |    0 | none                                     | absent                  | —   | `unknown` / label is not proof |
|        51799 |    27 | `message_created` |    0 | `in_reply_to`, `in_reply_to_external_id` | absent                  | —   | `unknown` / label is not proof |
|       114254 |    27 | `message_created` |    0 | none                                     | absent                  | —   | `unknown` / label is not proof |
|        54835 |    27 | `message_created` |    0 | `in_reply_to`, `in_reply_to_external_id` | absent                  | —   | `unknown` / label is not proof |
|        83189 |    24 | `message_created` |    0 | none                                     | absent                  | —   | `unknown` / label is not proof |
|        40003 |    24 | `message_created` |    0 | none                                     | absent                  | —   | `unknown` / label is not proof |
|        40027 |    24 | `message_created` |    0 | none                                     | absent                  | —   | `unknown` / label is not proof |
|       133732 |    27 | `message_created` |    0 | none                                     | absent                  | —   | `unknown` / label is not proof |

Case assessment:

| Case                                                     | Result                                                                                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| A. Meta did not send referral                            | Not decidable for historical rows; original provider payload is gone.                                                            |
| B. Chatwoot strips referral                              | **Proven for Chatwoot 4.12.1 WhatsApp Cloud code path.**                                                                         |
| C. Chatwoot stores it but omits it from outgoing webhook | Not the primary case here; API storage scan is also empty.                                                                       |
| D. Engosoft parser reads the wrong location              | Not the current failure. It checks common nested Chatwoot paths, but should add flat/raw paths when the capture fix is selected. |
| E. Referral arrives but Meta enrichment fails            | Not reached in production because zero source IDs arrive. Local enrichment readiness is incomplete.                              |
| F. Conversation is genuinely organic/direct              | Possible for individual rows, but cannot be asserted from this evidence.                                                         |

## 6. Real CTWA test trace

The live Meta Graph API v25.0 audit found seven accessible ad accounts, four active
accounts, 22 active campaigns, 61 active ad sets, and 192 active ads. It found
**zero active CTWA ads**. Across all 2,954 inspected ad sets, 77 were CTWA-capable:
71 are `CAMPAIGN_PAUSED`, four are `WITH_ISSUES`, and two are `PAUSED`.

The most recent safe candidate is recorded below for activation by an authorized
ads operator; it was **not** represented as active:

| Field                | Candidate value                                                    |
| -------------------- | ------------------------------------------------------------------ |
| Meta account         | `act_405972484493798`                                              |
| Campaign             | `120253347797530712` — `cfm-Engagement-webinar-21/7/26` (`PAUSED`) |
| Ad set               | `120253348248890712` — `egypt` (`CAMPAIGN_PAUSED`)                 |
| Ad                   | `120253348248880712` — `webinar-cfm1` (`CAMPAIGN_PAUSED`)          |
| Creative             | `1711870140085925`                                                 |
| Effective story/post | `1500414613618298_1337591958482562`                                |
| Destination          | `MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP`                    |

Reactivating this paid campaign could resume spend and is outside an audit. The
mandatory acceptance trace therefore correctly stops at step 1:

| End-to-end step                           |             Result | Evidence                                             |
| ----------------------------------------- | -----------------: | ---------------------------------------------------- |
| Known currently active CTWA Meta ad       | **FAIL / BLOCKED** | Live Graph inventory returned 0 active CTWA ads.     |
| One controlled click and WhatsApp message |            NOT RUN | No qualifying active ad; no message was sent.        |
| Chatwoot incoming message                 |            NOT RUN | Depends on controlled click.                         |
| Chatwoot outgoing webhook                 |            NOT RUN | Depends on incoming message.                         |
| `chatwoot_event_inbox`                    |            NOT RUN | No real test event ID exists.                        |
| `normalizeChatwootAttribution`            |            NOT RUN | No real test payload exists.                         |
| `chatwoot_attribution_touches`            |            NOT RUN | No real test touch exists.                           |
| `enrichMeta`                              |            NOT RUN | No real `source_id` exists.                          |
| `chatwoot_conversation_attribution`       |            NOT RUN | No real test projection exists.                      |
| Chatwoot custom attributes                |            NOT RUN | Attribution not resolved.                            |
| Chatwoot managed labels                   |            NOT RUN | Attribution not resolved; sync remains `attributes`. |
| Attribution dashboard                     |            NOT RUN | No real test conversation exists.                    |

This audit must remain open until an ads operator supplies one active CTWA ad (or
authorizes and performs activation), followed by explicit confirmation immediately
before the controlled WhatsApp message is sent.

## 7. Meta dataset freshness

### Stored datasets

| Dataset             |   Rows | Date min → max          | Accounts | Campaign IDs | Ad-set IDs | Ad IDs | Creative IDs | Post/source IDs | State / synced at                    |
| ------------------- | -----: | ----------------------- | -------: | -----------: | ---------: | -----: | -----------: | --------------: | ------------------------------------ |
| `meta_ads`          | 16,251 | 2026-08-04 → 2026-09-14 |       10 |        2,365 |        425 |  1,268 |          390 |               0 | success / `2026-09-13T21:15:00.152Z` |
| `meta_ad_creatives` |    523 | no record dates         |        5 |           71 |        171 |    523 |          370 |               0 | success / `2026-09-13T23:32:24.418Z` |

All `source_updated_at` values are null in both datasets, so row-level staleness
cannot be measured from that column. `meta_ads` reports a rolling refresh window of
2026-09-07 through 2026-09-14 and workflow ID `imS2VrWslYHhnFNn`. Its metadata
`contentHash` is the SHA-256 of empty content, which makes that integrity field
non-useful even though the row data exists.

### Live Meta versus local coverage

| Entity                                    | Live active | Local exact-ID matches | Missing | Coverage |
| ----------------------------------------- | ----------: | ---------------------: | ------: | -------: |
| Campaigns                                 |          22 |                     21 |       1 |    95.5% |
| Ad sets                                   |          61 |                     56 |       5 |    91.8% |
| Ads in `meta_ads`                         |         192 |                    170 |      22 |    88.5% |
| Ads in `meta_ad_creatives`                |         192 |                    161 |      31 |    83.9% |
| Live distinct `effective_object_story_id` |         154 |               0 stored |     154 |       0% |

Thirty-three active ads have no local fact newer than 2026-09-12. This can include
active ads with no recent delivery, so it is not by itself proof of a failed
insights pull. It is proof that `meta_ads` is unsuitable as the only identity
catalog. The separate creative/entity catalog must be complete.

Missing active campaign ID:

- `120250559309820718`

Missing active ad-set IDs:

- `120250559309810718`
- `120250559309930718`
- `120250559338140718`
- `120250559309940718`
- `120252642602150712`

Missing active ad IDs in `meta_ads`:

- `120250559309880718`
- `120250559309830718`
- `120250559344850718`
- `120250559309900718`
- `120250559344840718`
- `120250559309890718`
- `120250559309870718`
- `120250559344860718`
- `120250559309850718`
- `120250480142480718`
- `120250480142470718`
- `120250480142490718`
- `120250194647450718`
- `120254045879950712`
- `120254045879960712`
- `120253297273300712`
- `120252682969970712`
- `120252642602160712`
- `120251012262780457`
- `120251008218390457`
- `120251012262760457`
- `120251009069570457`

The creative catalog is missing those same 22 active ad IDs plus these nine:

- `120254518158910712`
- `120254518158870712`
- `120254518158840712`
- `120254518134960712`
- `120254518158880712`
- `120244394719450712`
- `120243480349080712`
- `120238231885010712`
- `120238231166960712`

The upstream fix is not to force zero-delivery ads into a daily insight fact table.
It is to add a complete, ID-first active/recent entity sync for Campaign → Ad Set →
Ad → Creative, persist `effective_object_story_id`/post/source IDs, and have
`enrichMeta()` read that catalog. The n8n workflow itself was not mutated in this
audit; Railway exposes its workflow ID in metadata but no n8n API credential.

## 8. `source_id` mapping matrix

There are **zero real production CTWA payload samples** because Chatwoot strips the
provider referral. A fabricated mapping matrix would violate the audit requirement.

| Real referral `source_id`      | Ad ID match | Creative ID match | Post/story ID match | Campaign resolved |
| ------------------------------ | ----------: | ----------------: | ------------------: | ----------------: |
| No production sample available |         N/A |               N/A |                 N/A |               N/A |

Current matching readiness, which is not a substitute for the real matrix:

| Candidate representation        | Local support                                         | Defect                                                                                                                |
| ------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Ad ID                           | `enrichMeta()` first checks `meta_ads` exact ad IDs   | 22/192 active IDs missing from facts.                                                                                 |
| Creative ID                     | It checks creative ID, then uses creative row's ad ID | Creative catalog covers only 161/192 active ads.                                                                      |
| Effective story/post ID         | Code lists several post/source keys                   | Storage writes none of those keys; match is impossible.                                                               |
| Raw/flat Chatwoot referral keys | Not fully supported                                   | Parser should accept known nested, flat Twilio, and selected raw-capture shapes after the capture boundary is chosen. |

The real acceptance test must record the received `source_id` and test that same
value, in order, against ad ID, creative ID, effective story/post ID, and stored
source/post IDs. Names must never be the primary join.

## 9. Label and custom-attribute status

Chatwoot's UI/API confirms all 15 conversation custom-attribute definitions exist.
Across the 91 conversations:

- any managed attribution attribute: 50
- `attribution_method`: 50
- `attribution_confidence`: 50
- campaign attribute: 0
- Meta campaign/ad-set/ad ID attributes: 0
- managed labels: 0
- conversations with agent-created/manual labels: 36 (preserved; not treated as proof)

Current code defines managed prefixes as `src:`, `medium:`, and `branch:`. The
production sync mode is `attributes`, so the label-writing branch is never entered.

Live cardinality is reasonable for managed campaign labels: 22 active campaign IDs
and 54 recent campaign IDs in the local 30-day dataset. Do not pre-create labels for
all 2,365 historical IDs. Create a campaign label only when a conversation is
actually attributed, limited to active/recent catalog entries.

Proposed deterministic label policy:

- `src:facebook` or `src:instagram`
- `campaign:<normalized-short-name>-<last-6-campaign-id>`
- `branch:<branch-id>` when a reviewed inbox/branch map exists
- keep `medium:` only if agents use it operationally

Slug algorithm: Unicode NFKD normalize; lowercase; retain Unicode letters/numbers;
replace other runs with `-`; trim; cap the name component at 32 characters; append
the final six digits of the exact campaign ID. The ID suffix prevents collisions
after truncation or similarly named campaigns. Full names and IDs stay in custom
attributes.

The label write must remain GET existing → remove only Engosoft managed namespaces
→ merge new managed labels with every manual label → POST the final array. Add
`campaign:` to the managed namespace list only when this implementation is ready.

## 10. Exact root causes

1. **Referral loss at Chatwoot:** version 4.12.1 does not persist WhatsApp Cloud
   `message.referral` into message `content_attributes`.
2. **No available real test source:** there are zero active CTWA ads in the Meta
   accounts accessible to the configured token.
3. **Partial Meta identity catalog:** daily `meta_ads` facts miss 22 active ad IDs;
   `meta_ad_creatives` misses 31 active ads.
4. **Post/source IDs dropped in the app:** Graph API asks for
   `effective_object_story_id`, but the normalized type and storage row omit it.
5. **Labels intentionally disabled:** production sync mode is `attributes`, not
   `both`.
6. **Campaign label absent:** current managed label generator has no `campaign:`
   namespace or campaign input.
7. **Branch mapping absent:** the branch-map configuration is empty, so branch
   attribution is impossible unless another evidence source supplies it.
8. **CRM marketing IDs ignored by projection:** `crmMatch()` returns lead IDs,
   status, Won/Lost, and phone-matched revenue only; it drops exact CRM campaign/ad
   IDs already present in `dashboard_rows`.
9. **Unknown reason is not modeled:** every failure becomes generic `unknown`, which
   prevents operational diagnosis in the dashboard.
10. **Revenue join not demonstrated:** 35 conversations match CRM and 15 are Won,
    but none have revenue. The current phone-only accounting join may have no match;
    this audit does not invent revenue.

### Historical conversations

History backfill produced 194 message touches across 43 conversations. Four of
those conversations later also received live events. Native referral/UTM/token
evidence is zero.

The CRM dataset does contain deterministic marketing IDs, and the phone join already
links 22 of the 43 historical conversations to CRM rows:

| Historical classification                | Conversations | Evidence rule                                                                |
| ---------------------------------------- | ------------: | ---------------------------------------------------------------------------- |
| Deterministically attributable candidate |            14 | CRM has exact campaign and ad IDs and the ad ID resolves in local Meta data. |
| Partially attributable candidate         |             3 | CRM has exact IDs, but the current local Meta catalog is incomplete.         |
| Genuinely unknown under strict ID rules  |            26 | No exact campaign/ad ID; names alone are not used.                           |

These 14/3 rows are **candidates**, not currently persisted attribution: all 43 are
still stored as `unknown`. A dry-run historical projector can use the exact CRM IDs
after the Meta catalog is fixed. It must record the CRM evidence origin and must not
fall back to campaign-name fuzzy matching.

## 11. Proposed fixes

1. Restore the evidence boundary first: patch/upgrade Chatwoot so the first
   WhatsApp Cloud message persists and emits its referral object.
2. Separate Meta delivery facts from the identity catalog. Keep daily insight rows
   for spend and create a complete active/recent ID catalog for enrichment.
3. Persist effective story/post/source IDs and prove the real `source_id`
   representation before selecting a matching branch.
4. Add exact CRM-ID historical attribution and explicit Unknown reasons without
   using names as a join key.
5. Implement source/campaign/branch labels behind a single-conversation canary,
   then enable `both` only after the controlled trace passes.
6. Extend the dashboard only from the persisted, reasoned attribution projection;
   leave spend, CPA, and ROAS blank where ID joins are not proven.

## 12. Files to modify

No broad fix was deployed during this audit. Implement in this order.

| System/file                                                                               | Required change                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chatwoot `app/services/whatsapp/incoming_message_base_service.rb`                         | Persist sanitized WhatsApp Cloud `message[:referral]` in `content_attributes.whatsapp.referral`.                                                                                                                                |
| Chatwoot `spec/services/whatsapp/incoming_message_whatsapp_cloud_service_spec.rb`         | Fixture-test storage and outgoing webhook visibility of CTWA fields.                                                                                                                                                            |
| Chatwoot deployment/version                                                               | Prefer a reviewed upstream release containing #12560; otherwise maintain a minimal patch against the exact deployed tag.                                                                                                        |
| `src/lib/types.ts`                                                                        | Add explicit `effectiveObjectStoryId`/post-source fields to the Meta creative type.                                                                                                                                             |
| `src/lib/meta-creatives.server.ts`                                                        | Normalize and persist `effective_object_story_id`, plus a complete active/recent catalog sync rather than only on-demand rows.                                                                                                  |
| n8n workflow `imS2VrWslYHhnFNn`                                                           | Keep daily facts, but add/trigger a separate complete ID catalog ingest; repair the empty-content hash metadata.                                                                                                                |
| `src/lib/chatwoot-attribution.server.ts`                                                  | Accept preserved nested/flat referral shapes; resolve exact ad → creative/post → campaign; add unknown reason; consume exact CRM campaign/ad IDs for history; add deterministic campaign labels while preserving manual labels. |
| `src/routes/api/attribution.summary.ts` and `src/routes/api/attribution.conversations.ts` | Expose Unknown-reason counts and exact ad/ad-set fields required by the UI.                                                                                                                                                     |
| `src/routes/attribution.tsx`                                                              | Show platform, campaign, ad, inbox/branch, and Unknown reason; keep spend/CPA/ROAS unavailable until exact campaign ID coverage exists.                                                                                         |
| Attribution unit/integration tests                                                        | Add Chatwoot payload fixtures, source-ID matrix fixtures, campaign slug collisions, manual-label preservation, replay idempotency, CRM exact-ID history, and dashboard Unknown reasons.                                         |

An independent Meta WhatsApp webhook capture before Chatwoot is a fallback only if
the self-hosted Chatwoot patch/upgrade cannot be delivered. It would require its own
signature verification, retention policy, idempotency, and conversation correlation,
so it should not be the first change.

## 13. Safe rollout plan

1. Export/backup the n8n workflow and add a full active/recent Meta entity catalog.
   Verify 100% live active Campaign/Ad Set/Ad/Creative ID coverage and non-zero
   effective-story/post ID coverage before changing attribution.
2. Patch or upgrade Chatwoot in staging so the first WhatsApp message persists
   `referral` and exposes it through the message API/outgoing webhook. Mask body and
   customer fields in diagnostic traces.
3. Keep Insights in `attributes` mode. Select one genuinely active CTWA ad. Record
   its exact account/campaign/ad-set/ad/creative/story IDs.
4. After explicit send confirmation, send one controlled lead and capture one
   correlation record through every end-to-end step.
5. Prove the received `source_id` representation with the exact mapping matrix. Run
   a duplicate webhook replay and verify one touch/projection only.
6. Write custom attributes to only the test conversation and confirm the exact ad,
   ad set, campaign, source, and confidence in Chatwoot.
7. Enable campaign-label code for only that conversation. Verify the expected
   `src:` and `campaign:` labels and that all prior manual labels remain.
8. Only then set `CHATWOOT_ATTRIBUTION_SYNC_MODE=both` for new conversations.
   Monitor webhook failures, unknown-reason rates, unresolved source IDs, Meta
   catalog coverage, and label errors. Roll back immediately to `attributes` on
   unexpected label mutation.
9. Run the historical exact-ID projector in dry-run mode. Review the 14 attributable
   and three partial candidates, then backfill only exact matches with an audit trail.
10. Investigate the 15 Won CRM matches with no revenue separately; do not block valid
    campaign attribution or synthesize revenue.

## 14. Before/after acceptance criteria

| Requirement                                 |                            Before |                Required after |
| ------------------------------------------- | --------------------------------: | ----------------------------: |
| Customer clicks a known active CTWA ad      |                           BLOCKED | PASS with recorded active IDs |
| Conversation enters Chatwoot                |                           NOT RUN |                          PASS |
| Usable referral evidence reaches Engosoft   |           FAIL in current traffic |                          PASS |
| Exact Meta ad resolved by ID                |                              FAIL |                          PASS |
| Exact ad set resolved by ID                 |                              FAIL |                          PASS |
| Exact campaign resolved by ID               |                              FAIL |                          PASS |
| Attribution persisted in PostgreSQL         |                  FAIL (`unknown`) |                          PASS |
| Chatwoot shows source + campaign            |                              FAIL |                          PASS |
| Dashboard shows conversation under campaign |                              FAIL |                          PASS |
| Spend/cost uses exact campaign ID           |                              FAIL |                          PASS |
| Real webhook replay is idempotent           |                        NOT PROVEN |                          PASS |
| Existing manual labels remain intact        | Not exercised with managed labels |                          PASS |

The task must not be marked complete until the final column is proven by one real
production CTWA conversation. Unit tests, build success, synthetic fixtures, and
schema existence are necessary but not sufficient.
