# Management UI simplification — audit and design map

Branch `feat/management-ui-simplification`, from `main` at `2a69edb` (2026-09-15).

## Baseline before any change

| Check | Result |
|---|---|
| Typecheck (`tsc --noEmit`) | clean |
| Lint (`eslint src tests --quiet`) | 155 errors, 154 auto-fixable formatting, all pre-existing |
| Tests (`vitest run`) | 860 passed, 9 failed — all nine are `/landing-pages` missing from the Nexus registry / agent contract / KPI drill-down suites |
| Build (`vite build`) | passes |

## Current state

### Navigation hierarchy (sidebar = 7 primary sections, 22 reports)

| Section | Reports (SectionTabs strip) |
|---|---|
| Business analytics | `/` |
| Campaigns | `/campaigns`, `/ads`, `/acquisition`, `/attribution`, `/landing-pages`, `/website` (6) |
| Sales | `/accounting`, `/courses`, `/pricing` (+ aliases `/full-invoiced`, `/sales`, `/products`) |
| CRM management | `/leads`, `/lost`, `/teams` |
| Comparisons | `/weekend`, `/yoy` |
| Media buyers | `/media-buyers`, `/media-plan` |
| Social media | `/social-media`, `/organic` |

### Stacked navigation layers on one screen

- `/acquisition?section=ads`: sidebar → 6-report SectionTabs → 5-section switch → 5-view switch (campaigns / ad sets / ads / creatives / assets). **Four layers.**
- `/acquisition?section=leads`: sidebar → SectionTabs → section switch → 4 lead views. **Four layers.**
- `/campaigns`: sidebar → SectionTabs → 3 workspace tabs (Quick decision / Live / Period analysis) → grain switch (Campaign / Ad set / Ad) → up to 15 quick views. **Four layers plus quick views.**
- `/accounting`: sidebar → SectionTabs → 4-view switch. **Three layers.**

### Overlapping reports

- Campaign performance appears in `/campaigns` (all platforms, sheet), `/ads` (same explorer, platform switcher), `/acquisition` ads section (Meta exact attribution) and the home page's campaign activity table.
- Marketing → revenue appears in `/acquisition?section=sales`, `/accounting?view=marketing` and campaign-linked revenue on `/campaigns`.
- Team performance is split across `/teams` (sales people) and `/media-buyers`.

### Duplicated metrics

Spend, leads, won and ROAS are headline cards on `/`, `/campaigns`, `/ads`, `/acquisition` and `/media-buyers`, each with its own colour family.

### Default density

- `/` home: 5 headline KPIs, 3 insights, trend + funnel + top courses, data health, workspace map, detailed records (course contribution, campaign activity, accounts table), 7 efficiency KPIs, executive summary, Telegram panel — about 8 screens on a laptop.
- `/campaigns` default table: 15 visible columns (name, platform, spend, CTR, platform leads, CRM leads, follow-up, won, lost, revenue, invoices, invoice conversion, sales orders, CPL, ROAS).
- PerfExplorer quick views: 17 defined; up to 12 visible at once at ad-set/ad grain.
- KPI cards: every card is a full pastel surface in one of seven families (mint, rose, sky, violet, amber, cyan, slate) with a blurred colour wash and a solid icon chip — 315 tone assignments across the app.

## Target design

### Primary navigation (6)

| Primary | Contextual layer (SectionTabs, max 4) | Also belongs here |
|---|---|---|
| Overview | — | |
| Marketing | Overview · Campaigns · Creatives · Lead sources | exact attribution tables, assets |
| Sales & CRM | Leads · Lost | |
| Revenue | Collection · Sales performance · Courses | monthly comparison, profitability (page dropdown) |
| Team | Sales team · Media buyers | |
| More | one compact "More" switcher, not a strip | Ads explorer, Attribution, Landing pages, Website tracking, Data coverage, Pricing, Media plan, Social, Organic, Weekend, YoY, Guide |

Every existing URL keeps rendering the same page; only where it is listed changes.

### Rules applied

1. One contextual layer: a page under a workspace does not render its own section switch; deeper views are a breadcrumb, a dropdown or a drawer.
2. KPI cards are neutral (white surface, hairline border). Tone colours only the small icon; hero gets a brand-blue top rule. Semantic colour stays in deltas, verdict pills and charts.
3. Headline rows ≤ 6 cards, insights ≤ 3, charts ≤ 2 visible, one primary table.
4. Tables with a column chooser show at most 8 columns by default; the rest stay one click away under Columns.
5. Campaign hierarchy is a drill-down (row → detail → children, breadcrumb back), never a grain tab switch.
6. Technical identifiers and diagnostics live under "Technical details" / More.

No API, formula, matching rule or worker changes.
