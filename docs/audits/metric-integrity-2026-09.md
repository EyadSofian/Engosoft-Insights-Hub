# Metric integrity audit — reference period 2026-09-01 → 2026-09-15

Branch: `fix/metric-integrity-reporting-contract` (base `origin/main` 259950e).
Every figure below was read from live production (read-only) on 2026-09-15 between 19:18 and 20:15 UTC.
The screenshots were taken earlier the same day; the rolling Meta refresh added the rest of 15 Sept
afterwards, which explains 7,648 → 7,760.05 and 6,309 → 6,419.90. No expected number is hardcoded anywhere.

## 1. Root causes

| # | Finding | Evidence |
|---|---|---|
| 1 | Marketing Overview "Ad spend" was **Meta only** under an "All channels" filter. `getClosedLoop` accepted `from/to` only and `loadSpend` read `dataset = 'meta_ads'`. | Overview $7,760.05 vs `/api/ads` all-channel $10,312.88 |
| 2 | Two engines computed overlapping KPIs with different populations: `metrics.server` (all platforms, CRM by creation date, Accounting by payment date) and `closed-loop` (Meta exact attribution, cohort revenue). | — |
| 3 | "العملاء المحتملون / Leads" counted **acquisition events**, not people: 3,308 Chatwoot conversations (3,221 distinct contacts, 0 exact) + 1,076 Meta form leads + 1 landing submission. | 4,385 events vs 1,841 unique CRM records |
| 4 | "Paid revenue" was a **lead-cohort** figure (all payment dates of leads created in the window) divided by period spend under a generic "ROAS" label. | $9,943.77 cohort vs $47,611.43 payment-date collections |
| 5 | Closed-loop revenue used stored `$ Sales`; the Accounting authority recalculates EGP/SAR at the dashboard FX rates (EGP 50.5, SAR 3.7453). | Period collections: $42,414.63 stored vs $47,611.43 authority |
| 6 | "CRM match rate" divided Meta-exact matches by all events (mixed populations). | 1,076 ÷ 4,385 |
| 7 | Lost: the cohort `lost` and closure movement were computed separately per screen; employee ranking had no closure-based ranking; loss reasons were grouped on raw bilingual text. | "Not Interested" 58 and "غير مهتم" 44 as separate bars |
| 8 | Three different contact-matching implementations: `employee-evidence` read only `phone \|\| mobile`, ignored Chatwoot, and turned a Calls Hub failure into "no calls". | 4,299 CRM/Lost records have a mobile different from the phone |

## 2. Reconciliation — before

### A. Spend (ad-spend date, USD)

| Source | Rows | Spend |
|---|---:|---:|
| Meta (`meta_ads`, all rows carry an ad ID, 1,612 ad-days, no duplicates) | 1,612 | 7,760.05 |
| Snapchat (`snap_ads`) | 64 | 237.44 |
| TikTok (live API) | 2,237 | 1,968.22 |
| Google Ads (live API) | 44 | 347.17 |
| ChatGPT Ads (not configured, 0 leads) | 0 | 0 (known zero) |
| **`/api/ads` all channels** | | **10,312.88** |
| Closed-loop Overview "Ad spend" | | 7,760.05 (Meta only) |
| Tracked (Meta campaigns with ≥1 exact lead) | | 6,419.90 |
| Unexplained difference | | **0.00** — 10,312.88 − 7,760.05 = 2,552.83 = Snapchat + TikTok + Google |

### B. Leads / acquisitions

| Population | Count |
|---|---:|
| Acquisition events (all) | 4,385 |
| Meta form leads (CRM-carried provider lead ID, all exact) | 1,076 |
| Meta Lead Ads direct acquisitions (token not connected) | 0 |
| Meta-reported on-platform form leads (Ads API, aggregate) | 1,162 |
| Chatwoot conversations (WhatsApp 2,872 · Facebook 243 · API 188 · web 5) | 3,308 |
| Landing submissions | 1 |
| Unique CRM records created (1,557 active + 284 Lost) | 1,841 |
| Exact CRM matches / inferred / ambiguous / unmatched | 1,076 / 290 / 51 / 2,968 |

### C. Revenue (USD)

| Basis | Value |
|---|---:|
| 1. Payment-date paid revenue (Accounting authority, FX) | 47,611.43 |
| 1b. Same lines, stored `$ Sales` | 42,414.63 |
| 2. Invoice-date revenue (stored `$ Sales` basis only) | 51,823.86 |
| 3. Lead-cohort revenue, all CRM created in window (FX authority) | 21,819.82 |
| 4. Campaign-attributed revenue (`/api/ads`, campaign-key match, payment date) | 18,808.91 |
| 5. Exact closed-loop revenue (stored `$ Sales`, cohort) | 9,943.77 |
| 6a. Unattributed, payment-date basis (47,611.43 − 18,291.74 exact) | 29,319.69 |
| 6b. Unattributed, cohort basis (21,819.82 − 9,943.81 exact) | 11,876.01 |

## 3. After — the new reporting contract

### Marketing Overview

| KPI | All channels | Meta selected | Snapchat / TikTok / Google |
|---|---:|---:|---|
| Ad spend (scope) | 10,312.88 | 7,760.05 | platform spend, or `pending_sync` if leads exist without spend |
| Unique CRM leads created | 1,841 | 1,113 | platform CRM leads |
| Won customers (CRM cohort) | 68 | 27 | platform won |
| Paid collections (payment date) | 47,611.43 | 21,117.57 | platform-linked collections |
| Collections ÷ spend (labelled "not attributed") | 4.62× | 2.72× | — |
| Acquisition events (label fixed) | 4,385 | 1,076 | events with that source platform |
| Exact attributed acquisitions / unique CRM leads | 1,076 / 1,076 | same | **not available** |
| Qualified / Won (exact) | 56 / 26 | same | **not available** |
| Cohort paid revenue (exact, FX authority) | 9,943.81 | same | **not available** |
| Cohort ROAS on all **Meta** spend | 1.28× | same | **not available** |
| Cohort ROAS on tracked Meta campaigns | 1.55× | same | **not available** |
| Exact CRM match rate (events ÷ events in scope) | 24.5% | 100% | **not available** |

Revenue reconciliation (shown on the Overview):

| Basis | Accounting total | Exact | Inferred | Unattributed | Coverage |
|---|---:|---:|---:|---:|---:|
| Payment date in window | 47,611.43 | 18,291.74 | 0.00 | 29,319.69 | 38.4% |
| Leads created in window (1,853 CRM records) | 21,819.82 | 9,943.81 | 0.00 | 11,876.01 | 45.6% |

After-figures come from the same engines the new code calls (`/api/ads` totals) and from a read-only SQL
replica of the Accounting FX formula for the revenue split. That replica matches the live Accounting authority
exactly: 47,611.43, with 0 duplicate rows. The new code was **not** executed against production, because doing so
would issue `CREATE TABLE IF NOT EXISTS` and could trigger snapshot bootstrap writes.

### Lost (live `/api/lost`, same inputs the new classification uses)

| Population | Value |
|---|---:|
| cohortLost (created in window, now Lost) | 286 |
| closedLostInPeriod (Lost/Close Date in window) | 894 |
| createdAndLostInPeriod | 276 |
| olderCohortClosedLostInPeriod + undatedCohortClosedLostInPeriod | 618 (split computed at runtime) |

Canonical reasons, cohort Lost: not_interested 102 (Not Interested 58 + غير مهتم 44) · duplicate 69 ·
did_not_register 34 · not_reached 19 · budget_low 17 · wrong_number 12 · registered_with_competitor 9.

## 4. Figures that cannot yet be independently verified

1. **Closed Lost 894.** The stored `Closing Date`/`Lost Date` columns give 481 closures in the window. `Closing Date` holds
   the literal `false` on 10,286 of 20,857 Lost rows, and `lostAuthority` is `postgres-last-good`. The 413-row gap needs an
   app-level trace of Lost row construction.
2. **CRM cohort drift.** The 19:40 UTC link-graph refresh read 1,699 records created in the window (915 with a Meta lead ID).
   The readings before (1,841) and after (1,853) are consistent with the CRM dataset. The likely cause is a refresh overlapping
   a CRM sync. The new `crm_sync_incomplete` health indicator flags CRM syncs newer than the graph.
3. The new engine's after-values must be confirmed after deploy via
   `/api/acquisition/closed-loop?from=2026-09-01&to=2026-09-15` (and `&platform=meta|snapchat|tiktok|google`).
4. Invoice-date revenue is reported on the stored `$ Sales` basis only.

## 5. External items (not in this repository)

- **"Problem finished" notification.** It is not produced by this repository. It is `handleResolveSurveyWebhook` in `EyadSofian/Chatwoot-Actions`
  (`src/operations.js`), fired on `conversation_status_changed → resolved` when `RESOLVE_SURVEY_ENABLED` is on. It sends
  `RESOLVE_SURVEY_ACK_TEXT` (default "تم تسجيل بياناتك بنجاح ✅"), then a rating request. Setting `RESOLVE_SURVEY_ACK_TEXT` to
  an empty string removes only the acknowledgement; the code skips it when empty. Chatwoot webhooks 8 and 9 both
  point at the same Chatwoot-Actions host.
- **Egyptian WhatsApp.** Chatwoot is 4.12.1 with four WhatsApp Cloud inboxes, all +966. The PBX has an Egyptian trunk (`Egp_GW`).
  A PBX trunk does not make a number eligible for the WhatsApp Business Platform. The following are still required:
  - the number itself
  - proof that it is not registered on WhatsApp or another WABA
  - Meta Business verification and WABA access
  - phone-number registration and display-name approval
  - the Cloud API `phone_number_id`, `business_account_id` and a system-user token for a new Chatwoot inbox

  The code already normalises +20 numbers (`normalizePhone`).
