# Landing Page Attribution implementation record

## Boundary confirmation

| Boundary                                    | Result |
| ------------------------------------------- | ------ |
| Odoo read                                   | **NO** |
| Odoo write                                  | **NO** |
| Odoo lead flow changed                      | **NO** |
| Chatwoot changed                            | **NO** |
| Meta messaging changed                      | **NO** |
| Existing form submission replaced           | **NO** |
| Analytics failure can block form submission | **NO** |

This branch adds an Insights-only collector and dashboard. It has no Odoo client/server imports and does not depend on Chatwoot events, Meta messages, or existing form handlers.

## Production discovery audit — 2026-09-14

| Page/deployment                     | Repository                           | Public URL                                 | Existing flow                                                                                        | Existing tracking                                                          | Status / decision                                                                            |
| ----------------------------------- | ------------------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Engosoft AI services marketing page | `EyadSofian/Engosoft-landing-page`   | `https://engosoft-landing-page.vercel.app` | Google Calendar, WhatsApp, email, and Botpress CTAs; source scan found no HTML form or business POST | No UTM, click-ID, or analytics collector                                   | Active Vercel response `200`; eligible for a future explicit SDK integration, untouched here |
| CMRP preparation form               | `EyadSofian/CMRP-Engo` / Odoo module | `https://cmrp-engo.vercel.app`             | Existing browser form posts to `/cmrp-prep/register`                                                 | Reads UTMs but fabricates fallback `direct` / `none` / `cmrp-prep-landing` | Active Vercel response `200`; Odoo lead flow, explicitly out of scope and untouched          |
| Insights Hub website report         | `EyadSofian/utm_chatwoot`            | Insights Hub `/website`                    | CRM/Odoo-oriented report                                                                             | Not a landing collector                                                    | Remains separate; `/landing-pages` does not mix landing metrics with CRM data                |

Discovery was read-only: GitHub source inspection and HTTP headers only. No live form was submitted, Chatwoot conversation created, Railway deployment made, or production webhook added.

## Delivered Phase A code

- `src/lib/landing-attribution.ts`: shared parser, deterministic normalization, referrer classification, and precedence.
- `src/lib/landing-attribution.client.ts`: no-secret browser SDK, first/latest touch storage, `sendBeacon`/`keepalive` delivery, and client guards.
- `src/lib/landing-attribution.server.ts`: strict validation, payload/origin/burst controls, idempotent ingestion, session projection, and summary.
- `src/routes/api/landing-attribution.events.ts`: collector endpoint.
- `src/routes/api/landing-attribution.summary.ts`: filtered summary endpoint.
- `src/routes/landing-pages.tsx`: Campaigns dashboard with funnel, filters, breakdowns, and diagnostics.

The schema is created lazily only when a configured service receives an event: `landing_attribution_events`, `landing_attribution_sessions`, and a no-payload rejection counter. No database was provisioned or altered during Phase A.

## Local verification

- `npm run test:landing-attribution` passed parser, precedence, and strict event-contract fixtures.
- `npm run typecheck` passed.
- `npm run build` passed.
- Focused lint is re-run before branch handoff.

## Intentionally not done

- No merge to `main`.
- No Railway, Vercel, Chatwoot, Meta, or Odoo configuration change.
- No staging deployment/canary: that needs an explicit staging destination, approved origin allowlist, and landing-page owner approval to place the SDK beside the existing flow.
- No production deployment/canary.

The next authorized step is the single-page staging canary in `docs/landing-page-attribution.md`; production remains unchanged until its observed results are reviewed.
