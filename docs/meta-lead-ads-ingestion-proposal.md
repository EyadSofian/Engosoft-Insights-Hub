# Meta Lead Ads (Instant Form) Ingestion — Architecture Proposal

Status: **proposal, not implemented**
Date: 2026-09-14
Scope: Engosoft Insights Hub, event-level attribution for native Meta instant-form leads.

## 1. Why this adapter is next

The 2026-09-14 Meta account audit classified every ad with delivery in the last 90 days, plus every currently active ad, by its real conversion path. The detailed per-ad audit contains spend and campaign names, so it is kept outside this public repository.

| Destination type | Share of the audited Meta mix | Engosoft event-level ingestion today |
| --- | --- | --- |
| META_INSTANT_FORM | Clear majority of spend, platform leads, and active campaigns | **MISSING** |
| WEBSITE_LANDING | Minority. Mostly shop, product, category and training-package pages, not the Odoo campaign landing pages. | Partial. Landing collector live on `/cfm` only. |
| MESSAGING (WhatsApp / Messenger / Instagram DM) | Negligible, and only in paused campaigns | Partial. Listener subscribed, but no real Meta delivery observed yet. |
| CALL | None | Not needed |
| OTHER (engagement / profile) | Small | Not a conversion path |

Instant forms are where Meta records the leads, and nothing in Insights Hub captures those leads individually. Today their only visibility is Meta's aggregate reporting, which must never be presented as individual attribution.

## 2. Goal and non-goals

Goal: record one durable, exact attribution row per instant-form lead, carrying Meta's own lead ID, form, ad, ad set, campaign, platform, and organic/paid flag.

Non-goals:

- No lead contact data (names, phone numbers, emails, form answers) stored in Insights Hub.
- No use of Odoo/CRM to decide campaign attribution.
- No joining instant-form leads to Chatwoot conversations by name, phone, or time window.
- No change to any existing CRM or Meta integration that already consumes these leads.

## 3. Meta mechanics

| Piece | Detail |
| --- | --- |
| Real-time signal | Page webhook, object `page`, field `leadgen`. Payload: `leadgen_id`, `page_id`, `form_id`, `ad_id`, `adgroup_id`, `created_time`. |
| Lead metadata | `GET /{leadgen_id}?fields=created_time,ad_id,adset_id,campaign_id,form_id,platform,is_organic`. `field_data` is never requested. |
| Backfill | `GET /{form_id}/leads` with the same metadata fields, within Meta's lead retention window |
| Names | Campaign, ad set and ad names come from the existing `meta_entity_identity_catalog`, with an exact-ID Graph fallback |
| Subscription | `POST /{page_id}/subscribed_apps?subscribed_fields=leadgen` with the Page token. This adds our app only; other apps subscribed to the Page are untouched. |

### Access required (currently missing)

The audit token has `ads_read`, `ads_management`, `business_management` and `pages_read_engagement`. Reading any lead form failed with Graph error `100/33` (missing permissions), and Page subscription edges rejected the user token. The ingestion needs:

- Meta app: the existing business-owned **Engosoft Attribution** app (Live), with `leads_retrieval`, `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement` and `ads_read`.
- A **system user** token from the Engosoft business portfolio with the promoting Pages assigned. It is stored only in Railway, never in frontend code or logs.
- **Leads Access** (Business Settings → Integrations → Leads Access) must grant the app access to the Pages' leads. Existing CRM integrations listed there must keep their access.

## 4. Proposed architecture

```text
Meta Page leadgen webhook
  → POST /api/meta/lead-ads-webhook      (verify token + X-Hub-Signature-256, 1 MB cap)
  → meta_lead_ad_events                  (durable inbox, unique leadgen_id, stored before 200)
  → worker: fetch lead metadata          (no field_data)
  → resolve campaign / ad set / ad names (exact IDs only)
  → meta_lead_attribution                (one row per lead, paid or organic)
  → Insights dashboard                   (event-level instant-form leads section)
```

The handshake, HMAC verification, durable inbox, retry states and redaction reuse the patterns and helpers of the existing Meta message attribution listener (`src/lib/meta-message-attribution.server.ts`). It is a separate route and table, because leads and messages have different identities.

### Tables

`meta_lead_ad_events` (inbox):

| Column | Notes |
| --- | --- |
| `leadgen_id` | Primary key, from Meta |
| `page_id`, `form_id`, `ad_id`, `adset_id` | As delivered |
| `created_time` | Meta lead creation time |
| `payload_hash` | For duplicate diagnostics; the raw payload is not stored |
| `status` | `received`, `waiting_for_meta`, `resolved`, `unresolved`, `failed` |
| `attempts`, `next_attempt_at`, `last_error` | Bounded exponential retry, like the message listener |
| `received_at`, `processed_at`, `duplicate_deliveries` | Operations |

`meta_lead_attribution` (projection):

| Column | Notes |
| --- | --- |
| `leadgen_id` | Primary key |
| `created_time`, `platform` (`fb` / `ig`), `is_organic` | From lead metadata |
| `page_id`, `form_id`, `form_name` | Form identity. The name is read with form access, not from lead answers. |
| `campaign_id`, `campaign_name`, `adset_id`, `adset_name`, `ad_id`, `ad_name` | Exact IDs. Names are informational, never join keys. |
| `attribution_scope` | `paid` when `is_organic = false` and `ad_id` is present, `organic` when `is_organic = true`, otherwise `unknown` with a reason |
| `source` | `ingested` (webhook) or `backfill` |

Neither table has a column for names, phone numbers, emails or form answers.

### Worker

- Runs inside the existing Insights process, next to the message-attribution worker, behind `META_LEAD_ADS_WORKER_ENABLED`.
- Fetches lead metadata with the system user token. A missing ad ID on a paid lead enters `waiting_for_meta` with backoff, then becomes `unresolved` with `meta_lead_ad_missing`.
- Never retries forever and never logs tokens or payloads.

### Dashboard

- A new **Instant-form leads (event-level)** section: leads by campaign, ad set, ad, form, platform and organic/paid, taken only from `meta_lead_attribution`.
- Meta's aggregate `onsite_conversion.lead_grouped` stays in the separate **Meta platform results (aggregate)** section. A reconciliation line may compare the two totals, labeled as a data-quality check, not attribution.
- No instant-form lead is shown as a Chatwoot conversation.

## 5. Rollout

1. Grant permissions, the system user token and Leads Access. Record in Railway: `META_LEAD_ADS_PAGE_TOKEN_*` or a system user token (names only in docs), a verify token, and reuse of the app secret.
2. Deploy with the worker disabled. Verify the webhook handshake and signed test payload.
3. Canary with Meta's **Lead Ads Testing Tool** on one Page. Confirm first that existing CRM subscribers of that Page tolerate a test lead, because they receive it too.
4. Verify on the canary: inbox row, metadata fetched without `field_data`, exact campaign, ad set and ad, correct organic/paid scope, dashboard row.
5. Subscribe the remaining promoting Pages to `leadgen`, adding our app only.
6. Backfill the retention window per form with `source = backfill` (metadata only). This exact per-lead backfill is allowed. It does not touch Chatwoot conversations.

## 6. Rollback

1. `META_LEAD_ADS_WORKER_ENABLED=false`.
2. `DELETE /{page_id}/subscribed_apps` for the Engosoft Attribution app only.
3. Revert the deployment. Tables can remain for diagnosis or be dropped. No other system depends on them.

## 7. Open questions before code

- Meta reports messaging conversations started on many instant-form ads. They most likely come from a messaging button on the form's completion screen, but that could not be verified because form configuration was unreadable. Verify once form access is granted. If confirmed, those WhatsApp conversations start after a form submit and need their own evidence path; they must not be counted as CTWA.
- Which systems currently hold Leads Access for the Pages (for example an Odoo or n8n integration)? They must keep working unchanged.
- Retention for `meta_lead_attribution`, aligned with the existing attribution retention setting.
