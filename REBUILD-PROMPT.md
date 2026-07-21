# Engosoft Insights Hub — Rebuild Prompt (v3)

Paste everything below into your coding agent. It assumes the existing repo
(`EyadSofian/Engosoft-Insights-Hub`, TanStack Start + Vite + Tailwind v4 +
Recharts, reads a public Google Sheet, deploys on Railway).

Product is bilingual (Arabic RTL default / English). This prompt is in English
for the agent.

---

## 0. What changed since the last build

Three things invalidate previous assumptions. Handle them first.

**a) Meta ads now cover the full year.** `Meta Ads Daily` holds 8,762 rows
spanning **2026-01-01 → 2026-07-19** ($61,836 spend, 13,348 platform leads).
Previously it was a 17-day window, and the app defaulted the global date range to
that window and warned about a spend/revenue period mismatch.

→ **Remove the Meta-window default and the mismatch warning.** New default range
is **this year to date**. Keep the presets (7d / 30d / this month / this year /
all time / custom). Keep `inRange()` excluding undated rows when a filter is
active — that guard is still required.

**b) Snapchat was added** as a second ad platform, in a tab named
**`Snap Ads Daily`**. It is NOT shaped like Meta — see §1.

**c) A second unattributed ad account appeared:** `114732099069544` (raw id, no
friendly name), $146 spend, 0 leads.

---

## 1. Data sources — exact tabs and columns

Google Sheet id in `SHEET_ID`. Read every tab as CSV via the gviz endpoint.
Never write to the sheet.

### `Meta Ads Daily` — grain: ad × day

`التاريخ`, `اسم الحساب الإعلاني`, `اسم الكامبين`, `Ad set name`, `Ad Name`,
`Spend (Cost)`, `العملة`, `Impressions`, `Link Clicks`, `Clicks (all)`,
`CTR (all)`, `CTR (link)`, `Leads (on facebook Leads)`, `Leads (Website/Pixel)`,
`Leads (Total)`, `CPL (Cost/Lead)`, `__campaign_id`, `__adset_id`, `__ad_id`,
`__account_id`, `__synced_at`

### `Snap Ads Daily` — grain: ad × day — **different shape, do not assume Meta's**

`التاريخ`, `اسم الحساب الإعلاني`, `اسم الكامبين`, `Ad set name`, `Ad Name`,
`Spend (Cost)`, `العملة`, `Impressions`, `Clicks (all)`, `CTR (all)`,
`View Completions`, `Leads (Native)`, `__snap_key`, `__account_id`, `__campaign_id`, `__adset_id`,
`__ad_id`, `__synced_at`

Differences that will break naive code:

- **No `Link Clicks`, no `CTR (link)`** → link-CTR must render `—` for Snapchat.
- **Native leads are available** → sum `Leads (Native)` for platform leads.
  Missing link clicks remain `null`, not `0`.
- Ids are UUIDs, not numeric.
- Current data: 39 rows, 2026-07-13 → 2026-07-19, $191 spend, one account
  (`Engosoft Global Self Service`).

Build a normalized `AdRow` union with a `platform: "meta" | "snapchat"` field and
`linkClicks?: number | null`, `platformLeads?: number | null`. Every ads metric
must aggregate across both platforms, with a platform filter in the UI and a
per-platform split on the ads page.

### `CRM Leads` — grain: one lead (18,184 rows, 2026 only)

Key columns: `أنشئ في` (created), `التاريخ المقفل` / `Closing Date` (closed),
`أيام الإقفال` (days to close), `Campaign Name`, `Campaign ID`, `Ad Name`,
`Ad ID`, `Ad Set Name`, `Ad Set ID`, `Salesperson`, `Sales Team`,
`فريق المبيعات`, `Stage`, `Cleaned Stage`, `Source`, `cleaned Source`, `Course`,
`Main Category`, `Priority`, `Month`, `إجمالي الطلبات`, `عدد أوامر البيع`,
`عدد عروض الأسعار`, `سبب الضياع`

### `Full Invoiced Orders` — grain: order line (6,919 rows)

`بنود الطلب /مرجع الطلب`, `Campaign Name`, `الفرصة /Campaign ID`, `AD Name`,
`AD Set Name`, `الفرصة /Ad ID`, `بنود الطلب /المنتج`, `بنود الطلب /العميل`,
`بنود الطلب /الإجمالي`, `بنود الطلب /مندوب المبيعات`, `$ Sales` (already USD),
`Course`, `Main Category`, `Sales Team`, `Team`, `Source`, `Cleaned Source`,
`Invoice Date`, `Date`, `Month`

**`Invoice Date` is blank on ~93% of rows — keep using `Date` as `revenueDate`.**
This is already fixed in the repo; do not regress it.

### `Sales` — grain: invoice/payment line (7,583 rows)

`Payment Date`, `تاريخ الفاتورة`, `Course Name`, `فئة المنتج`, `الشريك`,
`Salesperson`, `Team Leader`, `فريق المبيعات`, `$ Sales`, `Event Stage`

### `Lost Analysis` — grain: lost lead (6,567 rows)

`Campaign Name`, `Campaign ID`, `Ad Name`, `Ad Set Name`, `سبب الضياع`, `Course`,
`Main Category`, `فريق المبيعات`, `مندوب المبيعات`, `cleaned Source`, `Month`,
`أنشئ في`, `Cleaned Stage`

### Lookups

`Sales Team`, `Stages`, `Courses`, `Value to dolar` (reference only — `$ Sales`
is already USD, never re-convert).

---

## 2. Metric definitions — implement exactly these

Guard every division against zero and render `—` (never `0`, never `NaN`,
never `Infinity`).

| Metric                | Formula                                     | Notes                                                                                                                                                                        |
| --------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Spend**             | `Σ Spend (Cost)` across selected platforms  |                                                                                                                                                                              |
| **Total leads (ads)** | Meta form leads + Snapchat `Leads (Native)` | keep unavailable metrics as null                                                                                                                                             |
| **Total leads (CRM)** | count of CRM rows in window                 | the denominator the manager means                                                                                                                                            |
| **CPL**               | `Spend ÷ CRM leads`                         | **Business definition: total spend ÷ total leads that entered the CRM.** Also expose `platformCPL = Spend ÷ platform leads` separately on the ads page, labelled distinctly. |
| **ACOS**              | `(Spend ÷ Revenue) × 100`                   | shown as a %; lower is better; the inverse of ROAS                                                                                                                           |
| **ROAS**              | `Revenue ÷ Spend`                           | shown as `×`; green ≥ 2, amber 1–2, red < 1                                                                                                                                  |
| **CPA**               | `Spend ÷ acquisitions`                      | **acquisitions is user-selectable: invoices count OR won leads count.** Ship a toggle on the KPI card and in filters; default = won leads. Show both in the tooltip.         |
| **CTR (all)**         | `(Σ Clicks(all) ÷ Σ Impressions) × 100`     | recomputed from sums; never average the column                                                                                                                               |
| **CTR (link)**        | `(Σ Link Clicks ÷ Σ Impressions) × 100`     | Meta only; `—` for Snapchat                                                                                                                                                  |
| **CPM**               | `(Spend ÷ Impressions) × 1000`              |                                                                                                                                                                              |
| **CPC**               | `Spend ÷ Clicks(all)`                       |                                                                                                                                                                              |
| **Won**               | CRM rows where `Cleaned Stage = Won`        |                                                                                                                                                                              |
| **Conversion rate**   | `(Won ÷ CRM leads) × 100`                   | show **count and %** side by side everywhere                                                                                                                                 |
| **Lost rate**         | `(Lost ÷ CRM leads) × 100`                  | Lost = `Cleaned Stage = Lost`                                                                                                                                                |
| **Avg close time**    | mean of `Closing Date − أنشئ في` in days    | **only over leads that actually have a closing date; always print the sample size next to it** (see §8c)                                                                     |
| **Revenue**           | `Σ $ Sales`                                 | from Full Invoiced Orders for campaign-level; from Sales tab for the revenue page                                                                                            |
| **Revenue per lead**  | `Revenue ÷ CRM leads`                       |                                                                                                                                                                              |
| **AOV**               | `Revenue ÷ distinct order refs`             |                                                                                                                                                                              |

Keep `attributedRevenue` / `attributedRoas` (revenue traceable to a campaign) as
separate fields — the manager needs both the raw and the honest number.

---

## 3. The unified join model

**Everything must filter together.** Selecting a course, a date range, a
campaign, an ad set, an ad, a sales team, a salesperson, a platform, or a source
must re-scope _every_ metric on _every_ page — ads, CRM, invoices, lost.

Build one join layer used by all endpoints:

**Campaign key:** `Campaign ID` when present, else normalized campaign name
(trim → lowercase → collapse whitespace). Applies across Meta, Snap, CRM, FIO,
Lost.

**Course key:** normalized `Course`. Present in CRM, FIO, Lost. **Not present in
the ads tabs** — derive it: for each campaign, take the dominant (modal) course
of its CRM leads, and expose that as `campaign → course`. Ads spend then rolls up
to a course through its campaign. Mark such spend `courseInferred: true` so the UI
can flag it.

**Date alignment:** ads use `التاريخ`; CRM uses `أنشئ في`; invoices use `Date`
(`revenueDate`); sales use `Payment Date`; lost uses `أنشئ في`. One global range
filters each source on its own date field. Course-and-date joins (the manager's
first bullet — "link invoice sales by course+date to ad spend by course+date")
must aggregate both sides to `(course, day)` before comparing.

**Ad key:** `Ad ID` when present, else normalized `Ad Name`.

**Ad set key:** see §8a — this one needs derivation, not a direct join.

**Source normalization:** `cleaned Source` contains casing duplicates
(`uchat` 458 and `UChat` 1,093 are the same thing). Normalize case-insensitively
before grouping, everywhere.

---

## 4. Pages

Keep the existing shell (sidebar groups, sticky top bar, mobile bottom nav,
floating AI chat, light/dark, AR/EN). Add a **platform filter** (All / Meta /
Snapchat) next to the date presets.

### 4.1 Overview — executive summary

Lead with a server-computed bilingual paragraph (no LLM) plus:

KPI cards: Total leads · Won · Lost · Conversion rate (count + %) · Lost rate ·
Avg close time · Spend · Revenue · ROAS · ACOS · CPL · CPA.
Each with a delta vs the previous equal-length period.

Then: spend-vs-revenue trend; full funnel (Impressions → Clicks → Platform leads
→ CRM leads → Won → Revenue); best campaign and biggest money-leak spotlights;
top-5 budget leaks; lead-origin split (§7); data-health panel.

### 4.2 Campaigns — the big table (§5)

### 4.3 Ads / Technical

Per-platform breakdown. Meta and Snapchat side by side, then by day and by ad.
Show which metrics are unavailable per platform rather than showing zeros.

### 4.4 Courses

Per course: leads, won, lost, conversion rate, lost rate, revenue, spend
(inferred), ROAS, ACOS, CPL, CPA, avg close time, revenue per lead. Top vs
underperforming lists with a ranking-metric toggle. Course detail drawer with its
campaigns, monthly trend, and top salesperson/team.

### 4.5 Sales team & salesperson

Two levels, same metric set: leads in, won, lost, conversion rate, lost rate,
revenue, AOV, avg close time, revenue per lead. Team table drills into its
salespeople. Include a leaderboard and a "needs attention" list (high lead volume,
low conversion).

### 4.6 Leads (CRM) — detail table + breakdowns by stage, source, course, team,

salesperson, campaign-vs-other.

### 4.7 Lost analysis — **percentage-first** (§6)

### 4.8 Full Invoiced — order-line detail with subtotals by campaign / course / team.

### 4.9 Year-over-year — §9

---

## 5. Campaign performance table (and ad / ad-set levels)

One table component, three grains, switched by a segmented control:
**Campaign → Ad set → Ad.**

Columns: name · platform · course (inferred badge if derived) · spend ·
impressions · clicks · CTR · platform leads · CRM leads · won · lost ·
conversion rate (count + %) · lost rate · revenue · revenue per lead · CPL ·
CPA · ROAS · ACOS.

Sortable, searchable, CSV export, sticky header and first column, row click opens
a drilldown to the level below. Colour-code ROAS and ACOS.

---

## 6. Lost analysis — percentages, not just counts

Every lost breakdown shows **share of total lost** alongside the count, and each
dimension must be sliceable:

- by course — each course's % of all lost
- by month — % distribution across months
- by loss reason (`سبب الضياع`) — % share, ranked
- by sales team — % share, and each team's own lost rate
- by salesperson, by source, by campaign

Add a matrix view (reason × team, and reason × course) with percentages, so the
manager can see which reason dominates which team.

---

## 7. Lead origin: campaign vs non-campaign

Split every lead metric by whether the lead carries a campaign:

- **From campaigns:** `Campaign Name` or `Campaign ID` present → currently 13,854
- **Other sources:** neither present → currently 4,330

Show both cohorts' conversion rate, lost rate, revenue, and close time. Paid
performance must never be judged on the blended number.

Also break the non-campaign cohort down by `cleaned Source` (WhatsApp Broadcast,
UChat, Chatwoot, Website, Recommendation, Phone Call …).

---

## 8. Data realities you must handle honestly

Do not fake these. Build the feature, and degrade visibly when the data can't
support it.

### 8a. `Ad Set Name` is empty in CRM and Full Invoiced — 0 rows of 18,184 / 6,919

The column exists but is never populated by the Odoo export. **You cannot join
leads or revenue to an ad set directly.**

Required approach:

1. Build an `adName → adSetName` lookup from the ads tabs (Meta + Snap have both).
2. Backfill ad-set on CRM/FIO rows through their `Ad Name`. This currently
   resolves **79%** (9,662 of 12,234 CRM rows that have an ad name).
3. Mark every backfilled value `adSetDerived: true`, show a small "derived" badge
   in the ad-set table, and display unresolved rows in an explicit
   **"Unknown ad set"** bucket with its own totals — never silently drop them.
4. Surface the resolution rate on the data-health panel.

Also note: only 12,234 of 18,184 CRM rows (67%) carry an ad name at all, and
2,728 of 6,919 invoice lines (39%). Ad-level revenue is therefore partial by
construction — always show coverage % next to ad-level revenue.

**The real fix is upstream:** populate Ad Set Name in the Odoo export. Add a note
to the data-health panel saying so.

### 8b. Year-over-year is not yet possible

All sources are 2026-only: Meta 8,762 rows (2026), CRM 18,184 (2026), Sales 7,583
(2026). Full Invoiced has just 109 rows in 2025 against 6,810 in 2026.

Build the YoY page and comparison logic fully (by month, by year, by course, for
both spend and revenue, with growth %), but when the prior period has no data
render an explicit empty state: _"No 2025 data in the sheet yet — backfill
`Meta Ads Daily` and `Sales` with last year's rows to enable this comparison."_
**Never render a growth % against a zero baseline.**

### 8c. Close time is only measurable on 6.7% of leads

`Closing Date` / `التاريخ المقفل` is filled on 1,220 of 18,184 rows. The
`أيام الإقفال` column is filled on every row but is mostly `0` and is not
trustworthy as-is.

Compute avg close time as `Closing Date − أنشئ في`, **only** over rows where both
exist, and always render the sample size beside it
(e.g. `18.4 days · based on 1,220 closed leads`). Do not use `أيام الإقفال`
unless you first verify it against the two dates.

### 8d. Campaign coverage on revenue is 46%

Only 3,192 of 6,919 invoice lines carry a `Campaign Name`. Keep the
attributed-vs-total revenue distinction prominent, and keep an "unmatched" bucket
with counts on both sides.

### 8e. Accounts that spend without producing leads

| Account                       | Spend      | Platform leads |
| ----------------------------- | ---------- | -------------- |
| Engosoft 2021                 | $42,933    | 9,786          |
| Engosoft Ezzat                | $13,176    | 2,785          |
| **Engo soft website**         | **$2,661** | **131**        |
| Engosoft ISLAM SAAD           | $2,238     | 409            |
| engo 2026 leads               | $682       | 237            |
| **114732099069544** (unnamed) | **$146**   | **0**          |

`Engo soft website` runs traffic campaigns to the website, not to a specific
course — it legitimately spends without generating CRM leads. `114732099069544`
has no friendly name and zero leads.

Required: tag accounts with a `campaignObjective: "leads" | "traffic" | "unknown"`
(default `traffic` for any account whose name contains "website", `unknown` for
unnamed ids). **Exclude traffic/unknown accounts from CPL, CPA, conversion-rate
and ROAS denominators by default**, with a toggle to include them, and report
their spend separately as **"Non-lead spend"** on the Overview so the money is
still visible. Otherwise they silently poison every efficiency metric.

---

## 9. Year-over-year comparison

Compare, for spend / leads / revenue / won:

- month vs same month last year
- year to date vs same period last year
- per course, per campaign, per platform

Show absolute values, delta, and growth %. Colour by direction. Respect §8b.

---

## 10. Telegram daily report bot

New service in the same app. Runs on a schedule and posts to a Telegram chat.

**Config (env):** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `REPORT_CRON`
(default `0 9 * * *` Africa/Cairo), `REPORT_LANG` (`ar` default).
Never log the token.

**Endpoints:**

- `POST /api/telegram/send-daily` — builds and sends the report; used by the cron
  and by a "Send now" button in the dashboard.
- `GET /api/telegram/preview` — returns the exact message text without sending,
  for testing.

**Message content** — yesterday vs the day before, in Arabic (simple Modern
Standard Arabic, not dialect), with short explanatory lines so a non-analyst can
read it:

1. Header: date, and the period covered.
2. **Spend** — total, split Meta / Snapchat, delta vs previous day.
3. **Leads** — CRM leads that came in, split campaign vs other sources; platform
   leads reported by Meta.
4. **Won** — count, and the value of invoices actually issued and paid.
5. **Conversion rate and lost rate**, count and %.
6. **Best campaign** — name, spend, revenue, ROAS, CPL.
7. **Worst campaign / biggest leak** — name, spend, revenue, ROAS, plus a one-line
   reason ("spent X and returned nothing").
8. **CPL / CPA / ACOS / ROAS** for the day.
9. One or two plain-language notes, e.g. _"CPL rose 30% versus yesterday, mostly
   from campaign X"_.
10. Link back to the dashboard.

Formatting: Telegram MarkdownV2, escaped properly. Keep it under ~35 lines.
Use `—` for any metric with no data rather than `0`. If the sheet's `__synced_at`
is older than 24h, prefix the message with a staleness warning.

Add a `/report` command handler so the manager can pull the report on demand, and
`/week` for a 7-day summary.

Scheduling on Railway: use a `node-cron` job inside the running server (the app is
already always-on), guarded so only one instance schedules it.

---

## 11. Acceptance criteria

- Default range is year-to-date; the old Meta-window default and mismatch warning
  are gone.
- Snapchat spend and native leads appear in ads totals; Snapchat link-CTR renders
  `—`, never `0`.
- Selecting a course re-scopes ads, CRM, invoices and lost together; same for
  date, campaign, ad set, ad, team, salesperson, platform, source.
- Campaign table works at campaign / ad set / ad grain, with derived ad-set values
  badged and an explicit "Unknown ad set" bucket.
- ACOS, CPA (with the invoices/won toggle), conversion rate (count + %), lost rate
  and avg close time (with sample size) all appear as cards and as table columns.
- Lost analysis shows percentages for course, month, reason and team, plus the
  reason × team matrix.
- Website/unnamed accounts are excluded from efficiency denominators by default,
  with their spend reported as "Non-lead spend".
- YoY page renders an honest empty state instead of fake growth numbers.
- Telegram sends a correct daily report; `/api/telegram/preview` returns the same
  text without sending.
- No secrets in client code or logs. No PII sent to the LLM.
- Mobile: 2-column KPI grid, horizontally scrollable tables with a sticky first
  column, filters in a bottom sheet, touch targets ≥ 44px.

---

## 12. Verify before declaring done

Run these against the live sheet and paste the actual numbers back:

1. Total spend YTD across both platforms, and per account.
2. CRM leads, won, lost, conversion rate, lost rate for the year.
3. CPL, CPA (both bases), ACOS, ROAS for the year, with website/unnamed accounts
   excluded and then included — the two must differ.
4. Ad-set resolution rate (expect ~79% of CRM rows that have an ad name).
5. Avg close time and its sample size (expect ~1,220 leads).
6. The Telegram preview text for yesterday.
