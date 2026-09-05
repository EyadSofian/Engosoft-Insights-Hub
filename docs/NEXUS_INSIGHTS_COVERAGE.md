# ENGO Nexus × Insights Hub — surface coverage

Every analytical surface a normal Insights Hub user can see, and the path ENGO
Nexus uses to reach it.

The machine-readable twin of this table is `src/lib/agent-insights-registry.ts`,
and `tests/unit/nexus-coverage.test.ts` fails the build when a navigation route
appears without an entry. This document explains; the registry decides.

## Census

|                                  | Count                                                    |
| -------------------------------- | -------------------------------------------------------- |
| Route files under `src/routes`   | 21 (`__root` + 16 visible + 3 legacy aliases + `/guide`) |
| Visible analytical surfaces      | 16                                                       |
| API route files                  | 58                                                       |
| Internal analytical views        | 11, across 4 pages                                       |
| Endpoints the agent may not call | 14                                                       |

## Before / after

Nexus previously reached `overview`, `campaigns`, `courses`, `leads`, `lost`,
`teams` and part of `social_media` — **7 of 16 connected, 1 partial, 8
missing**. It could not reach Ads, Website, Accounting, Weekend, YoY, Media
Buyers, Media Plan or Organic, and five routes resolved to `pageType: "other"`
so it could not tell which page the user was standing on.

**After: 16 of 16 reachable** — 15 CONNECTED, 1 PARTIAL (Pricing, explained
below).

## The surfaces

| Surface      | Route(s)                                                  | Section      | Internal views                 | Endpoint(s)                                           | Entities                     | PII | Status         |
| ------------ | --------------------------------------------------------- | ------------ | ------------------------------ | ----------------------------------------------------- | ---------------------------- | --- | -------------- |
| overview     | `/`                                                       | business     | —                              | `/api/overview`, `/api/teams`                         | —                            | no  | CONNECTED      |
| campaigns    | `/campaigns`                                              | campaigns    | —                              | `/api/campaigns`, `/api/campaign-risk`                | campaign                     | no  | CONNECTED      |
| ads          | `/ads`                                                    | campaigns    | —                              | `/api/ads`                                            | campaign, adset, ad          | no  | CONNECTED      |
| website      | `/website`                                                | campaigns    | owner, campaigns, operations   | `/api/website`                                        | campaign, course, owner      | no  | CONNECTED      |
| accounting   | `/accounting` (+ `/full-invoiced`, `/products`, `/sales`) | sales        | summary, months, profitability | `/api/accounting`, `/api/sales`, `/api/profitability` | course, product, salesperson | yes | CONNECTED      |
| courses      | `/courses`                                                | sales        | campaigns, alerts, all         | `/api/agent-course-intelligence`, `/api/courses`      | course, campaign, product    | no  | CONNECTED      |
| pricing      | `/pricing`                                                | sales        | —                              | `/api/pricing.catalog`                                | product                      | no  | **PARTIAL**    |
| leads        | `/leads`                                                  | leads        | —                              | `/api/leads`, `/api/crm-calls`                        | source, course, salesperson  | yes | CONNECTED      |
| lost         | `/lost`                                                   | leads        | team, course                   | `/api/lost`                                           | course, team, salesperson    | yes | CONNECTED      |
| teams        | `/teams`                                                  | leads        | —                              | `/api/teams`                                          | team, salesperson            | yes | CONNECTED      |
| weekend      | `/weekend`                                                | comparisons  | —                              | `/api/weekend`                                        | —                            | no  | CONNECTED      |
| yoy          | `/yoy`                                                    | comparisons  | —                              | `/api/yoy`                                            | course                       | no  | CONNECTED      |
| media_buyers | `/media-buyers`                                           | media-buyers | —                              | `/api/media-buyers`                                   | media buyer, campaign        | yes | CONNECTED      |
| media_plan   | `/media-plan`                                             | media-buyers | —                              | `/api/media-plan`                                     | campaign, media buyer        | no  | CONNECTED      |
| social_media | `/social-media`                                           | social       | —                              | `/api/ads`, `/api/organic`, `/api/teams`              | campaign, source             | no  | CONNECTED      |
| organic      | `/organic`                                                | social       | —                              | `/api/organic`                                        | source, course               | no  | CONNECTED      |
| guide        | `/guide`                                                  | support      | —                              | —                                                     | —                            | no  | NOT_APPLICABLE |

### Why Pricing is PARTIAL

The `/pricing` page shows the internal catalogue and price-book views. The
**authoritative current sell price is PriceEngo's**, and the agent quotes it
from there — reviving this page's historical book as a price authority would
undo D-0xx and put two answers in front of a customer. The surface is readable
for what it is; it is not, and must not become, a pricing authority.

## Internal views

A pathname is not enough. These four pages change what they show without
changing the URL, so the panel registers the active view:

- **website** — owner · campaigns · operations
- **accounting** — summary · months · profitability
- **courses** — campaigns · alerts · all
- **lost** — team · course

`/media-plan` and `/pricing` also carry local state (`edit`/`create`,
`recalculate`/`digest`), but those are **administrative dialogs**, not analytical
views, and are deliberately not exposed.

## Security

Row-level payloads are dropped for any surface marked PII — leads carry phone
and email, and teams, lost, accounting and media buyers carry named individuals.
The agent receives aggregates and a row **count**. The filter is blunt on
purpose: an allow-list of safe columns rots the moment a source adds one, and
the cost of being wrong is a customer's phone number in a chat transcript.

Fourteen endpoints are unreachable by construction — everything that publishes,
imports, recalculates, refreshes, ingests, exports or sends. This phase is read
intelligence only.

## Routing policy

Explicit intent beats the current page. Standing on `/` and asking
"الويبسايت باع بكام؟" queries **website**; standing on `/website` and asking
"مبيعات CFM؟" queries **courses**. Page context resolves the deictic cases —
"الصفحة دي", "التاب دي", "الرقم ده" — and nothing else.
