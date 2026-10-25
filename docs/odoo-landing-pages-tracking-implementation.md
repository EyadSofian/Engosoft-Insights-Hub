# Engosoft Odoo Landing Pages — Tracking Implementation

Odoo CRM read/write changed: NO
Existing lead submission changed: NO
Insights collector reused: YES
Landing pages discovered from live Odoo: YES
Meta destinations cross-checked: YES
CMRP tracking live: NO (rollout awaiting approval)
CFM tracking live: YES
Interior tracking live: NO (rollout awaiting approval)
Real page_view verified: YES
Real form_started verified: YES
Real form_submitted verified: YES
Dashboard receiving real landing data: YES

Status date: 2026-09-14

- **Insights code:** tracker `59c9c37` is on `main` (merge `b37398b`) and deployed on Railway (`c4b958ac`). The dashboard rate fix `dafabfa` is on `feat/odoo-landing-page-tracking`.
- **Odoo change:** one inherited QWeb view (ID `12021`), currently serving `/cfm` and `/en/cfm` only.
- **CRM note:** the only CRM record created during this work is the single approved canary lead, "LP TRACKING TEST - IGNORE" (dummy phone `0000000000`, source `lp_tracking_test`). The normal CFM form created it. It was not edited or deleted and should be archived by a CRM user.

## 1. Discovered Odoo landing pages

Discovery used the logged-in Odoo 17.0 (Enterprise) backend, **Website → Site → Pages** (39 pages), and then fetched every candidate as an anonymous visitor. An HTTP 200 for an anonymous visitor means the page is published.

Campaign landing pages with a lead form:

| Page | Live URL | Anonymous status | Widget (live bundle) | Form submit | Success signal | WhatsApp CTA in page |
| --- | --- | --- | --- | --- | --- | --- |
| CMRP | https://engosoft.com/cmrp | 200 | `s_cmrp_lead_form` (`website_speed_boost.assets_landing`) | native `POST /cmrp/submit_form` (`form.contact-form`) | redirect back with `?success=true` | not detected |
| CFM | https://engosoft.com/cfm | 200 | `s_new_cfm_lead_page` (`website_speed_boost.assets_landing`) | native `POST /cfm/submit_form` (`form.contact-form`) | `?success=true` (verified live) | not detected |
| Interior Design | https://engosoft.com/interior | 200 | `s_interior_design_lead_form` (`website_speed_boost.assets_landing`) | native `POST /interior/submit_form` (`form.contact-form`) | `?success=true` | not detected |
| Automotive | https://engosoft.com/automotive | 200 | `s_automotive_lead_form` (`automotive_landing_page.assets_page`) | native `POST /automotive/submit_form` (`form.contact-form`) | `?success=true` | not detected |
| BIM Track | https://engosoft.com/bim-track | 200 | `s_bim_landing_lead` (`website_speed_boost.assets_landing`) | native `POST /bim-track/submit_form` (`form.bim-lead-form`) | `?success=true`, then the widget strips the query | not detected |
| PMP | https://engosoft.com/pmp | 200 | `s_new_pmp_landing_page` (`website_speed_boost.assets_landing`) | native `POST /pmp/submit_form` (`form.contact-form`) | `?success=true` | yes |
| Mechanical Track | https://engosoft.com/mechanical-track | 200 | `s_mechanical_track_landing_lead` (`website_speed_boost.assets_landing`) | native `POST /mechanical-track/submit_form` (`form.lead-form`) | `?success=true`, then the widget strips the query | yes |

Every one of these widgets calls `preventDefault()` and `stopPropagation()` only when its own validation fails. A valid form performs a native POST, and the Odoo controller redirects back to the page with `?success=true` or `?error=<reason>`. Every page also renders a separate site-wide `#epc-form`, which is not a campaign lead form.

UTM handling on the pages: the widgets copy `utm_source`, `utm_medium` and `utm_campaign` from the URL into hidden form fields, and the CFM, Interior and PMP widgets also keep them in localStorage. The success redirect drops the query string. The Insights tracker keeps its own touch in browser storage, so attribution survives the redirect.

The Arabic site is the default (`/cfm`), English pages use an `/en/` prefix (`/en/cfm`), and `www.engosoft.com` redirects to the bare domain.

The CMRP module in GitHub (`EyadSofian/CMRP-Engo`, `odoo/cmrp_lead_form`, posting JSON to `/cmrp-prep/register`) does **not** match production, which posts natively to `/cmrp/submit_form`. The live bundle, not the repository, is the source of truth. `ENGOSOFT-Interior-Design-` (Next.js) and `engosoft-mechanical-track` (static, Vercel) are separate sites, not the live Odoo pages.

Other published pages reviewed and not treated as campaign landing pages:

| Page | Reason |
| --- | --- |
| `/cmrp-prep` | Separate `s_cmrp_prep_landing_lead` widget; not a current paid destination. Not analysed further. |
| `/cmrp-webinar`, `/interior-webinar`, `/electrical-webinar` | Webinar registration pages; not current paid destinations |
| `/cfm-webinar` | Posts to an n8n webhook, not an Odoo controller |
| `/cfm-cr`, `/pmp-cr` | Form without a submit action |
| `/interior-design-courses`, `/learner-request` | Generic Odoo `s_website_form` for `crm.lead`, not campaign landing pages |
| `/company-requests` | B2B request form |
| `/test1` | Test page |

Not published to anonymous visitors (HTTP 404): `/cfm-course`, `/interior-cr`, `/automotive-1`, `/automotive-cr`, `/bim`, `/bim-cr`, `/ai-course`, `/offers`, `/landing-pages-course`.

## 2. Meta campaigns pointing to each page

The creatives of every **ACTIVE** ad in the 7 accessible ad accounts were read through the Graph API with the existing Insights token. No campaign was changed. Only website destinations are listed.

| Destination (normalised) | Resolves to | Active ads | Campaigns |
| --- | --- | ---: | --- |
| engosoft.com/cfm | CFM landing page | 14 | `120250553509150718` cfm-13/9/36-sayed-land –national; `120250333203300718` cfm-10/9/36-sayed-land |
| engosoft.com/r/nlh | `/automotive` (adds `utm_campaign`, `utm_medium=Facebook`, no `utm_source`) | 6 | `120251483021000457` Automotive -1/9/26 - SH - LP |
| engosoft.com/r/jr6 | `/bim-track` (adds `utm_source=ads`, `utm_medium=Facebook`, `utm_campaign`) | 6 | `120251008218370457` Bim - CBO - SH - LP 10/8/26 |
| engosoft.com/shop/cfm-preparation-course-1109 | eCommerce product page | 6 | `120248227710420692` web-con-all-1/7/26-sa |
| engosoft.com | Home page | 3 | web-signup-1/7 - Copy; Web - Con - SH - 3/9 |
| engosoft.com/shop/pmp-preparation-course-8th-edition-2092 | eCommerce product page | 3 | web-con-all-1/7/26-sa |
| engosoft.com/training_package/mechanical-engineering-professional-track-6 | Training package page | 3 | Web - Con - SH - 3/9 |
| engosoft.com/shop/category/2 | eCommerce category | 3 | web-con-all-1/7/26-sa |
| engosoft.com/shop/automotive-mechanical-course-1353 | eCommerce product page | 2 | Web - Con - SH - 3/9 |
| engosoft.com/training_package/interior-design-professional-track-5 | Training package page | 1 | web-con-all-1/7/26-sa |

Landing pages currently receiving active paid traffic: **CFM, Automotive, BIM Track**. CMRP and Interior had no active website-destination ad at audit time.

Attribution gap to fix in Meta, outside this change: the 14 active CFM ads link to `engosoft.com/cfm` **without UTM parameters**. Those visits reach the dashboard as `(not set)` source and campaign, because the collector never invents UTMs. Adding `utm_source`, `utm_medium`, `utm_campaign` and `utm_content` to the ad URLs makes them attributable.

## 3. Existing Insights collector (reused)

- Endpoint: `POST /api/landing-attribution/events` (`src/routes/api/landing-attribution.events.ts`)
- Summary: `GET /api/landing-attribution/summary`, rendered by `/landing-pages`
- Events: `landing_page_view`, `form_started`, `form_submitted` (`form_submitted` requires `submission_id`)
- Tables: `landing_attribution_events`, `landing_attribution_sessions`, `landing_attribution_rejections`
- UTM parser: `src/lib/landing-attribution.ts`. It uses URL parameters only, keeps the finite `fb`/`ig` aliases, never fills a missing UTM, and strips non-tracking query keys.
- Touches: first touch is stored once per visitor and never overwritten. Latest touch is per session.
- Controls: strict payload validation, a body limit, an in-process rate limit, idempotent `event_id` and `submission_id`, and an origin allowlist.

Railway change: `LANDING_ATTRIBUTION_ALLOWED_ORIGINS=https://engosoft.com`. It was unset before, meaning every origin was accepted but `Access-Control-Allow-Origin` was never returned. The preflight from `https://engosoft.com` now returns `access-control-allow-origin: https://engosoft.com`.

## 4. Tracker implementation

No new collector was created. The Odoo tracker is a build of the existing client library.

| File | Purpose |
| --- | --- |
| `src/lib/landing-attribution.odoo.ts` | Page registry, path and language resolution, success-return detection, `form_started` and pending-submission listeners |
| `src/lib/landing-attribution.odoo.entry.ts` | Standalone browser entry; derives the collector endpoint from the script's own origin |
| `src/lib/landing-attribution.client.ts` | Added `preserveLatestTouch`; cross-origin beacons use `text/plain` (no CORS preflight) |
| `scripts/build-landing-tracker.mjs` | esbuild IIFE build to `public/landing-attribution/odoo-tracker.js` (npm `prebuild`) |
| `tests/unit/landing-attribution-odoo.test.ts` | 10 jsdom tests |
| `src/routes/landing-pages.tsx` | Rate display fix (`dafabfa`) |

Public script: `https://engosoft-insights-hub-production.up.railway.app/landing-attribution/odoo-tracker.js` (9.3 KB, 3.3 KB gzip). Production serves a byte-identical copy of the reviewed build (same SHA-256). It contains no secret and no environment reference.

Behaviour:

- **`landing_page_view`:** sent once per session for each page and path. It is not sent on the `?success=true` or `?error=` return load.
- **`form_started`:** sent once per session and form, on the first `focusin`, `input` or `change` inside the page's lead form only.
- **`form_submitted`:** a submit that reaches `document` without `defaultPrevented`, meaning it passed the widget's own validation, stores a pending submission ID in sessionStorage. `form_submitted` is sent only when the page loads again with `?success=true` and a pending submission for the same page, less than 30 minutes old. `?error=` discards it. A shared `?success=true` link, or a button click alone, never produces a conversion.
- **Touch preservation:** the success redirect drops the UTMs, so form events reuse the session's stored latest touch.
- **Privacy:** field values are never read. Only UTMs, click IDs, a sanitised referrer, the page identity, and visitor, session, form and submission IDs are sent.
- **Failure isolation:** every handler is wrapped. If the script fails to load or storage is blocked, the native form POST is unaffected.
- **Visibility:** the view renders only when `not editable`, so logged-in website publishers (Engosoft staff) are not tracked.

Stable page IDs: `cmrp`, `cfm`, `interior`, `automotive`, `bim-track`, `pmp`, `mechanical-track`.

Verification: `tsc --noEmit` passed, eslint on the changed files passed, the new tests passed (10/10), the landing contract script passed, and `npm run build` passed. The full vitest suite is 677 passed, 9 failed. The same 9 tests fail on untouched `origin/main` (667 passed, 9 failed). They are pre-existing `/landing-pages` route-coverage checks (Nexus registry, agent-surface contract, KPI drill-down), unrelated to this change, and are tracked as a separate task.

## 5. Exact Odoo change

Odoo 17 renders the Engosoft website through a **website-specific copy** of `website.layout`, namely "Main layout", ID `11089`, Website = Engosoft. A child view of the generic `website.layout` (ID `1997`) is therefore never applied to this site.

| View ID | Parent | Name / key | State |
| --- | --- | --- | --- |
| `12020` | generic `website.layout` (`1997`) | `engosoft.landing.attribution.tracker` / `engosoft_landing_attribution.tracker_layout` | **Archived.** First attempt, never rendered on the Engosoft site. |
| `12021` | Engosoft `website.layout` copy (`11089`) | `engosoft.landing.attribution.tracker` / `engosoft_landing_attribution.tracker_layout`, sequence 99 | **Active.** Serves the tracker. |

Created through **Settings → Technical → Views → "Main layout" (Engosoft) → Inherited Views → Add a line**. No existing view, page, form, controller, CRM or UTM record was modified.

Active architecture of view `12021`:

```xml
<data>
  <xpath expr="//body" position="inside">
    <t t-set="engosoft_landing_path" t-value="request and request.httprequest.path or ''"/>
    <t t-if="not editable and engosoft_landing_path in ('/cfm', '/en/cfm')">
      <script>window.EngosoftLandingBoot={pathname:location.pathname,search:location.search};</script>
      <script async="async" src="https://engosoft-insights-hub-production.up.railway.app/landing-attribution/odoo-tracker.js?v=1"></script>
    </t>
  </xpath>
</data>
```

The inline boot line records the URL before widgets clean it up. The tracker loads `async`, so it never delays `DOMContentLoaded` or the Odoo widgets.

Anonymous verification after the change: `/cfm` and `/en/cfm` return 200 with the tracker and the lead form. `/cmrp`, `/interior`, `/automotive`, `/bim-track`, `/pmp`, `/mechanical-track` and `/` return 200 **without** the tracker, with their lead forms intact. This was re-checked after archiving `12020`.

## 6. Canary test (CFM): PASSED

Both runs used a real anonymous headless Chromium with fresh storage and no Odoo session, at `https://engosoft.com/cfm?utm_source=facebook&utm_medium=paid_social&utm_campaign=lp_tracking_test&utm_content=test_creative`.

1. **View and start (no submit):** the page returned 200, the lead form was present, the tracker started, and there were no page errors. The collector received 2 POSTs (`text/plain`), both `202`. The summary showed CFM with 1 view, 1 form start, and facebook / paid_social / lp_tracking_test / test_creative.
2. **Controlled submit (approved single test lead):** only the required fields were filled, with obviously fake data, and Send was clicked once. The native POST redirected to `/cfm?success=true`, so the existing Odoo lead flow succeeded. The pending submission was cleared. The collector received 3 POSTs, all `202`, and there were no page errors.

Collector summary after the canary:

| Metric | Value |
| --- | --- |
| Landing page | CFM (`cfm`) |
| Source / Medium / Campaign / Content | facebook / paid_social / lp_tracking_test / test_creative |
| Views (canary sessions) | 2 |
| Form starts | 2 |
| Submissions | 1 |
| Events rejected | 0 |
| Submissions without prior view | 0 |

The same campaign appears under both first-touch and latest-touch views, which confirms that the success redirect did not overwrite the paid touch.

## 7. Dashboard result

`https://engosoft-insights-hub-production.up.railway.app/landing-pages` renders real data: views, unique visitors, form starts, submissions, the funnel, daily trend, source and campaign charts, the landing page table, and tracking quality. Two further CFM sessions without UTM or referrer evidence arrived after go-live and are shown as `(not set)` rather than guessed (see section 2).

Bug found and fixed: the KPI cards and the table passed 0–1 ratios to `fmtPct`, which expects percent values, so a 50% rate displayed as "0.5%". `dafabfa` formats them correctly.

## 8. Pages instrumented / not instrumented

| Page | Status | Reason |
| --- | --- | --- |
| CFM (`/cfm`, `/en/cfm`) | **Instrumented and verified** | Canary |
| Automotive (`/automotive`) | Not instrumented | Rollout awaiting approval. Tracker config and selector ready; active paid traffic. |
| BIM Track (`/bim-track`) | Not instrumented | Rollout awaiting approval. Tracker config ready; active paid traffic. |
| CMRP (`/cmrp`) | Not instrumented | Rollout awaiting approval. Tracker config ready. |
| Interior (`/interior`) | Not instrumented | Rollout awaiting approval. Tracker config ready. |
| PMP (`/pmp`) | Not instrumented | Rollout awaiting approval. Live lead page without active website ads. |
| Mechanical Track (`/mechanical-track`) | Not instrumented | Rollout awaiting approval. Live lead page without active website ads. |
| Webinar, `-cr`, generic and test pages | Not instrumented | Not campaign landing pages (section 1) |

The rollout is a one-line change to view `12021`: widen the path tuple to `('/cfm', '/en/cfm', '/cmrp', '/en/cmrp', '/interior', '/en/interior', '/automotive', '/en/automotive', '/bim-track', '/en/bim-track', '/pmp', '/en/pmp', '/mechanical-track', '/en/mechanical-track')`. No Insights deployment is needed, because the deployed tracker already recognises all seven pages. After the change, each page should get an anonymous smoke test for page view and form start, without submitting.

## 9. Rollback

1. **Odoo:** archive view `12021` (Settings → Technical → Views). Landing pages immediately return to their previous HTML. `12020` is already archived.
2. **Railway:** remove `LANDING_ATTRIBUTION_ALLOWED_ORIGINS` to restore "accept any origin", or leave it.
3. **Insights:** `git revert -m 1 b37398b` (tracker) and `git revert dafabfa` (rate fix), then redeploy. The collector, schema and dashboard stay intact.

Stored analytics rows can be kept for diagnosis. The tracking code never creates or changes an Odoo lead. The single canary lead was created by the unchanged CFM form.
