# Leads and sales, six months — request review and what changed

**Date:** 2026-10-23 · **Branch:** `feat/leads-sales-six-month-upgrade` · **Base:** `origin/main` @ `910bdbe`

This answers the management request for a six-month review of lead and sales
performance, and records what the dashboard already answered, what it did not,
and what was built here.

## The short version

The analysis the request asks for **already exists and is correct**. It was
added in `19e7c07` ("Add six-month lead-to-paid performance cohorts") as
`src/lib/lead-performance.ts` plus `GET /api/lead-performance`, and it is
unusually careful: cohorts follow the lead's *entry* month, conversion requires
an exactly opportunity-linked sale order with a positive net after credit notes,
and missing evidence is withheld rather than shown as zero.

Three things were wrong with it, and all three are now fixed:

1. **Nobody could find it.** It rendered at `/leads?view=performance`, a fourth
   in-page tab that no navigation surface, no search entry and no agent
   contract mentioned. The report answering the company's main lead question
   was effectively invisible.
2. **Three of the thirteen requested figures were missing or incomplete** —
   per-stage funnel conversion, follow-up metrics per dimension, and the
   month-by-month quality columns. See the table below.
3. **It did not look like the rest of the app.** It hand-rolled its own cards,
   its own dark hero and a raw `slate`/`sky` palette instead of the project's
   token layer, so it ignored the theme, could not drill down, and had no
   export.

## Request → where it is answered

| # | Request | Before | Now |
|---|---------|--------|-----|
| 1 | Fresh leads per month by course, source, campaign, media buyer | Per selected month only, one dimension at a time | Same, plus a full monthly table and a sortable per-dimension table with CSV |
| 2 | Duplicates, count and %, same-month vs cross-month | ✅ `duplicateSameMonth` / `duplicateEarlierMonth` / `confirmedDuplicate` | Unchanged — already correct, now also per-dimension columns |
| 3 | Unqualified leads and why (customer data vs course fit) | ✅ `unqualifiedReasons`, 3 categories | Unchanged |
| 4 | No answer / unreachable / no interest / lost per month, course, source | Per dimension only; the monthly table showed `lost` alone | **Added** to the monthly table |
| 5 | Contact attempts per lead: 1 / 2 / 3+ and the average | Month total only, although the data existed per group | **Added** to every breakdown dimension — including per salesperson |
| 6 | Average time from lead entry to first contact | Month total only | **Added** per dimension, plus a "first contact within 24h" count |
| 7 | Fresh leads → paid registrations per month, and conversion rate | ✅ | Unchanged |
| 8 | Registrations, count and value, by course/source/campaign/buyer/closer | ✅ including `bySalesCloser` | Unchanged |
| 9 | Cohort conversion including sales closed in a later month | ✅ `paidLater`; cohorts are entry-month by design | Unchanged |
| 10 | Sales funnel: count **and conversion %** at every stage | Three stages, counts only, no rates | **Rebuilt**: four stages, each with its step rate and its share of entries |
| 11 | Monthly dashboard comparing volume, quality, conversion, loss reasons, media-buyer and sales performance | Partial | Monthly table now carries all of it; dimension table carries buyer and salesperson |
| 12 | One agreed definition of Fresh / Duplicate / Unqualified / No interest / Lost | ✅ Excellent definitions panel | Unchanged, and now carried into the export |
| 13 | Conversion computed on real paid registrations | ✅ Positive net paid invoices on an exactly linked sale order | Unchanged |

## What was built

### Metric layer — `src/lib/lead-performance.ts`

- `contacted` and `contactedWithin24h` per group: leads with at least one
  verified outbound PBX attempt, and those first reached inside a working day.
  Both are `null` when call coverage is incomplete.
- `performanceStages(group, paidReady)` — the staged funnel the request asks
  for. Two deliberate decisions:
  - **`contacted` is rated over `callMatchable`, not over entries.** Dividing a
    matched numerator by an unmatched denominator would invent a follow-up
    failure out of a phone-matching limit and blame the sales team for it.
  - **`paid` is rated against entries, not against the opportunity count.** The
    opportunity flag is *today's* status; a lead can be paid while its record
    no longer reads as an open opportunity, and a step rate over that would
    exceed 100%.
- Every stage carries `evidenced`, which is `false` for the opportunity step —
  it is a current-status proxy, not a logged transition, and the page says so.

### A shared loader — `src/lib/lead-performance.server.ts`

The report joins five systems (Odoo CRM, Odoo Lost, paid Accounting lines, the
exact `sale.order.opportunity_id` links, Yeastar CDRs, manual lead QA). That
assembly, and its staleness refusals, now live in one module that both the page
endpoint and the export call, so a report and its own export cannot disagree
about a conversion rate in a meeting.

### Export — `GET /api/lead-performance-export`

An Excel workbook: months, funnel, one sheet per dimension, loss reasons, and a
definitions-and-limits sheet. It re-reads nothing and recalculates nothing, and
it carries the same availability caveats as the screen — an export that
silently drops "calls could not be verified" turns a withheld figure into an
apparent zero the moment it is pasted into a slide.

### UI rework — `src/components/leads/SixMonthPerformance.tsx`

Rebuilt on the project's own system instead of a private palette:

- `DashboardPageHeader` with the window, the sync line, a `Segmented` month
  switcher and the export button.
- Five `MetricDetailTrigger` cards. Each figure now **explains itself**: the
  definition, the arithmetic with its own numerator and denominator, a six-point
  trend, top breakdowns by course/source/buyer/closer, and a provenance block
  naming the systems joined. All assembled from the response already rendered,
  so opening a figure costs no request.
- The funnel shows every stage's step rate and share of entries.
- Both tables are `DataTable`s: sortable, searchable, with a column chooser and
  CSV. One shared column set is used by the monthly table and every dimension,
  which is why the follow-up columns now reach the per-salesperson view.
- Tokens throughout (`bg-surface`, `text-text`, `var(--rose-ink)`, …), so the
  page follows light/dark and RTL like every other report.

### Discoverability

| Surface | Before | Now |
|---|---|---|
| Navigation | Not listed anywhere | First tab of the Leads workspace |
| `/leads?view=intelligence`, `?view=weekly` | In-page tabs only | Listed under More |
| Global search | No entry; "conversion", "duplicates", "no answer", "attempts" matched nothing | Five new destinations with Arabic, English and Arabizi keywords |
| ENGO Nexus (the assistant) | `/api/lead-performance` was not a declared source, so the assistant denied having data the page was showing | Declared source on the `leads` contract, view-gated to `performance` |
| Nexus element registry | None | Five elements: cohort conversion, duplicate rate, call attempts, first-contact lag, unqualified |

### Ten pre-existing test failures, fixed

`origin/main` shipped with 10 failing tests in 4 files. All of them traced to
three pages added without registry coverage — `/lead-distribution`,
`/lead-sources`, `/landing-pages` (and `/creatives`, which declared itself as
the `ads` surface's tab while no contract claimed its pathname):

- `agent-surface-contract.ts` — routes added to the `leads`, `ads` and
  `attribution` contracts, with the sources and views they actually have.
- `nexus-surface-registry.ts` — manifests for `lead_distribution`,
  `lead_sources` and `landing_pages`, and tabs for the four `/leads` views.
- `nexus-context.ts` — `pageTypeFor` no longer returns `"other"` for them.
- `landing-pages.tsx` — registers its attribution basis with
  `useRegisterNexusView`, and its five KPI cards now route through
  `MetricDetailTrigger` with real drill-downs instead of being dead ends.

Two assertions in `header-auto-hide.test.ts` were updated, deliberately: they
encoded "at most four tabs in the Leads workspace" and "the first tab is
`/lead-distribution`". The Leads workspace now carries five, because the
cohort report belongs beside the lead breakdowns rather than hidden inside a
page. That is a design change, not a test bent around a bug.

**Result:** 96 files / 1159 tests passing, from 95 / 1153 with 10 failures.
Typecheck clean, production build clean, lint clean on every changed file.

## Verified against production configuration

Read from Railway (`Engosoft-Insights-Hub`, production) — variable names only:

- `YEASTAR_BASE_URL` / `CLIENT_ID` / `CLIENT_SECRET` / `TIMEZONE` are set, so
  the call-attempt and first-contact figures have a live source.
- `DATABASE_URL` is set, so the `crm_sale_order_links` join and the manual
  lead-QA tables are available.
- `ODOO_LOGIN` / `ODOO_API_KEY` are set.

## Open items, for a decision rather than a change

1. **The opportunity stage is still a proxy.** Odoo's current status is read,
   not a transition log, so "entered the pipeline in May" cannot be
   reconstructed as of May. A real staged funnel needs either `mail.message`
   / stage-history mining or a nightly snapshot of each lead's stage. The page
   marks the stage `evidenced: false` and says so in words; closing it properly
   is its own piece of work.
2. **Link coverage bounds the conversion rate.** Conversion is a *verified
   lower bound*: only accounting lines carrying an exactly linked sale order
   count. The page warns below 90% coverage. Raising real coverage is an Odoo
   data-entry matter, not a dashboard one, and the figure should not be used
   alone to judge staff until it improves.
3. **Dead revenue-password code.** `src/lib/revenue-access.server.ts` (~200
   lines) and the `REVENUE_PASSWORD_REQUIRED` branch in `src/lib/use-api.ts`
   are unreachable: the middleware that called them was removed on purpose in
   `c5b559a` ("fix: remove revenue password prompt"), and
   `REVENUE_TAB_PASSWORD_HASH` is not set in production. `revenueGuardApplies`
   still lists `/api/lead-performance` as protected, which is misleading to
   read. This is not a security hole — nothing was ever being enforced — but it
   should either be deleted or re-wired.
4. **No Telegram daily report.** `TELEGRAM_BOT_TOKEN` is set but
   `TELEGRAM_CHAT_ID` is not, and `startScheduler()` returns early without
   both, so the scheduled report is not running. Unrelated to this request,
   but worth knowing.
5. **Repository lint debt.** `npx eslint .` reports 474 problems (437 errors,
   almost all Prettier formatting in `tests/`) on `origin/main`, measured by
   stashing this branch. Untouched here beyond the changed files, which are
   clean; `npm run format` would clear most of it in one commit.
