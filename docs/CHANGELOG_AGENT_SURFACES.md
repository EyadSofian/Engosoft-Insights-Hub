# Changelog — Insights Hub (agent surface coverage)

Scope: the agent-facing surface contract, the gateway, page context, proactive
assistant, and bidi-safe chat rendering. No production data was mutated.

## Added

- **`src/lib/agent-surface-contract.ts`** — the single, versioned declaration of
  every analytical surface: routes, views, operations, filters, entities, **all**
  data sources with their view/operation gating and required arguments, row
  projections, freshness paths, standing caveats and a sensitivity class.
- **`src/lib/agent-surface-gateway.server.ts`** — resolves the sources that apply
  to a request, fetches them together, merges them under explicit namespaces,
  and returns a typed `AgentSurfaceResult` (`schemaVersion`, `status`, `surface`,
  `view`, `operation`, `filters`, `period`, `freshness`, `evidence`, `summary`,
  `rows`, `coverage`, `caveats`). The raw payload never leaves.
- **`tests/unit/agent-surface-contract.test.ts`** — 234 manifest-driven tests, a
  case per surface × view × operation including the unnamed-view case.
- **`tests/component/nexus-aware.test.tsx`** — proves a focused KPI/action is
  registered in page context instead of relying on the route name alone.
- Proactive controls: per-surface memory, a rolling weekly cap, a per-session
  cap, and a global opt-out.

## Changed

- **`src/routes/api/agent-insights.ts`** — was `surface.endpoints[0]!`. Five
  surfaces are built from more than one endpoint and were reporting CONNECTED
  while serving a fraction of the page: campaigns without risk, leads without
  call coverage, accounting without profitability, media_plan without activity,
  social_media without organic. The handler is now a shell over the gateway.
- **`src/lib/agent-insights-registry.ts`** — now a projection of the contract, so
  a surface cannot be described two different ways in two files.
- **`scripts/audit-agent-coverage.mjs`** — a non-2xx is now a **hard failure**; it
  previously printed the status and continued, so `/api/agent-course-intelligence`
  (HTTP 400 without `course`) was never exercised and the audit reported PASS.
  Required arguments come from the contract's `auditArgs`, and a declared source
  that no case exercises fails. Added `audit:agent-coverage:self-test`, which
  forces **exactly one declared route** to 404, verifies that forced route was
  actually exercised, and asserts the audit goes red. An unrelated transient
  failure can no longer make the self-test pass accidentally.
- **`contextPreamble`** — v2 frame: versioned, quoted values, explicit `route`,
  the entity as a typed `entityType`/`entityId`/`entityLabel` triple, and a
  timestamp. Values are stripped of anything that could close the frame early.
- **`quickActionsFor`** — reads the surface registry instead of a second
  hardcoded map. The old map had no entry at all for media plan, weekend,
  year-on-year, media buyers, social or organic; `{entity}` is substituted with
  whatever the page has selected.
- **Proactive popup** — dwell timer keyed on the pathname (restarts on
  navigation), suggestions from the registry naming the selected entity, and an
  explicit "turn these off" control. Opening the panel now quiets it for a **day,
  not forever** — the old rule permanently disabled proactive help for anyone who
  had ever clicked the launcher.
- **Page registration** — `useRegisterNexusView` added to all twelve remaining
  routes; the Employee Performance board registers its `targets`/`agents` view and
  the selected employee via `useRegisterNexusEntity`. The Courses page now
  registers the selected course, and the Overview page marks its key leads,
  spend, revenue and ROAS cards with `NexusAware`, so proactive help can name
  the metric/entity the user is actually looking at.
- **Page parameters** — the context frame now carries allow-listed local page
  parameters in addition to filters. Media Plan registers its selected
  `YYYY-MM` month, so Nexus reads the same plan the user is viewing.
- **Arabic message layout** — paragraphs and lists choose direction from their
  actual language; bold Latin product names and numeric price fragments render
  inside `<bdi dir="ltr">`. Arabic PriceEngo answers no longer reverse or merge
  PMP product names and prices.

## Notes

- `src/lib/employee-course-ranking.ts` and `src/lib/media-plan-status.ts` were
  briefly added here with their own endpoints, then moved into the agent. Keeping
  them here made the agent depend on a dashboard deploy to answer a question, and
  the coverage audit correctly went red on a route production does not serve.
- Latest audit against production: **112 endpoint calls, 0 failures, 0 unreachable
  aggregate groups**. Tests: **590 in 21 files** (from 318) — the 49 ranking and
  media-plan tests moved to the agent with their modules.
