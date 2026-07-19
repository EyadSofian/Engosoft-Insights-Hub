# Engosoft Insights Hub

Bilingual (Arabic RTL / English) marketing & sales intelligence dashboard for Engosoft.
It reads a published Google Sheet, joins Meta ad spend to CRM leads and invoiced
revenue, and reports full-funnel performance with an AI assistant on top.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | TanStack Start (React 19, SSR) |
| Build | Vite 8, Nitro (`node-server` preset) |
| Styling | Tailwind CSS v4, custom token layer |
| Charts | Recharts |
| Data | Google Sheets CSV (gviz), parsed with papaparse, cached in memory |
| AI | OpenAI (isolated in the chat route, swappable) |

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

| Variable | Required | Purpose |
| --- | --- | --- |
| `SHEET_ID` | No | Google Sheet id. Falls back to the Engosoft sheet. |
| `OPENAI_API_KEY` | No | Enables free-form AI answers. Without it, the built-in exact-figure answers still work. |
| `PORT` | No | Set by Railway automatically. |

The sheet must be shared as **anyone with the link can view**. The app only ever reads it.

## Deploying to Railway

`railway.json` is committed, so a Railway service pointed at this repo needs no
extra setup beyond variables:

1. New Project → Deploy from GitHub → this repo.
2. Add `OPENAI_API_KEY` (and `SHEET_ID` if not using the default).
3. Deploy. Build runs `npm run build`, start runs `npm run start`.

Health check hits `/api/filters`, which forces a sheet fetch, so a green deploy
also proves the sheet is reachable.

## Data model

`Campaign` is the spine. Meta ↔ CRM ↔ Full Invoiced Orders join on **Campaign ID**
first, falling back to a normalized (trimmed, lowercased, whitespace-collapsed)
campaign name.

Sheet tabs consumed: `Meta Ads Daily`, `CRM Leads`, `Full Invoiced Orders`,
`Sales`, `Lost Analysis`.

Data is fetched on first request, cached in memory for 30 minutes, and refreshed
via `POST /api/refresh` (the Refresh button). If a fetch fails, the previous
snapshot keeps serving rather than blanking the dashboard.

## Things that are easy to get wrong here

These are real properties of the source data. The code guards each one — please
don't "simplify" them away.

**1. `Invoice Date` is blank on ~93% of invoiced rows.**
Filtering revenue on it silently drops most of the money. The attribution date is
the `Date` column (100% populated), exposed as `revenueDate`. See
`sheet-cache.server.ts`.

**2. Undated rows must be excluded once a date filter is active.**
`inRange()` returns `false` for a blank date when a window is set. Letting blank
dates pass leaks all-time revenue into a filtered window — that combination is
what previously reported ROAS as ~87×.

**3. Spend and revenue cover different periods.**
Meta data spans only a recent window (currently ~17 days) while CRM and sales run
all-time. The global date range therefore defaults to the Meta window so both
sides describe the same period. `range=all` opts out explicitly, and the UI warns
whenever the selected range extends past Meta's coverage.

**4. Prefer `attributedRoas` over `roas`.**
`revenue` is all revenue in the window; `attributedRevenue` is only the part that
maps to a Meta campaign. Most Engosoft revenue arrives through channels Meta never
touched, so plain ROAS flatters the ads. The Overview leads with the attributed
figure.

**5. CTR is never summed.**
It is recomputed as `Σ clicks / Σ impressions`. Averaging the `CTR (all)` column
across rows gives a different, wrong answer.

**6. `$ Sales` is already USD.** Do not apply the `Value to dolar` rates to it.

## API

All endpoints accept the global filters as query params
(`from`, `to`, `account`, `campaign`, `source`, `mainCategory`, `salesTeam`, `range`).

| Endpoint | Returns |
| --- | --- |
| `GET /api/overview` | KPI totals, WoW deltas, funnel, trend, best/leak spotlights, exec summary |
| `GET /api/campaigns` | Campaign table + ad set → ad drilldown |
| `GET /api/meta` | Raw ad-platform metrics by day and by ad |
| `GET /api/sales` | Revenue breakdowns from the Sales tab |
| `GET /api/leads` | CRM breakdowns + lead detail rows |
| `GET /api/full-invoiced` | Invoiced order lines + subtotals |
| `GET /api/lost` | Loss reasons and lost-lead detail |
| `GET /api/courses` | Course leaderboard with period-over-period trend |
| `GET /api/filters` | Distinct filter values, Meta date range, sync status |
| `POST /api/refresh` | Drops the cache and re-pulls the sheet |
| `POST /api/chat` | AI assistant |

Detail endpoints cap row payloads at 3,000 and set `truncated: true` past that.

## AI assistant

Common questions (best campaign, highest ROAS, wasted budget, cheapest CPL, totals,
top ad) are answered deterministically from the aggregates, so headline numbers can
never be hallucinated. Anything else goes to the model with a compact aggregated
JSON context.

Only aggregates are sent — never lead names, emails, or phone numbers.
