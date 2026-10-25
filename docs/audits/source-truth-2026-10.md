# Source-truth audit — 2026-10-26

Every figure below was read live, read-only, on 2026-10-26 between 00:50 and 01:35 UTC+3.
Production at the time: `main@dc475d1`, deployed 2026-10-25T20:12Z, Railway project
`Engosoft-Insights-Hub`, environment `production`, service `Engosoft-Insights-Hub`
(port 8080) plus `Postgres`. Both deployments `SUCCESS`.

Validation windows: **SEP** = 2026-09-01 → 09-30 (a closed month) and
**OCT** = 2026-10-01 → 10-25 (complete days only). Monthly figures cover 2026-01 → 2026-10-25.

Nothing in this document is taken from a dashboard API and then checked against another
dashboard API. Each source was read directly — Odoo JSON-RPC, Meta Graph v25, TikTok
Marketing v1.3, Google Ads v25 — with a client written for this audit that imports no
application code, so a bug in the app could not reproduce itself in the "expected" column.

No secret value appears here or in any script added by this work.

---

## 1. What was already correct

This dashboard is in much better shape than its history suggests. These were checked and
hold:

- **CRM counts are exact.** Replicating contract `17.0.1.26.0` against raw Odoo reproduces
  the dashboard to the record, including the exclusion bookkeeping:

  | metric | SEP Odoo | SEP dash | OCT Odoo | OCT dash |
  | --- | --- | --- | --- | --- |
  | CRM active non-Lost | 1,890 | 1,890 | 2,054 | 2,054 |
  | canonical Lost | 1,561 | 1,561 | 1,362 | 1,362 |
  | total leads | 3,451 | 3,451 | 3,416 | 3,416 |
  | Won (active opp, `stage_is_won`) | 234 | 234 | 102 | 102 |
  | excluded recommendation / WA broadcast / autodialer | 95 / 215 / 1 | 95 / 215 / 1 | 94 / 46 / 0 | 94 / 46 / 0 |

  `crmAuthority` and `lostAuthority` both report `odoo-direct`, so this is a live read with
  no snapshot to drift.

- **Meta reconciles exactly.** SEP spend $18,141.04 on both sides; impressions 5,179,820
  and clicks 64,744 identical. OCT $18,966.31 against $18,965.51 — 80 cents on a window
  whose last day is still settling. Meta's own `onsite_conversion.lead_grouped` is 2,216
  and the dashboard reports 2,216.

- **TikTok reconciles exactly** on all four metrics in both windows: SEP $3,982.45 /
  2,845,369 / 9,714 / 675 results; OCT $3,591.01.

- **Google Ads cost reconciles exactly**: SEP $685.629216 to six decimals, OCT
  $522.616664 against $522.622021.

- **All-channel spend is genuinely all channels.** SEP 18,141.04 + 713.26 + 3,982.45 +
  685.63 = 23,522.38 = the dashboard's `spend` of 23,522.379216. The September 2026
  audit's finding #1 (ad spend being Meta only) is fixed and stayed fixed.

- **Negative discount lines are handled correctly on the live path.** Products named
  "21.05% on specific products" and the like carry negative `price_total` on ordinary
  invoices, and the n8n→PostgreSQL path preserves that. January 2026 reconciles to the
  cent: $108,343.76 both sides.

- **ChatGPT Ads is an honest zero**, declared `not_configured` rather than reported as $0
  of real spend.

---

## 2. What was wrong

Severity is about money or decisions, not code.

### A. Ad-set attribution read an empty field — HIGH, fixed

Odoo `crm.lead` carries **two** ad-set pairs:

| field | populated (7,308 leads, 2026-09-01 → 10-26) |
| --- | --- |
| `adset_id` | 5,631 — **77.1%** |
| `adset_name` | 5,488 — **75.1%** |
| `ad_set_id` | 0 — **0%** |
| `ad_set_name` | 0 — **0%** |

`customFieldPlan()` resolved to the first candidate that *existed*, and the candidate list
put `ad_set_id` before `adset_id`. `ad_set_id` exists as an empty duplicate, so it won and
the populated field was never reached. Every direct-Odoo CRM row therefore shipped a blank
"Ad Set ID" and "Ad Set Name", and ad-set attribution fell back to guessing from ad names —
which README item 5 documents as a property of the source ("exported empty on every CRM and
invoice row"). It was not a property of the source. It was this resolution order.

Coverage of the real field on eligible rows: SEP 2,757/3,451 (79.9%), OCT 2,883/3,416 (84.4%).

Also unread, and available: `fb_lead_id` (62.5%), `fb_ad_id` (75.1%), `fb_adset_id` (59.4%),
`fb_campaign_id` (60.0%) — Odoo's own many2one links to Meta objects, which are exact keys
rather than names.

**Fix.** Resolution now keeps every candidate field that exists and each row answers with
whichever one it actually filled in, so both this schema and a mirrored one resolve.
`tests/unit/crm-custom-fields.test.ts` pins the real schema, a real row, and the mirrored
case.

### B. Google's "leads" are YouTube channel subscriptions — HIGH, fixed

September 2026 Google conversions, by action:

| conversions | action | category |
| --- | --- | --- |
| 1,287.00 | YouTube channel subscriptions | ENGAGEMENT |
| 9.38 | Purchase | PURCHASE |
| 0.00 | lead_form_cfm | SUBMIT_LEAD_FORM |
| 0.00 | lead_form_pmp | SUBMIT_LEAD_FORM |
| 0.00 | Sign-up (1) | SIGNUP |

Google produced **zero** lead-form submissions in September. `sheet-cache.server.ts` set
`platformLeads: r.conversions` with no category filter, so the dashboard reported **1,296.38
Google "leads"** on $685.63 of spend — a **$0.53 cost per lead**, roughly ten times better
than Meta — from people subscribing to a YouTube channel. Over 2026-09-01 → 10-25 the same
rule reported 3,062.38 leads where there were **5**.

It compounded: a campaign with any conversion was classified as objective `leads`, so
YouTube awareness spend entered the CPL and CPA denominators as lead spend.

**Fix.** Lead conversions come from their own category-filtered Google query
(`SUBMIT_LEAD_FORM`, `PHONE_CALL_LEAD`, `CONTACT`, `BOOK_APPOINTMENT`, `REQUEST_QUOTE`,
`SIGNUP`, `IMPORTED_LEAD`), joined to the delivery report per ad-day. That segment cannot
join the main query — it repeats an ad-day once per category and would multiply cost — so it
is one extra filtered query per customer. Lead-campaign classification now keys on lead
conversions. `tests/unit/google-lead-conversions.test.ts` pins it, including that the lead
query never selects cost.

### C. Credit notes were over-subtracted — HIGH, fixed

A credit note's lines are not all negative: reversing an invoice that carried a discount
produces a positive line, because the discount is being given back.
`signedCreditAmount(value, isCreditNote)` returned `-Math.abs(value)` per line, which
subtracted that discount a second time.

| document | Odoo `amount_total` | reported | over-subtracted |
| --- | --- | --- | --- |
| RINVNT/2026/00002 | 4,500.00 SAR = **$1,201.51** | −$2,162.71 | $961.20 |
| RINVNT/2026/00003 | 500.00 SAR = **$133.50** | −$356.04 | $222.52 |

February 2026 credit notes are worth $1,976.28 in Odoo and were reported as $3,159.56,
which is why the management overview read **$1,717.77 below Odoo** for February.

**Fix.** Lines keep their own signs and each credit note is anchored per document: the
relative signs inside a document are preserved, and only the document's net is forced to a
reduction. That is correct whether the feed carries Odoo's signs or the negation of them,
which matters because the n8n export's convention is not guaranteed. It runs over the
complete snapshot, before any date window — the net of a partial document says nothing about
its direction. `tests/unit/accounting-credit-note-signs.test.ts` pins both conventions
against Odoo's document totals.

The same `sign * Math.abs(price_total)` shape in `accounting-odoo.server.ts` — the
documented fallback reader for when PostgreSQL is unavailable — would have flipped 34 of
2026's negative discount lines positive, overstating January alone by **$7,490.78**. Also
fixed; the reader now matches the independent Odoo truth exactly for 7 of 10 months, and the
3 remaining differences are entirely the credit-note date policy described in E.

### D. The same labelled number differed between two pages — HIGH, fixed

"Collections / التحصيل" for one window:

| month | /api/accounting | /api/overview | gap |
| --- | --- | --- | --- |
| 2026-02 | 98,632.28 | 95,472.72 | $3,159.56 (3.3%) |
| 2026-07 | 110,443.29 | 110,016.06 | $427.23 |
| 2026-10 | 85,766.18 | 85,499.17 | $267.01 |

`/api/accounting` dropped credit notes on its default Payment Date view
(`rows.filter(row => !row.isCreditNote)`) while `metrics.server` kept them. A manager
comparing the Accounting page with the management overview saw two different answers for the
same dates.

**Fix.** Credit notes are reported on both bases; `accountingReportingDate` already decides
where one lands, so both surfaces now net the same documents. The credit-note reconciliation
that recovers documents missing from the snapshot runs on both bases too, and the page's
credit-note panels are no longer hidden on the payment view.

### E. Credit notes mix two date bases inside one number — HIGH, reported not changed

`accountingReportingDate()` always dates a credit note by `invoiceDate`, while invoices are
dated by `paymentDate`. July 2026 proves the effect: Odoo has **no** payment-dated July
refund, yet the overview sat $427.23 below Odoo — exactly the two credit notes invoiced
2026-07-20 ($427.20). So "the money collected this period" nets cancellations that were
never collected in it.

The code comment says this is deliberate, so a cancellation reduces the month it was
actually cancelled. That is a defensible finance policy and the kind of thing that should be
decided by the people who sign the accounts, not changed in an audit. What is **not**
defensible, whatever the policy:

- **An unpaid credit note can reduce "collections".** `RINVNT/2026/00020`, invoice date
  2026-10-11, $667.71, is `posted` with `payment_state = not_paid`. Nothing was refunded.
  The direct reader subtracts it from October; it is absent from the live snapshot only
  because it has no payment date, which is itself inconsistent with an invoice-date policy.
- The number cannot be tied to Odoo on either basis, because it is neither.

**Recommendation.** Either date a credit note by the date its refund was actually paid (and
exclude unpaid ones from a collections figure), or keep the reversal-date policy and exclude
`payment_state = not_paid`, and say so in the UI. Left for a decision — see §6.

### F. Two September invoice lines are missing from the stored dataset — HIGH, upstream

Both surfaces understate September by **$5,324.93 (3.36%)**. The lines exist in Odoo and are
ordinary posted `out_invoice` lines, not credit notes:

| invoice | line id | amount | product |
| --- | --- | --- | --- |
| INVNT/2026/002369 | 230050 | SAR 4,370.00 = $1,166.80 | `[246] CFM - Professional Certificate Registration` |
| INVNT/2026/002731 | 230037 | SAR 15,573.45 = $4,158.13 | `[246] CFM - Professional Certificate Registration` |

The other lines of both invoices are present, so this is a per-line drop in the n8n export,
not a missing document. These are the only two `[246]` lines in the entire year, which fits
"product 246 is excluded upstream" — but that cannot be confirmed from this repository,
because the export lives in n8n. **This is the one material money error still open.**

The new reconciliation report detects it automatically from now on; it is exactly the case
that no internal comparison could ever have caught.

### G. Stale rows the snapshot never removes — MEDIUM, upstream

Rows the dashboard still has that Odoo's current report no longer does: 2026-05 two rows
(+$173.55), 2026-06 eleven rows (+$854.48), 2026-02 five rows. Nothing prunes them, so
closed months keep drifting. Full monthly reconciliation:

| month | Odoo (incl. credit notes) | /api/accounting | /api/overview | verdict |
| --- | --- | --- | --- | --- |
| 2026-01 | 108,343.76 | 108,343.76 | 108,343.76 | matched |
| 2026-02 | 97,190.49 | 98,632.28 | 95,472.72 | both off, opposite directions |
| 2026-03 | 90,794.21 | 91,194.73 | 90,794.21 | overview matched |
| 2026-04 | 105,791.21 | 105,791.21 | 105,791.21 | matched |
| 2026-05 | 88,195.38 | 88,368.93 | 88,195.38 | overview matched |
| 2026-06 | 106,680.95 | 107,668.94 | 106,680.95 | overview matched |
| 2026-07 | 110,443.29 | 110,443.29 | 110,016.06 | accounting matched |
| 2026-08 | 138,187.36 | 139,255.39 | 138,187.36 | overview matched |
| 2026-09 | 163,715.70 | 158,390.77 | 158,390.77 | **both short $5,324.93** |
| 2026-10 | 85,499.17 | 85,766.18 | 85,499.17 | overview matched |
| **total** | **1,094,841.51** | 1,093,855.49 | — | **−$986.02 (0.09%)** |

### H. Snapchat cannot be validated by anyone — HIGH, blocked

Snapchat reports SEP $713.26 and OCT $731.31 across two accounts ("Engosoft general",
"Engosoft Global Self Service"), but there are **no Snapchat credentials in Railway** and no
Snapchat entry in `health.platformSources` — Meta, TikTok and ChatGPT appear there, Snapchat
and Google do not. The number arrives through n8n/the sheet with no independent check and no
freshness indicator, and until today it sat beside three verified numbers looking just as
confident.

To close it: Snapchat Marketing API OAuth client id and secret, a refresh token, and the ad
account ids. The reconciliation report now reports it as `SOURCE_UNAVAILABLE` and says why.

### I. FX is a fixed business rate, far from Odoo's own — MEDIUM, disclosure

| currency | dashboard | Odoo today | gap |
| --- | --- | --- | --- |
| EGP per USD | 50.5 | **55.31** | USD revenue reads ~9.5% high |
| SAR per USD | 3.7453 | 3.7518 | ~0.2% |
| USD per AED | 0.27 | 0.27229 | ~0.8% low |

The EGP and SAR rates are documented as "business-approved fixed rates" and are overridable
per request; **the AED rate is hardcoded in three places and is not**. One fixed rate is
also used for the whole year rather than the rate on the payment date. 2026 EGP collections
are small ($7,295 in SEP, $2,638 in OCT) so little money is at stake, but the figure cannot
be tied to Odoo's own USD and no UI text says which rate produced it. Left as-is: it is a
finance policy, not a defect. It is now stated in the reconciliation note.

### J. Pre-existing broken checks — MEDIUM, one fixed

- `npm run test:crm-contract` **failed on main**: it pinned
  `CRM_SNAPSHOT_SCHEMA_REVISION` to `normal-crm-inventory-scope-v3` while the code shipped
  `v4-stage-sla-utc`. Fixed, with a comment saying why the pin has to move deliberately.
- `npm run lint` **still fails on main** and continues to: unmodified files such as
  `tests/profitability-currency.test.ts` violate the repo's own prettier rules. Not touched —
  reformatting files unrelated to this work would bury the diff. It needs one `npm run
  format` commit of its own.
- Two Arabic column-name fallbacks in `sheet-cache.server.ts` were double-encoded in the
  source and could never have matched a real Arabic header. Fixed; they only fed a
  source-selection diagnostic.

### K. Environment gaps — MEDIUM

76 variables in production. Every source credential is present except as noted.

| item | state |
| --- | --- |
| `OPENAI_ADS_API_KEY` / `_KEYS` | absent → ChatGPT Ads is a declared zero |
| Snapchat (any variable) | absent → see H |
| `META_LEAD_ADS_ACCESS_TOKEN` | absent **while `META_LEAD_ADS_WORKER_ENABLED=true`** — the worker runs every 30 s with no credential |
| `META_ATTRIBUTION_AD_ACCOUNT_ID` | absent → falls back to a hardcoded `act_405972484493798` literal in code |
| `CHATWOOT_WEBHOOK_SECRET` | absent; the legacy shared-secret path still authenticates, so the webhook is not open |
| `ENGOSOFT_SSO_SECRET`, `REVENUE_TAB_PASSWORD_HASH` | absent → those gates are inactive |
| `DEEPGRAM_API_KEY`, `DEEPGRAM_MODEL`, `DEEPGRAM_LANGUAGE`, `YEASTAR_TIMEZONE` | set but referenced nowhere in code — unused secrets worth removing |
| `.env.example` | lists `GOOGLE_ADS_END_DATE`, `PORT`, `OPENAI_ADS_*` that no code reads |
| `TIKTOK_ADVERTISER_IDS` | 6 ids, of which 3 return no rows at all |

Meta's 8 ad accounts span **two timezones** (Africa/Cairo ×4, Asia/Riyadh ×4), so Meta's
daily buckets are account-local rather than one company calendar. All 8 are USD.

---

## 3. Which numbers changed, and why

| number | before | after | why | proof |
| --- | --- | --- | --- | --- |
| Google platform leads (SEP) | 1,296.38 | 0 | only lead-category conversions count | Google Ads v25 conversion-action breakdown |
| Google platform leads (2026-09-01→10-25) | 3,062.38 | 5 | same | same |
| Google platform CPL (SEP) | $0.53 | — (no leads) | denominator was YouTube subscriptions | same |
| Feb 2026 collections, overview | 95,472.72 | ~97,190 | credit notes no longer over-subtracted | `account.move.amount_total` per document |
| Feb 2026 collections, accounting page | 98,632.28 | ~97,190 | credit notes no longer dropped on the payment view | same |
| CRM "Ad Set ID" / "Ad Set Name" | empty on every row | populated on ~77% / ~75% | read from the field Odoo fills | `fields_get` + population counts |
| Jan 2026, direct reader only | would read 115,834.54 | 108,343.76 | discount lines keep their sign | 19 negative discount lines |

No CRM count, no Meta figure, no TikTok figure and no Google cost changed: they were already
right, and the tests now say so.

---

## 4. The reconciliation system

`src/lib/source-reconciliation.server.ts` asks each originating system directly and records,
per metric: `metricId`, label, period, filters, `sourceSystem`, `sourceEntity`,
`sourceValue`, `dashboardValue`, `difference`, `differencePercent`, `status`,
`lastCheckedAt`, plus a plain-Arabic note, the reason a source could not be read, and the
pages that depend on it.

Statuses: `MATCHED`, `SMALL_DIFFERENCE`, `MISMATCH`, `SOURCE_UNAVAILABLE`, `STALE`,
`NOT_VALIDATED`. A group rolls up to its **worst** member, never its best, and
`SOURCE_UNAVAILABLE` outranks a small difference — a number nobody can check is not green.

Thresholds: money matches within $1 or 0.05% (a settling last day is not a finding), is a
small difference to 1%, and a mismatch beyond; counts must be **exact** to match.

Eleven checks today: Odoo records created (via Odoo's own `search_count`, so Odoo's SQL
answers rather than the app's row loop), Odoo collections, Odoo invoice count, Meta spend /
impressions / leads, TikTok spend, Google spend / leads, Snapchat (always
`SOURCE_UNAVAILABLE`, with the reason), and the all-channel total — which can be at best
`SMALL_DIFFERENCE` because Snapchat is in it unverified.

Surfaces:

- `GET /api/source-reconciliation?from=&to=[&force=1]` — cached 10 minutes.
- **`/number-review`** ("مراجعة الأرقام"), in Advanced tools. Each source is a card; each
  number opens to show the source value, the dashboard value, the difference, when it was
  last checked, and what the status means in plain Egyptian Arabic. Model names, API
  entities, metric ids and affected pages sit behind "تفاصيل تقنية".
- `npm run audit:sources [-- --from … --to …] [--force]`, or
  `AUDIT_API=https://<deployment> npm run audit:sources` to check what production actually
  serves. It prints SOURCE / METRIC / SOURCE VALUE / DASHBOARD VALUE / DIFFERENCE / STATUS,
  lists anything unverified, and exits non-zero only on a `MISMATCH`.

---

## 5. Tests

Added, all passing: `crm-custom-fields` (6), `google-lead-conversions` (4),
`accounting-credit-note-signs` (6), `source-reconciliation` (8). Each carries the live
figures it was written from, so a regression reads as a contradiction of recorded evidence
rather than a bare number change.

Suite: **1,207 vitest tests across 103 files pass**; `tsc --noEmit` clean; `npm run build`
succeeds. Ten standalone script tests pass, including `test:crm-contract` which did not
before.

**Not done, and why:** the built server could not be started locally — this sandbox refuses
to bind a local port (`EPERM`) — so the README's `npm run build && npm run start` plus
`/api/filters` smoke test, and any rendered visual check of `/number-review`, were not
performed. The route typechecks, builds, and its pure logic is unit-tested; the request path
has not executed. Either `sandbox.network.allowLocalBinding: true` or a deploy is needed to
close that.

---

## 6. Still open

1. **September is short $5,324.93** — two `[246]` invoice lines dropped by the n8n export
   (§F). Needs the n8n workflow inspected; it is outside this repository.
2. **Stale snapshot rows** in closed months (§G) — nothing prunes them.
3. **Snapchat is unverifiable** (§H) — needs credentials.
4. **Credit-note date basis** (§E) — a finance decision, plus the unpaid-credit-note case,
   which should be excluded from a collections figure under any policy.
5. **`npm run lint` fails on main** (§J) — needs its own formatting commit.
6. **Meta Lead Ads worker enabled without a token**; unused Deepgram/Yeastar secrets;
   3 dead TikTok advertiser ids (§K).
7. **The UI rebuild** — the colour system, management page, campaign drill-down, table and
   chart work, navigation restructure and the breakpoint/RTL visual pass were not started.
   The data work came first by instruction, and a half-rebuilt dashboard is worse than a
   clearly unstarted one.
