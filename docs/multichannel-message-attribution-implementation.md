# Engosoft Multi-Channel Message Attribution — Implementation Report

Chatwoot version changed: NO  
Chatwoot source patched: NO  
Existing message delivery path changed: NO  
CRM used for campaign attribution: NO  
Campaign name fuzzy matching: NO  
Existing manual labels preserved: YES  
Attribution failure can block messages: NO

Status date: 2026-09-14  
Implementation branch: `feat/multichannel-message-attribution`  
Production deployment: **NOT DEPLOYED**  
Production Chatwoot writes from this implementation: **NONE**

## Scope and current status

The forward-looking provider evidence layer, exact provider-message correlation, Meta identity catalog, canonical PostgreSQL projection, retry model, secured webhook route, and multi-channel dashboard are implemented on the feature branch.

This report does **not** mark the business acceptance complete. There is no configured Engosoft Attribution Meta App in Railway yet, the current Meta audit found no active Click-to-WhatsApp test ad, and no controlled real WhatsApp, Messenger, or Instagram click-to-message trace has passed through the new listener. Phases 6–8 therefore remain gated.

## Existing architecture reused

The implementation extends the existing Insights Hub service rather than creating a second attribution product:

- Existing `chatwoot_event_inbox`, `chatwoot_attribution_touches`, and `chatwoot_conversation_attribution` tables remain authoritative.
- Existing Chatwoot webhook continues to receive Chatwoot events and now preserves `message.source_id` as `provider_message_id`.
- Existing tracking-token and legitimate UTM parsing remain available for website traffic.
- Existing `meta_ads` remains the delivery/spend fact dataset.
- Existing `meta_ad_creatives` remains the slowly changing creative source and now preserves Meta story/post identities.
- Existing exact campaign-ID spend joins and downstream CRM outcome joins are reused.
- Existing Chatwoot GET/merge helpers are reused for canary presentation sync.
- The existing Railway PostgreSQL connection and server process host the durable inbox and retry worker.

The new endpoint is:

```text
/api/meta/whatsapp-attribution-webhook
```

Despite the compatibility-oriented route name, its normalizer accepts Meta WhatsApp Business Account, Page/Messenger, and Instagram messaging envelopes. It is an attribution-only listener. It never sends, forwards, replies to, or routes customer messages.

## Channel evidence matrix

The audit queried the production Chatwoot account read-only. Customer message text, names, emails, sender IDs, and phone numbers were excluded from output.

| Destination        | Production representation                                                                             |                                                        Exact Chatwoot provider ID | Paid referral retained by Chatwoot | Adapter result                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------: | ---------------------------------: | ----------------------------------------------------------------------------------- |
| WhatsApp           | `Channel::Whatsapp`, provider `whatsapp_cloud`                                                        |                                                    `message.source_id`, `wamid.*` | No, in sampled production messages | Direct Meta WABA listener required                                                  |
| Facebook Messenger | `Channel::FacebookPage`                                                                               |                                                        `message.source_id`, `m_*` | No, in sampled production messages | Page/Messenger provider adapter supported; real paid fixture still required         |
| Instagram DM       | No separately proven live conversation sample; several Facebook Page inboxes expose an `instagram_id` | Expected provider `message.source_id`, not yet proven on a live Instagram message |                         Not proven | Adapter implemented, rollout blocked until a real fixture proves the Chatwoot field |
| Website            | Existing WebWidget/API tracking-token and UTM path                                                    |                                             Chatwoot message ID plus signed token |                     Not applicable | Existing path preserved                                                             |

Production sampling summary:

- Four WhatsApp Cloud inboxes were identified.
- Six Facebook Page inboxes were identified; three expose an Instagram account ID.
- Across the inspected conversation summaries, every sampled inbound WhatsApp or Messenger message had a non-empty `message.source_id`.
- No sampled inbound WhatsApp or Messenger message had non-empty `external_source_ids`.
- No sampled message contained a referral object in `content_attributes` or `additional_attributes`.
- The existing durable Chatwoot event inbox contained 853 events at audit time, including 393 `message_created` events, with zero reduced evidence records containing a referral/source ID.

These findings agree with the earlier Chatwoot 4.12.1 runtime audit: the deployed WhatsApp adapter preserves the provider message ID but loses the original Meta referral object before the Insights webhook receives it.

## Meta subscription audit

Audit mode: read-only. No `POST`, `DELETE`, unsubscribe, callback override, or Meta campaign mutation was performed.

Sanitized WABA ID: `1755…5345`

The WABA currently returned five subscribed applications:

| App ID             | App name         | Per-WABA callback override present |
| ------------------ | ---------------- | ---------------------------------: |
| `1108978947018721` | `WA Cloud`       |                                Yes |
| `1770599970389634` | `Engosoft-tg8P6` |                                Yes |
| `874530331094376`  | `Odoo-KSA2`      |                                 No |
| `716813410564065`  | `Odoo-EGP1`      |                                 No |
| `1981340529318743` | `qutations`      |                                 No |

This proves the WABA currently supports multiple subscribed apps without replacing the Chatwoot subscription. However:

- `META_ATTRIBUTION_APP_ID`, `META_ATTRIBUTION_APP_SECRET`, and `META_ATTRIBUTION_VERIFY_TOKEN` are not configured in Railway.
- Therefore no proposed Attribution App ID/name exists to compare with the current subscriptions.
- No subscription change is safe to apply until that dedicated app is created/configured and its exact ID is audited.
- The future operation must add that app only. It must not remove any of the five existing apps or replace their callback configuration.

## Provider-message correlation findings

The primary correlation key is exact equality:

```text
Meta messages[].id / message.mid
    = Chatwoot message.source_id
```

The production audit proved the Chatwoot side of this join for live WhatsApp and Messenger messages. The Meta side will be proven end-to-end only after the dedicated listener receives a controlled provider event.

Sanitized Chatwoot-side audit traces:

| Channel   | Provider message fingerprint | Chatwoot message ID | Chatwoot conversation ID | Chatwoot `source_id` present | Full cross-provider match |
| --------- | ---------------------------- | ------------------: | -----------------------: | ---------------------------: | ------------------------: |
| WhatsApp  | `sha256:17ad426b9e7ab506`    |           `1289922` |                 `156601` |                         true | pending real Meta fixture |
| Messenger | `sha256:283217d00c1c2fad`    |           `1291367` |                 `156690` |                         true | pending real Meta fixture |

No contact name, CRM record, campaign name, phone number, or timestamp-window guess is used for correlation. If the exact provider ID is absent, the event remains unresolved with `provider_message_unmatched`.

## Database changes

Existing tables are extended with the canonical dimensions needed by all adapters:

- `provider_message_id`
- creative ID/name
- placement
- UTM fields on the conversation projection
- `attribution_scope`
- `unknown_reason`

New `meta_message_attribution_events` stores only reduced provider marketing evidence:

- provider and provider message ID
- destination phone-number/page ID
- referral source ID and `ctwa_clid`
- source URL/type
- reduced evidence JSON and payload hash
- received/processed timestamps
- retry status, attempts, next attempt, duplicate count, and last error

New `meta_entity_identity_catalog` separates identity resolution from daily spend facts:

- account, campaign, ad set, ad, and creative stable IDs/names
- effective object story ID and source post ID
- placement, status, source, and update timestamp

No raw customer message content, customer name, email, full phone number, or Meta token is stored or logged.

Schema validation was executed against the Railway PostgreSQL engine inside one transaction. All migrations succeeded, the expected four tables/projections exposed 128 columns in total, and the transaction was rolled back. A second rollback-only check executed the actual touch insert, touch update, and conversation projection update statements against that engine. No schema or business data change remained.

## Source-ID resolution logic

Resolution is deterministic and ordered:

1. exact Ad ID
2. exact Creative ID
3. exact effective object story ID
4. exact source/post ID

The result records `matchedAs` plus the resolved stable IDs in the canonical reduced evidence so an operator can see exactly which representation matched. Campaign/ad-set/ad names are never join keys.

The local identity catalog is checked first. If the source ID is not present, the catalog is refreshed from existing Meta datasets. An exact Graph lookup is attempted only during event processing and only as a fallback. Dashboard rendering does not call Meta Graph.

If exact identity still cannot be resolved, the event enters `waiting_for_meta_identity` with bounded exponential backoff. After eight attempts it becomes `unresolved` with `meta_source_id_unresolved`; no campaign label is created.

## Meta entity coverage

The prior production audit found:

- `meta_ads`: 16,251 delivery/spend rows, including 2,365 campaigns, 425 ad sets, and 1,268 ads.
- `meta_ad_creatives`: 523 identity/creative rows, covering 370 creatives.
- Existing stored story/post coverage was zero because `effective_object_story_id` was requested from Graph but discarded by normalization/storage.

That loss is fixed on this branch. `AdCreative` now retains `effectiveObjectStoryId` and `sourcePostId`, and `meta_ad_creatives` persists them as `effective_object_story_id` and `source_post_id`. Coverage will rise only after the creative sync runs after deployment; the report does not invent a post-deployment count.

## UTM extraction rules

Only actual URL parameters are parsed:

```text
utm_source
utm_medium
utm_campaign
utm_content
utm_term
```

The parser uses a legitimate provider referral/source URL. Missing fields remain empty. Campaign/ad IDs remain authoritative when UTM is absent. No UTM is generated from campaign/ad names.

## Canonical first/latest touch policy

Attribution is conversation-scoped.

- The canonical touch and conversation projection retain Chatwoot message ID, exact provider message ID, destination phone/page ID, referral source ID, `ctwa_clid`, and attribution scope alongside the resolved campaign hierarchy.
- `first_touch` is the earliest evidence row for the conversation and remains the acquisition projection.
- `latest_touch` is tracked independently for diagnostics and recency.
- A later message does not replace the original conversation acquisition.
- A later, separate Chatwoot conversation can receive its own attribution.
- CRM is joined only after provider/website attribution is established and cannot rewrite it.

## Label strategy

Managed namespaces are:

```text
src:
channel:
campaign:
branch:
```

Campaign labels are created only when an exact campaign ID exists. Format:

```text
campaign:<safe-short-name>-<last6campaignid>
```

Ad and ad-set labels are not created.

Production label audit:

- Total current labels: 746
- Existing `src:`, `channel:`, `campaign:`, `branch:`, or `medium:` labels: 0
- No labels were pre-created.

Every label update first reads the current array, removes only Engosoft-owned namespace values, preserves all other labels, merges the new managed values, and sends the final unique array.

## Chatwoot custom attributes

The canary sync supports:

- source, channel, and campaign
- exact campaign/ad-set/ad/creative IDs
- campaign/ad-set/ad names
- legitimate UTM fields
- `ctwa_clid`
- method and confidence

Production currently has 14 related attribute definitions. A dry-run found five missing definitions:

```text
attribution_channel
meta_creative_id
meta_campaign_name
meta_adset_name
meta_ad_name
```

The provisioning script now knows these definitions but was run without `--apply`; nothing was created.

The provider sidecar uses a separate gate:

```text
META_ATTRIBUTION_CHATWOOT_SYNC_MODE=off
META_ATTRIBUTION_CANARY_CONVERSATION_ID=
META_ATTRIBUTION_SYNC_ALLOW_ALL=false
```

Even if mode is changed to `attributes` or `labels`, writes remain blocked unless an exact canary conversation is selected or the explicit all-conversations switch is later enabled.

## Dashboard changes

The existing Conversation Attribution page is now multi-channel and was visually inspected in Chrome against the local production build.

Top KPIs include:

- total conversations
- evidence-attributed conversations
- paid campaign conversations
- organic/direct
- unknown and unknown rate
- exact attribution, CRM outcomes, spend, cost/conversation, CPA, and ROAS

Filters include channel, source platform, exact campaign/ad-set/ad IDs, inbox, branch, method, confidence, unknown reason, and the existing date filters.

The main conversation table includes channel, source, campaign, ad set, ad, UTM campaign, method, confidence, CRM result, revenue, and the exact Chatwoot link.

Campaign drill-down displays platform → campaign → ad set → ad with spend, attributed conversations, CRM leads, won/lost, conversion, revenue, CPA, and ROAS. Spend is selected by exact `ad_id` for ad-grain rows and exact `campaign_id` for campaign-grain rows; names are never used.

## Security and privacy

- Verification handshake uses a constant-time token comparison.
- `X-Hub-Signature-256` is checked as HMAC-SHA256 over the unparsed body.
- Invalid signatures return `401` before JSON processing.
- Payloads over 1 MB return `413`.
- Messenger/Instagram `is_echo` messages are ignored so outbound agent replies cannot create acquisition touches.
- Durable reduced evidence is inserted before success is returned.
- Graph enrichment and Chatwoot correlation run after acknowledgement.
- Provider message ID plus provider is unique and duplicate deliveries are counted.
- Retry states are `received`, `waiting_for_chatwoot_message`, `waiting_for_meta_identity`, `resolved`, `unresolved`, and `failed`.
- Tokens and raw provider payloads are never logged.
- Attribution processing is independent from Chatwoot/Meta message delivery.

## Tests and verification

Passed locally:

- TypeScript `tsc --noEmit`
- ESLint on every changed JavaScript/TypeScript/TSX file
- production client/SSR/Nitro build
- 30 Vitest files, 676 tests
- existing Chatwoot attribution fixtures
- new Meta message attribution fixtures
- transactional Railway PostgreSQL schema validation, rolled back
- rollback-only Railway validation of the actual touch insert/update/projection SQL
- visual Chrome inspection of the local attribution dashboard

New fixtures cover:

- WhatsApp paid referral reduction
- direct WhatsApp without paid referral
- Messenger paid referral envelope
- organic Instagram DM envelope
- removal of message bodies, customer names, sender IDs, and phone numbers
- rejection of outbound Messenger echo events
- Meta HMAC verification, rejection, and handshake verification
- preservation of effective object story/source post IDs

Local HTTP route checks returned `200` plus the exact challenge for a valid verification token, `403` for a bad token, `401` for a bad signature, and `200` for the rendered attribution dashboard route.

- rejection of outbound Messenger/Instagram echo messages

Repository-wide ESLint still reports 178 pre-existing formatting errors in unrelated files. Every file changed by this implementation passes ESLint; those unrelated errors were not mass-formatted into this feature branch.

## Rollout

### Completed on feature branch

1. Production message/inbox evidence audit.
2. Attribution-only Meta provider adapters and durable storage.
3. Exact provider-message correlation implementation.
4. Local-first exact Meta identity enrichment with bounded Graph fallback.
5. Canonical PostgreSQL projection and dashboard implementation.

### Required before any production sync

1. Create or select a dedicated Engosoft Attribution Meta App.
2. Configure its ID, app secret, and a new webhook verify token in Railway without printing them.
3. Re-run the WABA subscription audit and confirm the exact proposed app is not already subscribed.
4. Deploy the feature branch with provider worker and Chatwoot sync still off.
5. Verify the public webhook handshake and one signed test payload.
6. Add the Attribution App as an additional WABA subscribed app only; do not remove or override any existing app.
7. Activate/use one controlled known click-to-message test ad per channel.
8. Prove exact provider ID → Chatwoot message → conversation correlation.
9. Provision the five missing Chatwoot attributes.
10. Set one exact canary conversation and run attributes-only canary.
11. Verify the same conversation in PostgreSQL, Insights, and Chatwoot.
12. Run a labels-only canary and verify all manual labels remain.
13. Enable controlled production sync only after all three real channel fixtures pass.

## Rollback

The message path requires no rollback because it is never modified.

Operational rollback order:

1. Set `META_ATTRIBUTION_CHATWOOT_SYNC_MODE=off`.
2. Set `META_ATTRIBUTION_WORKER_ENABLED=false`.
3. Remove only the dedicated Attribution App subscription if it was added; do not touch existing WABA apps.
4. Roll back the Insights deployment/branch.
5. Retain provider inbox rows for diagnosis, or purge them later under the existing attribution retention policy.

Manual Chatwoot labels are unaffected. Schema additions are backward-compatible; removing them is not required to restore the previous runtime.

## Known limitations

- The Meta Attribution App does not yet exist in runtime configuration.
- No active CTWA test ad was available during the audit.
- Production Messenger and Instagram paid referral payload shapes still require a real fixture each.
- Instagram provider message identity has not yet been proven against a live Chatwoot Instagram DM.
- Story/post ID catalog coverage remains zero until the patched creative sync runs after deployment.
- Historical conversations whose provider referral was lost remain Unknown; CRM is not used to manufacture attribution.
- Production uses Chatwoot attribute sync from the legacy attribution path today; the new sidecar has its own default-off gate and has not been deployed.

## Real acceptance traces

No real click-to-message acceptance trace is claimed yet.

| Acceptance                                |                                   WhatsApp |                                  Messenger |                                          Instagram |
| ----------------------------------------- | -----------------------------------------: | -----------------------------------------: | -------------------------------------------------: |
| Known active test campaign/ad selected    |          blocked — no active test ad found |                                    pending |                                            pending |
| Provider webhook received by new listener |        pending deployment/app subscription |                                    pending |                                            pending |
| Exact provider message ID matched         | implementation ready; Chatwoot side proven | implementation ready; Chatwoot side proven | implementation ready; Chatwoot side not yet proven |
| Exact ad/ad set/campaign resolved         |                     pending real source ID |                     pending real source ID |                             pending real source ID |
| Canonical PostgreSQL row                  |                         pending real event |                         pending real event |                                 pending real event |
| Insights page agrees                      |                                    pending |                                    pending |                                            pending |
| Chatwoot attribute canary                 |                                    not run |                                    not run |                                            not run |
| Chatwoot label canary                     |                                    not run |                                    not run |                                            not run |

Business acceptance becomes complete only after a real controlled message for each supported destination proves the same campaign identity in the original provider evidence, PostgreSQL, Insights Hub, and the same Chatwoot conversation.
