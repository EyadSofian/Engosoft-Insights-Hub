# Engosoft Insights Hub

Bilingual (Arabic RTL / English) marketing & sales intelligence dashboard for Engosoft.
It reads a published Google Sheet, joins Meta and Snapchat ad spend to CRM leads and
invoiced revenue, and reports full-funnel performance with an AI assistant on top.

## Stack

| Layer      | Choice                                                                     |
| ---------- | -------------------------------------------------------------------------- |
| Framework  | TanStack Start (React 19, SSR)                                             |
| Build      | Vite 8, Nitro (`node-server` preset)                                       |
| Styling    | Tailwind CSS v4, custom token layer                                        |
| Charts     | Recharts                                                                   |
| Data       | Google Sheets CSV (gviz), parsed with papaparse, cached in memory          |
| Scheduling | in-process timer + a small cron matcher (`src/lib/cron.ts`), no dependency |
| AI         | OpenAI (isolated in the chat route, swappable)                             |

No database. The sheet is the source of truth.

## Running locally

```bash
npm install
npm run dev          # http://localhost:8080
```

Production:

```bash
npm run build
npm run start        # serves .output/server/index.mjs on $PORT
```

## Environment

Copy `.env.example` to `.env`:

| Variable                    | Required | Purpose                                                                                |
| --------------------------- | -------- | -------------------------------------------------------------------------------------- |
| `SHEET_ID`                  | No       | Google Sheet id. Falls back to the Engosoft sheet.                                     |
| `OPENAI_API_KEY`            | No       | Enables free-form AI answers. Without it the built-in exact-figure answers still work. |
| `TELEGRAM_BOT_TOKEN`        | No       | Enables the daily report. Never logged or returned in a response.                      |
| `TELEGRAM_CHAT_ID`          | No       | Optional fallback recipient, always included alongside `/start` subscribers.           |
| `TELEGRAM_SUBSCRIBERS_FILE` | No       | Where the subscriber list is stored. Point at a mounted volume on Railway.             |
| `REPORT_CRON`               | No       | Cron expression in Africa/Cairo. Default `0 9 * * *`.                                  |
| `REPORT_LANG`               | No       | `ar` (default) or `en`.                                                                |
| `PORT`                      | No       | Set by Railway automatically.                                                          |

The sheet must be shared as **anyone with the link can view**. The app only ever reads it.

## Data model

`Campaign` is the spine. Ads ↔ CRM ↔ Full Invoiced Orders ↔ Lost join on a single
campaign key: the campaign id when present, otherwise a normalized name that
resolves back to an id if any tab pairs the two.

Sheet tabs consumed: `Meta Ads Daily`, `Snap Ads Daily`, `CRM Leads`,
`Full Invoiced Orders`, `Sales`, `Lost Analysis`.

Data is fetched on first request, cached in memory for 30 minutes, and refreshed via
`POST /api/refresh`. If a fetch fails, the previous snapshot keeps serving rather than
blanking the dashboard.

## Things that are easy to get wrong here

These are real properties of the source data, verified against the live sheet. The code
guards each one — please don't "simplify" them away.

**1. Slash dates are US-ordered (M/D/YYYY).**
`Closing Date` arrives as `5/21/2026` and CRM `Date` as `7/13/2026`. Parsing them as
D/M/YYYY turns every day past the 12th into an invalid date, which silently made close
time `NaN`. `parseDate` only swaps the order when the first field cannot be a month.

**2. Header keys carry stray whitespace.**
The CRM header row contains a cell that literally ends in a carriage return (`Date\r`).
Papa is configured with `transformHeader` to trim, or the column is unreachable by name.

**3. `Invoice Date` is blank on ~92% of invoiced rows.**
Filtering revenue on it drops most of the money. The attribution date is the `Date`
column (100% populated), exposed as `revenueDate`.

**4. Undated rows must be excluded once a date filter is active.**
`inRange()` returns `false` for a blank date when a window is set. Letting blank dates
pass leaks all-time revenue into a filtered window.

**5. Ad names are not unique — join ad sets by ad id.**
`Ad Set Name` is exported empty on every CRM and invoice row, so it must be backfilled.
96 of 161 distinct ad names in this sheet appear under more than one ad set, so a
name-only match is a guess. Ad id is exact; name is a flagged fallback (`ambiguous`).
Unresolved rows go to an explicit "Unknown ad set" bucket, never dropped.

**6. Snapchat reports native leads, but not link clicks in this export.**
The corrected feed writes `native_leads` to `Leads (Native)`. Link clicks stay `null`,
not `0`, and link-CTR's denominator excludes Snapchat impressions.

**7. Not every lead source has spend data.**
TikTok, UChat, WhatsApp and referrals produce ~6,600 leads with no cost anywhere in the
sheet. Blended CPL (`spend ÷ all CRM leads`) therefore reads cheaper than paid CPL.
Both are exposed: `cpl`, `platformCpl`, and `attributedCpl`.

**8. Traffic and unnamed ad accounts are excluded from efficiency denominators.**
`Engo soft website` runs traffic campaigns and `114732099069544` has no name and zero
leads. Their spend is reported separately as "Non-lead spend" with a toggle to include
it, rather than quietly poisoning CPL, CPA and ROAS.

**9. A ratio needs its spend window to cover its revenue window.**
Snapchat only exports recent days, so a campaign running since January shows 5 days of
cost against 7 months of revenue — an 18× ROAS that means nothing. Such rows are flagged
`partialSpend`, badged in the table, and excluded from the best/worst spotlights.

**10. No percentage against a missing baseline.**
The default year-to-date window's predecessor starts mid-2025, where the sheet holds 109
stray invoice rows and nothing else — enough to report "+5,959% revenue". Deltas are
suppressed entirely when the previous window predates complete data, and year-over-year
requires a real prior year across ads _and_ CRM _and_ invoices.

**11. Lost Analysis is the confirmed archived-lost population.**
The Odoo sync requires both `active = false` and `probability = 0`. This excludes
ordinary/manual archives that are not actually lost. Loss reasons come from this tab.

**12. The gviz endpoint is served through Google's CDN.**
It caches the CSV and ignores a `no-cache` request header, so Refresh kept
returning the same stale copy. Each load appends a unique `_cb` parameter to force
a fresh pull. A forced reload also bypasses any in-flight fetch — that request was
sent with an older token, so waiting on it returned exactly the stale data the
user was trying to escape.

**13. `fetchedAt` is never bumped on a failed pull.**
When every tab fails the previous snapshot keeps serving, but bumping its
timestamp made stale data report itself as freshly loaded. `lastAttemptAt` drives
the retry backoff instead.

**14. CTR is never averaged.** It is recomputed as `Σ clicks / Σ impressions`.

**15. `$ Sales` is already USD.** Never apply the `Value to dolar` rates to it.

**16. Prefer `attributedRoas` over `roas`.** Only ~42% of revenue carries a campaign at
all, and only ~26% maps to a campaign present in the ads tabs.

## Metric definitions

Every ratio goes through `div()`, which returns `null` when the denominator is zero.
`null` renders as an em dash — never `0`, `NaN` or `Infinity`.

| Metric          | Formula                                                                         |
| --------------- | ------------------------------------------------------------------------------- |
| CPL             | efficiency spend ÷ CRM leads                                                    |
| Platform CPL    | efficiency spend ÷ platform-reported leads (Meta forms + Snapchat native leads) |
| Paid CPL        | efficiency spend ÷ leads carrying a campaign                                    |
| CPA             | efficiency spend ÷ won leads **or** ÷ distinct invoices (toggle)                |
| ACOS            | (efficiency spend ÷ revenue) × 100                                              |
| ROAS            | revenue ÷ efficiency spend                                                      |
| Conversion rate | (won ÷ CRM leads) × 100, always shown with the count                            |
| Lost rate       | (lost ÷ CRM leads) × 100                                                        |
| Avg close time  | mean of `Closing Date − أنشئ في`, always shown with its sample size             |
| AOV             | revenue ÷ distinct order refs                                                   |

## API

All endpoints accept the global filters as query params (`from`, `to`, `platform`,
`account`, `campaign`, `adset`, `ad`, `source`, `course`, `mainCategory`, `salesTeam`,
`salesperson`, `range`, `includeNonLead`, `cpaBasis`).

| Endpoint                                       | Returns                                                                                  |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `GET /api/overview`                            | KPI totals, deltas, funnel, trend, lead origin, spotlights, data health                  |
| `GET /api/campaigns?grain=campaign\|adset\|ad` | The performance table at one of three grains                                             |
| `GET /api/ads`                                 | Per-platform metrics, daily spend, ad and ad-set breakdowns                              |
| `GET /api/courses`                             | Course leaderboard, inferred spend, optional `?detail=` drilldown                        |
| `GET /api/teams`                               | Teams with nested salespeople, leaderboard, needs-attention list                         |
| `GET /api/leads`                               | CRM breakdowns, lead-origin cohorts, detail rows                                         |
| `GET /api/lost`                                | Loss reasons with shares, reason × team/course matrices, per-team lost rate              |
| `GET /api/full-invoiced`                       | Order lines, subtotals, attributed-vs-unattributed split                                 |
| `GET /api/sales`                               | Revenue from the Sales tab (payment lines)                                               |
| `GET /api/yoy`                                 | Year-over-year, or an honest empty state                                                 |
| `GET /api/filters`                             | Distinct filter values, coverage, sync status, data health                               |
| `POST /api/refresh`                            | Drops the cache and re-pulls the sheet; returns row counts so a no-op refresh is visible |
| `POST /api/chat`                               | AI assistant                                                                             |
| `GET /api/telegram/preview`                    | The exact report text, without sending                                                   |
| `POST /api/telegram/send-daily`                | Broadcasts to every subscriber (`?days=7` for weekly)                                    |
| `POST /api/telegram/webhook`                   | Handles `/start`, `/stop`, `/report`, `/week`, `/status`                                 |
| `GET /api/telegram/setup`                      | Whether the webhook is registered, subscriber count, schedule state                      |
| `POST /api/telegram/setup`                     | Points Telegram at this deployment. Required once before the bot works                   |

Detail endpoints cap row payloads at 3,000 and set `truncated: true` past that.

## Telegram report

`startScheduler()` runs at server boot and is idempotent, so route modules being
re-imported per request in dev cannot register duplicate jobs. It returns early unless
both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set.

Scheduling uses a 20-second interval against a hand-rolled cron matcher rather than a
package. `node-cron` resolves its background daemon through `__dirname`, which is
undefined once Nitro bundles the server to ESM — the container crashed on boot while
`npm run build` passed, because building never executes the bundle. **Verify server
changes by running `npm run build && npm run start` and hitting `/api/filters`, not by
building alone.** Wall-clock time is read fresh in `Africa/Cairo` on every tick, so
Egypt's DST transitions are handled.

### Who receives it

The bot is open: **anyone who sends `/start` is subscribed** and gets the daily
report, plus the current report immediately so `/start` is useful right away.
`TELEGRAM_CHAT_ID` is no longer required — if set, that chat is simply always
included as a fallback.

| Command   | Effect                                              |
| --------- | --------------------------------------------------- |
| `/start`  | Subscribe, and receive yesterday's report now       |
| `/report` | Yesterday's report on demand                        |
| `/week`   | Last 7 days                                         |
| `/status` | Whether you're subscribed, and the subscriber count |
| `/stop`   | Unsubscribe                                         |

**The webhook must be registered once, or nothing works.** Until it is, Telegram
has nowhere to deliver messages: `/start` reaches nothing, the sender is
never subscribed, and no error appears anywhere. Register it by calling the app
itself, which derives its own URL from the request:

```bash
curl -X POST https://<your-app>/api/telegram/setup
```

`GET /api/telegram/setup` reports whether the webhook is registered, how many
subscribers exist and whether the schedule is armed — the first place to look
when the bot seems silent.

The webhook always answers 200, because Telegram retries any non-2xx response and
a failing command would otherwise re-run in a loop.

### If the report never arrives at its scheduled time

The schedule is an in-process timer, so it only fires while the container is
awake. If the Railway service is configured to sleep on idle, nothing runs at
09:00 and no error appears — the process simply was not running.

The durable fix is an external trigger. Point Railway Cron (or any uptime
pinger) at:

```
POST https://<your-app>/api/telegram/send-daily?once=1
```

`once=1` sends at most one report per Cairo day, so running this alongside the
in-process timer is safe: whichever fires first sends, the other is a no-op.
Without it you would get two reports a day.

**Subscribers are stored in a JSON file, and Railway's container filesystem is
wiped on every redeploy.** Attach a volume and set `TELEGRAM_SUBSCRIBERS_FILE` to
a path on it (e.g. `/data/telegram-subscribers.json`), or the list resets on each
deploy and everyone has to `/start` again. Writes go through a temp file and a
rename, so a crash mid-write cannot leave a truncated file that wipes the list.

Chats that block the bot or get deleted are unsubscribed automatically. That check
matches only Telegram's "blocked / chat not found / deactivated / kicked"
responses — an invalid token returns a plain "Not Found", which deliberately does
not match, so a misconfigured token cannot wipe every subscriber.

## AI assistant

Common questions (best campaign, wasted budget, cheapest CPL, totals, conversion rate,
close time) are answered deterministically from the aggregates, so headline numbers can
never be hallucinated. Anything else goes to the model with a compact aggregated JSON
context that includes the metric definitions and the data caveats.

Only aggregates are sent — never lead names, emails, or phone numbers.
