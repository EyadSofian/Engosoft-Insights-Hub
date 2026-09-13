# Engosoft Chatwoot attribution audit and implementation decision

Audited: 2026-09-13. This document deliberately records identifiers, configuration
names, and observed capabilities, but never values of credentials or customer PII.

## A. Executive summary

The Insights Hub already has three pieces that should be preserved:

1. PostgreSQL-backed last-good datasets for Meta, CRM, invoicing, accounting, and
   `chatwoot_phone_evidence`.
2. A bounded Chatwoot REST client for the employee dashboard. Its normal aggregate
   path does **not** enumerate account conversation history.
3. A legacy, shared-secret `/api/chatwoot/webhook` that keeps the phone evidence
   cache fresh.

What is missing is a durable Chatwoot event inbox, normalized attribution touch
history, current conversation attribution projection, secure native-webhook
verification, Chatwoot presentation sync, and analytics APIs/UI. This change adds
those without replacing the existing employee or Odoo paths.

The current Chatwoot account is using WhatsApp Cloud API inboxes. A bounded audit of
ten recent conversations found no referral data in incoming message
`content_attributes`; that does not prove historical CTWA referrals never existed,
only that this sample has none. The deployed Chatwoot version could not be verified:
the instance is not hosted in the accessible Railway project and its authenticated API
does not expose a version header or version endpoint. Current upstream source does
preserve WhatsApp `referral` fields in its incoming-message path, so the deployment
must be validated with one real CTWA message before relying on it.

## B. Existing architecture and data flow

```text
Meta / Google / other ad feeds ──> authenticated ingest ──> dashboard_rows (JSONB)
Odoo CRM / invoicing / accounting ─> authenticated ingest ─┘          │
                                                                  sheet-cache
                                                                     │
                                                    metrics.server + route APIs
                                                                     │
                                                            React dashboard

Chatwoot reports ─> chatwoot.server ──> agent analytics / evidence drawers
Chatwoot webhook ─> chatwoot.webhook ─> chatwoot_phone_evidence ──> CRM phone match
```

Relevant implementation points:

| Area             | Current implementation                                                                | Decision                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Durable datasets | `src/lib/dashboard-db.server.ts`                                                      | Keep for imported feeds; do not force event history into `dashboard_rows`.               |
| Chatwoot REST    | `src/lib/chatwoot.server.ts`                                                          | Reuse its rate limiting, retry, server-only credentials, and bounded evidence approach.  |
| Existing webhook | `src/routes/api/chatwoot.webhook.ts`                                                  | Extend in place; retain legacy authentication through the rollout.                       |
| Phone evidence   | `chatwoot_phone_evidence`, `backfill-chatwoot-phone-evidence.mjs`                     | Preserve as the CRM/employee phone bridge. Attribution is an additional marketing model. |
| Meta IDs         | `dashboard_rows` `meta_ads` / `meta_ad_creatives`; parsing in `sheet-cache.server.ts` | Resolve IDs locally first, with no per-webhook Graph API call.                           |
| CRM and revenue  | `crm`, `invoiced`, `accounting` source datasets and `sheet-cache.server.ts`           | Join only on normalized phone evidence and retain ambiguous/unmatched state.             |

`meta_ads` already has campaign, ad-set, ad, account, and date grain keys; its stable
key is built from account/campaign/ad-set/ad IDs. The CRM parser retains Odoo IDs,
phone/mobile, campaign/ad IDs, stage, salesperson and sales team. Accounting and
invoiced datasets retain campaign/ad context where the upstream export has it. These
are the existing join surfaces; names are display values, never the primary key.

## C. Railway architecture

The accessible `Engosoft-Insights-Hub` Railway project has one production
environment with:

- `Engosoft-Insights-Hub`: one running web replica, Railway public domain,
  `npm run build` then `npm run start`, health check `/api/health`.
- `Postgres`: one running PostgreSQL service with a persistent volume.
- No worker, scheduled service, or Chatwoot deployment in this project.

The web service has the expected existing configuration names, including
`DATABASE_URL`, `CHATWOOT_BASE_URL`, `CHATWOOT_ACCOUNT_ID`,
`CHATWOOT_API_TOKEN`, `CHATWOOT_SYNC_SECRET`, `DASHBOARD_INGEST_SECRET`,
`META_ACCESS_TOKEN`, and Meta/Google/Odoo settings. Values were not read or printed.
The latest running Insights deployment is from the repository's current `main` commit.

Thirty-day Railway log and HTTP-log queries found no matching Insights-side Chatwoot
webhook/error entries. This is a useful baseline, not proof that Chatwoot has never
retried a delivery. The PostgreSQL internal hostname is intentionally not reachable
from a local Railway CLI child process; application-side access remains the supported
path.

## D. Live Chatwoot audit

Authenticated account API findings:

- Account ID: `2`.
- 19 inboxes: four `Channel::Whatsapp` inboxes, all reporting provider
  `whatsapp_cloud`; also Facebook Page, Web Widget, Telegram, Email and API inboxes.
- The WhatsApp Cloud inbox IDs are `15`, `24`, `25`, and `27`. Business-number values
  were inspected only in masked form. No branch mapping is configured or inferred.
- 746 account labels exist. Existing source-like labels include `facebook` and
  `instagram`, but there is no managed attribution label namespace.
- The audit found no conversation custom-attribute definitions, 67 contact definitions,
  and no attribution-oriented contact definition except a pre-existing campaign field.
  The staged rollout then created the 15 reviewed conversation definitions listed in
  the UX plan; a repeat dry-run confirmed that none remain missing.
- Seven account-level outgoing webhooks are registered. The existing
  `Engosoft Insights lead sync` webhook already targets the production Insights
  endpoint and subscribes to `conversation_created`, `conversation_updated`,
  `conversation_status_changed`, `message_created`, and `message_updated`.
  Its legacy URL secret was compared to Railway's `CHATWOOT_SYNC_SECRET`
  in-process and matches; neither value was printed or copied into this report.
- Ten recent conversations were inspected with bounded message requests. Incoming
  content attributes only exposed reply-reference keys; no `referral` payload was
  present.
- The HTTPS instance is behind nginx. Its authenticated API returned no version header;
  the deployment/provider is verified as WhatsApp Cloud, but exact Chatwoot version and
  native Referral UI availability remain unknown.

The current upstream Chatwoot source has `referral_attributes` in the WhatsApp incoming
message helper and exposes `content_attributes` in `Message#webhook_data`. That source
is evidence for the intended current behaviour, not evidence that this particular
deployment includes it. Do not fork or patch Chatwoot until the CTWA acceptance test
shows it drops the referral.

## E. Attribution evidence matrix

| Channel                            | Evidence                                                                   | Reliability                                                 | Method / fallback                                                    |
| ---------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| Meta CTWA                          | WhatsApp referral `source_id`, `ctwa_clid`, source URL/type/headline/media | Exact click/referral evidence; ID enrichment is conditional | `meta_referral`; retain unresolved source ID.                        |
| Website → WhatsApp                 | Signed opaque tracking token generated before opening WhatsApp             | Strong when token is valid and unexpired                    | `signed_tracking_token`; then UTM/referrer.                          |
| Website chat                       | Chatwoot additional attributes/referrer plus explicit UTM                  | Strong to inferred                                          | `utm` then `referrer`.                                               |
| Facebook / Instagram page messages | Inbox channel and provider payload                                         | Strong source, no paid campaign claim                       | `inbox_mapping` or native metadata.                                  |
| Organic/direct WhatsApp            | Destination inbox/number only                                              | Inferred route, not acquisition                             | `inbox_mapping`; keep source/campaign unknown.                       |
| CRM-only history                   | Existing CRM campaign/ad columns                                           | Existing CRM claim, potentially historical                  | `manual` / existing CRM attribution, never overwrite touch evidence. |

Native CTWA referrals are stronger than ordinary UTMs because the WhatsApp platform
creates them at the click-to-message boundary. `referral.source_id` is treated as an
opaque Meta identifier until it exactly resolves to locally stored ad/creative IDs; it
must not be assumed to be a campaign ID or derived from a campaign name. `ctwa_clid`
is retained only as pseudonymous marketing evidence, with a configurable retention
window and no use as an authorization input.

## F. UTM and CTWA research findings

Chatwoot's current webhook documentation specifies a per-webhook HMAC signature:
`sha256=HMAC-SHA256(webhook_secret, "{timestamp}.{raw_body}")`, with
`X-Chatwoot-Signature`, `X-Chatwoot-Timestamp`, and optional
`X-Chatwoot-Delivery`. The raw body, constant-time comparison, five-minute replay
tolerance, and delivery idempotency are therefore mandatory.

The Chatwoot APIs support conversation custom-attribute updates with `merge: true` and
conversation-label reads. Labels must be read then merged before an update because a
label update replaces the set. Only a small stable namespace is appropriate for labels:
source/platform, medium, and configured branch. Campaign/ad IDs, UTM values and CTWA
click IDs are high cardinality and belong in custom attributes and PostgreSQL.

UTMs do not automatically survive a browser-to-WhatsApp transition. The implementation
therefore issues a short-lived opaque nonce with an HMAC signature, backed by a
server-side sanitized UTM/referrer/branch record. A website integration requests it from
the protected `POST /api/attribution/tokens` endpoint, then places the returned
`[ref:token.signature]` marker in a pre-filled message. An invented, expired, or
signature-invalid marker is demoted before it can become attribution evidence. The
marker should be removed from agent-visible message content when the upstream channel
supports metadata; otherwise it stays short and is parsed only as evidence. No raw UTM
blob is placed in a customer message.

Primary references: Chatwoot's [webhook verification guide](https://www.chatwoot.com/hc/user-guide/articles/1788726371-webhooks), [custom-attribute API](https://developers.chatwoot.com/api-reference/conversations/update-custom-attributes), [labels API](https://developers.chatwoot.com/api-reference/conversations/list-labels), and [webhook API](https://developers.chatwoot.com/api-reference/webhooks/add-a-webhook). Meta's payload page was not retrievable by this environment; validate the exact delivered referral shape in the live acceptance test.

## G. Recommended architecture

```text
Chatwoot message_created / conversation events
  -> raw-body size + dual authentication
  -> chatwoot_event_inbox (unique delivery/event key)
  -> deterministic parser and attribution resolver
       -> chatwoot_attribution_touches (immutable evidence history)
       -> chatwoot_conversation_attribution (fast current projection)
       -> optional Chatwoot attributes + merged managed labels
       -> attribution APIs / dashboard

Existing phone webhook projection
  -> chatwoot_phone_evidence (unchanged)
  -> normalized phone -> CRM/Odoo match (read-only enrichment)

meta_ads + meta_ad_creatives (PostgreSQL cached)
  -> exact local ID lookup -> campaign / ad-set / ad enrichment
```

Attribution precedence is deterministic: native Meta referral with an ID; valid
tracking token; explicit UTM; Chatwoot referrer; configured inbox/number branch;
existing CRM attribution; unknown. Each projection stores method, confidence, evidence
hash and source-event reference. New touches do not overwrite the immutable first touch:
the projection tracks conversation first touch and latest touch, and queries can derive
the contact's historical original acquisition.

## H. Database schema decision

Typed relational tables are required for webhook idempotency, touch history, and fast
filters. Generic `dashboard_rows` remains correct for imported spreadsheet/API facts.

- `chatwoot_event_inbox`: unique event key/delivery ID, type, conversation/message/contact
  IDs, safely reduced evidence JSONB, payload hash, receipt/processing timestamps,
  attempts and error.
- `chatwoot_attribution_touches`: unique `(conversation_id, message_id, evidence_hash)`;
  normalized UTM, Meta, branch, method, confidence and occurrence time.
- `chatwoot_conversation_attribution`: one row per conversation; first/latest touch IDs
  plus denormalized fast-read values, inbox/contact/agent and update timestamp.
- `chatwoot_attribution_tokens`: opaque token, expiry, consumption timestamp and minimal
  evidence; token plaintext is never derived from a customer identifier.

All IDs are indexed for conversation, contact, inbox, source/ad/campaign, date and
processing state. Raw message text and customer phone/name are not copied into the
attribution event payload. Retention is configurable; CTWA IDs should use the same
documented marketing-retention policy as other pseudonymous ad click identifiers.

## I. Chatwoot UX strategy

- Keep a native Referral/Ad card whenever the deployed UI renders it.
- Custom attributes (feature-flagged): source, medium, campaign, campaign/ad-set/ad ID,
  CTWA click ID, branch, method and confidence. Definitions are provisioned explicitly,
  not implicitly during a message webhook.
- Managed labels only: `src:<platform>`, `medium:<medium>`, `branch:<configured-id>`.
  The synchronization reads all labels, replaces only this managed subset, and preserves
  agent-created labels.
- All synchronization is off by default; it compares existing data first and skips equal
  writes to avoid `conversation_updated` loops.

## J. Dashboard design

The new Acquisition Attribution view uses the existing layout/components and reads only
PostgreSQL projections. It presents attributed conversations, unique contacts, unknown
share, CTWA conversations, CRM matches/wins, revenue, campaign distribution, and
conversation drill-down. It also shows spend, cost per WhatsApp conversation, CPA, and
ROAS only where an exact locally stored Meta campaign ID joins the attribution
projection; every other spend-derived metric is explicitly unavailable rather than
allocated from a campaign name, UTM string, or inbox. Its query/filter contract includes
the shared reporting period, platform/source/medium, campaign/ad-set/ad, branch, inbox,
agent, method, confidence and CRM status.

## K. File-by-file implementation plan

| File                                                     | Change                                                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/lib/chatwoot-attribution.server.ts`                 | New typed schema, parser, resolver, local Meta enrichment, projections, health/query APIs and Chatwoot sync policy. |
| `src/lib/chatwoot.server.ts`                             | Expose narrowly scoped label/custom-attribute helpers on the existing rate-limited client.                          |
| `src/routes/api/chatwoot.webhook.ts`                     | Raw-body, dual verification, replay and durable event processing.                                                   |
| `src/routes/api/attribution.*.ts`                        | Summary, conversations and health endpoints.                                                                        |
| `src/routes/api/attribution.tokens.ts`                   | SSO/admin-protected, HMAC-signed Website → WhatsApp marker issuance.                                                |
| `src/routes/attribution.tsx`, navigation/i18n/route tree | Consistent dashboard view and navigation.                                                                           |
| `scripts/backfill-chatwoot-attribution.mjs`              | Explicit date-bounded, resumable, server-filtered, rate-limited historical job.                                     |
| `scripts/provision-chatwoot-attribution.mjs`             | Dry-run by default; creates only missing conversation attribute definitions with `--apply`.                         |
| `scripts/purge-chatwoot-attribution.mjs`                 | Private operator/scheduled retention purge; retains aggregate conversation projection.                              |
| `scripts/test-chatwoot-attribution.mjs`                  | Fixture-led regression/acceptance tests.                                                                            |
| `.env.example`                                           | New names only, descriptions and safe defaults.                                                                     |

## L. New environment variables

- `CHATWOOT_WEBHOOK_SECRET` — native per-webhook HMAC secret.
- `CHATWOOT_LEGACY_WEBHOOK_ENABLED` — temporary legacy shared-secret gate.
- `CHATWOOT_WEBHOOK_MAX_AGE_SECONDS` — replay tolerance (default 300).
- `CHATWOOT_ATTRIBUTION_SYNC_MODE` — `off`, `attributes`, `labels`, or `both`.
- `CHATWOOT_ATTRIBUTION_BRANCH_MAP_JSON` — reviewed inbox/number/tracking mapping.
- `CHATWOOT_ATTRIBUTION_TOKEN_SECRET` — separate HMAC key for tracking markers.
- `CHATWOOT_ATTRIBUTION_TOKEN_TTL_SECONDS` — website token expiry.
- `CHATWOOT_ATTRIBUTION_RETENTION_DAYS` — evidence retention policy.

## M. Testing plan

Automated fixtures cover native CTWA normalization, signed token validation,
UTM/direct-inbox fallbacks, inbound/outbound classification, native webhook signature
validation, managed-label formatting, PII-free reduced evidence, and the single-record
Chatwoot reads used to avoid sync loops. Database idempotency, feature-flagged sync,
and the bounded replay worker should be exercised against the Railway service before
enabling writes. The production acceptance test uses a test CTWA creative and a
sanitized real delivery; it proves the exact end-to-end sequence without exposing a
contact, token or ad secret.

## N. rollout and migration plan

1. Deploy schema and parser with `CHATWOOT_ATTRIBUTION_SYNC_MODE=off`; keep legacy
   webhook authentication enabled.
2. Keep the existing Insights webhook (do not create a duplicate) and validate a
   delivered `message_created` event. Record its native per-webhook signing secret as
   `CHATWOOT_WEBHOOK_SECRET` only when the deployed Chatwoot UI/API exposes the actual
   signing key and a signature can be verified; keep the matching legacy URL secret
   enabled until then.
3. Create reviewed conversation attribute definitions, enable `attributes`, and validate
   a test CTWA message. Use `npm run provision:chatwoot-attribution` first; repeat with
   `-- --apply` only after the dry-run list is approved.
4. Enable `labels` after confirming managed-label merge behavior.
5. Release dashboard APIs/UI, then run the explicit, bounded backfill from a
   Railway-private process. Backfill never runs during a dashboard request. Schedule
   `npm run purge:chatwoot-attribution` only after the retention period is approved.
6. Disable legacy authorization only after native delivery is continuously healthy and
   rollback is documented as re-enabling the legacy flag/sync `off` mode.

## O. Remaining risks and unknowns

- Deployed Chatwoot version, Referral UI support, and live referral persistence remain
  unverified until a real CTWA test.
- The existing Insights webhook uses the matching legacy URL secret. Native signature
  rollout remains conditional because current upstream Chatwoot has an open report that
  the API-exposed `secret` can differ from the internal HMAC signing key; disabling the
  legacy mechanism before one real signed delivery is verified would be unsafe.
- No authoritative branch mapping was found; configuration is required before a branch
  can be claimed.
- `referral.source_id` must be locally resolved before calling it an ad ID. A referral
  with no local match remains exact referral attribution with unresolved enrichment.
- Historical conversations that never stored referral/token evidence remain `unknown`,
  not retroactively organic or paid.

## P. Production rollout verification — 2026-09-13

- The attribution commits were pushed to both the dedicated attribution branch and
  `main`; Railway built and deployed the same `main` revision successfully.
- `/api/attribution/health`, `/api/attribution/summary`,
  `/api/attribution/conversations`, and `/attribution` all responded successfully from
  the public Railway domain and created/queried the PostgreSQL schema.
- The existing Chatwoot webhook began delivering real account events immediately.
  Sanitized database aggregates confirmed processed `conversation_created` and inbound
  `message_created` events plus ignored non-attribution updates, with no failures or
  pending work. No contact, message, phone, or conversation value was printed.
- A synthetic outbound event was sent twice to the production webhook. The first result
  was accepted with `duplicate: false`; the second was accepted with `duplicate: true`;
  the durable health counter increased to one. The single synthetic event row was then
  removed by its exact reserved conversation/message ID, leaving real data untouched.
- An unsigned request returned HTTP 401. The real configured webhook's legacy secret
  matches Railway, and native HMAC support remains staged until its signing key is
  verified on an actual delivery.
- Chatwoot now has all 15 reviewed conversation attribution definitions. Railway moved
  from capture-only to `CHATWOOT_ATTRIBUTION_SYNC_MODE=attributes`; managed labels remain
  disabled until their separate rollout stage.
- A bounded 1–13 September backfill scanned 50 recently active conversations and created
  194 previously unseen inbound-message projections. Those historical messages contained
  no source evidence, so the 47 resulting conversation rows remain explicitly `unknown`;
  no campaign or spend was fabricated. Chatwoot attribute write-back was disabled for this
  historical pass. A discovered message-pagination overlap was corrected, and only the
  affected backfill duplicate counters were cleared.
- The complete Vitest suite passed (30 files, 676 tests), together with attribution
  fixtures, the bounded Chatwoot architecture test, TypeScript, targeted ESLint,
  production build, and browser verification of the page and KPI drill-down. The
  percentage fixture also verifies that a complete unknown share is rendered as 100%,
  rather than as its underlying ratio value of 1.
