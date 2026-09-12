# ChatGPT Ads integration

This integration makes `chatgpt` a native paid-media platform in the same
normalized path as Meta, Snapchat, TikTok, and Google Ads:

```text
OpenAI Ads API
  -> one-ad x one-day AdRow + separate AdCreative
  -> shared filters and performance dimensions
  -> Odoo campaign/ad attribution
  -> paid Accounting invoice lines
  -> CPL / CPA / ROAS / ACOS and Creative Analytics
```

The implementation follows the official [Advertiser API overview](https://developers.openai.com/ads/api-overview),
[authentication reference](https://developers.openai.com/ads/api-reference/authentication),
[Insights reference](https://developers.openai.com/ads/api-reference/insights), and
[Ads resource reference](https://developers.openai.com/ads/api-reference/ads).

## API contract used

- Base URL: `https://api.ads.openai.com/v1`.
- Authentication: `Authorization: Bearer <Ads API key>`. Each key is scoped to
  one ad account; no account id is configured separately.
- `GET /ad_account` supplies account id, name, timezone, status, and currency.
- Cursor-paginated `GET /campaigns`, `GET /ad_groups?campaign_id=...`, and
  `GET /ads?ad_group_id=...` supply hierarchy, status, review state, and creative
  metadata.
- Cursor-paginated `GET /ad_account/insights` uses `aggregation_level=ad`,
  `time_granularity=daily`, and an account-timezone `date_range`. It supplies
  spend, impressions, and clicks at the target one-ad x one-day grain.
- `POST /conversions/insights` supplies click-through conversion totals. A
  failed conversion read does not fail delivery reporting: conversions remain
  `null`, never a fabricated zero. OpenAI documents view-through conversions
  as a separate campaign-level metric when enabled for the account; they are
  not included in `Conversions`, so the adapter does not relabel click-through
  conversions or invent an ad-level view-through number.
- Resource pages use the documented maximum of 500 rows; insights pages use
  2,000. Requests are paced below the documented 600 requests/minute per
  endpoint limit and retry 408/409/429/5xx responses with backoff and
  `Retry-After` support.

OpenAI currently exposes spend, impressions, clicks, CTR, CPC, CPM, and
conversion reporting. Engosoft recomputes ratios from additive facts. The API
does not expose a Meta-equivalent link-click metric or view-completion metric,
so `linkClicks`, link CTR, and `viewCompletions` remain `null` for ChatGPT Ads.

Only USD ad accounts enter Engosoft's USD spend totals. A non-USD account fails
closed with a named health error rather than mixing currencies.

## Storage and failure behavior

`src/lib/openai-ads.server.ts` keeps a 30-minute in-memory cache and deduplicates
concurrent refreshes. Successful daily facts are upserted into the PostgreSQL
`chatgpt_ads` dataset, so refreshing a short window cannot delete older dates.
Creative resources are stored separately in `chatgpt_ad_creatives` and replace
only the successfully refreshed account's current creative set.

If credentials are absent, invalid, rate-limited, or OpenAI is unavailable, the
adapter reads the PostgreSQL last-good facts and creatives where available.
ChatGPT health is exposed under `health.platformSources.chatgpt`; failure never
removes Meta, Snapchat, TikTok, Google, CRM, or Accounting rows.

## Attribution contract

OpenAI supports static landing-page query parameters and these documented
dynamic values: `{ad_account_id}`, `{campaign_id}`, `{ad_group_id}`, and
`{ad_id}`. Configure this template in Ads Manager at campaign level (or at the
ad-group/ad level when an override is needed):

```text
utm_source=chatgpt&utm_medium=paid&utm_campaign={campaign_id}&chatgpt_campaign_id={campaign_id}&chatgpt_ad_group_id={ad_group_id}&chatgpt_ad_id={ad_id}
```

Do not invent other macros. OpenAI also appends an opaque `oppref` click
reference; the website must preserve it through redirects.

The landing form / website integration must write:

- `utm_source=chatgpt` into the Odoo source mapped to `ChatGPT` or `ChatGPT Ads`;
- `chatgpt_campaign_id` into Odoo's existing Campaign ID custom field;
- `chatgpt_ad_group_id` into the existing Ad Set / Ad Group ID field;
- `chatgpt_ad_id` into the existing Ad ID field;
- the resolved campaign/ad names when those display fields are populated; and
- `oppref` into a dedicated opaque text field for later conversion matching.

The dashboard's acquisition mapping recognizes `chatgpt`, `chatgpt ads`,
`openai`, and `openai ads` as paid ChatGPT traffic. Stable campaign and ad IDs
win over names. Existing Odoo CRM stages define Lead, Won, and Lost, and paid
Accounting invoice lines remain the revenue authority. The resulting join is:

```text
ChatGPT ad_id -> Odoo lead Ad ID -> Won/Lost opportunity -> paid invoice line -> revenue / spend
```

The website/form code is not present in this repository, so query capture,
redirect preservation, and the new `oppref` Odoo field must be implemented in
the external website/Odoo customization before new clicks can attribute end to
end.

## Conversion feedback design

OpenAI officially supports the [Measurement Pixel](https://developers.openai.com/ads/measurement-pixel)
and server-side [Conversions API](https://developers.openai.com/ads/conversions-api).
The supported taxonomy includes `lead_created` and `order_created`; qualification
and Won are represented as documented custom events. The prepared server-only
module maps:

| Engosoft authority               | OpenAI event                |
| -------------------------------- | --------------------------- |
| Odoo lead created                | `lead_created`              |
| Odoo qualified lead              | `custom` / `qualified_lead` |
| Odoo Won opportunity             | `custom` / `won_deal`       |
| Positive paid Accounting invoice | `order_created`             |

`src/lib/openai-conversions.server.ts` validates the official seven-day event
window, hashes supported customer identifiers, retains `oppref`, uses stable
Odoo IDs for deduplication, converts money to ISO currency minor units, and
defaults every send to `validate_only: true`. It is deliberately not called by
any route or job. Pixel/CAPI consent, the exact qualification/Won definitions,
and the point at which a paid invoice becomes immutable must be approved before
a worker sends production events. When Pixel and CAPI both send the same event,
reuse the same event ID so OpenAI can deduplicate it.

## Required account setup

1. Open [OpenAI Ads Manager](https://ads.openai.com), select the Engosoft ad
   account, open **Settings**, and issue an Ads API key. Put it in Railway as the
   sensitive server variable `OPENAI_ADS_API_KEY`. For another ad account, issue
   another account-scoped key and put all keys in `OPENAI_ADS_API_KEYS` as a
   comma/newline list or JSON string array. The official API documents no
   separate read scope for account keys.
2. Confirm `GET /ad_account` reports the expected account, account timezone, and
   `USD` currency. No account ID environment variable is needed because the key
   selects the account.
3. In each campaign, ad group, or ad edit modal, open **Landing page query
   parameters** and save the tracking template above. Configure at campaign
   level unless a lower level intentionally overrides it.
4. Update the external Engosoft landing form/redirect and Odoo integration to
   store the three stable IDs and `oppref` as described above.
5. If conversion feedback is approved, open Ads Manager **Conversions**, create
   a Pixel/data source and a Conversions API key, then set
   `OPENAI_ADS_PIXEL_ID` (identifier) and
   `OPENAI_ADS_CONVERSIONS_API_KEY` (sensitive secret). Install the Pixel on the
   external website with the required consent flow. Keep the server sender in
   validation mode until test events reconcile with Odoo.

Never put Ads or Conversions API keys in `VITE_*`, browser code, committed
configuration, logs, or API responses.
