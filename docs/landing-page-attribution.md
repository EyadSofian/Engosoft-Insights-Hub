# Landing-page attribution

This is a standalone, best-effort analytics layer for **Engosoft Insights Hub**. It records landing-page views and form milestones. It does not read from Odoo, write to Odoo, create leads, call Chatwoot, or replace an existing landing-page form submission.

## Event model

Every accepted event contains random visitor/session IDs; a stable page ID; page URL, path, and slug; raw `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, and `utm_term`; normalized reporting values; `fbclid`, `gclid`, `ttclid`; and referrer evidence. It never contains a name, email, phone, form value, CRM record, or message content.

Raw and normalized UTM values are independent. The only source aliases are deterministic: `fb → facebook` and `ig → instagram`. Missing values remain missing. The SDK never invents `direct`, `none`, campaign names, or a channel.

Attribution precedence is UTM evidence, then a click ID, then a valid referrer, then an empty referrer (`direct`), then unknown/invalid referrer. `landing_attribution_events` retains raw event evidence; `landing_attribution_sessions` retains first and latest touch as the compact report projection. `event_id` is unique and a conversion `submission_id` is unique, so retries cannot double-count a conversion.

## Landing-page integration

Copy `src/lib/landing-attribution.ts` and `src/lib/landing-attribution.client.ts` into a landing-page project, or publish them as a shared package. They deliberately have no application secrets.

```ts
import {
  captureLandingAttribution,
  trackLandingPageView,
  trackFormStarted,
  trackFormSubmitted,
} from "./lib/landing-attribution.client";

const attribution = {
  landingPageId: "ai-services", // stable, agreed ID—not a display title
  landingPageName: "AI Services",
  landingPageSlug: "ai-services",
  endpoint: "https://INSIGHTS_HOST/api/landing-attribution/events",
};

captureLandingAttribution(attribution);
trackLandingPageView(attribution);
trackFormStarted("contact-form");

// Leave the existing business request exactly as it is. Call this only after
// its real success state, using its non-PII receipt/submission ID.
trackFormSubmitted(existingSubmissionId, "contact-form");
```

Do not await telemetry, route a business request through Insights, or derive a submission ID from personal data. The SDK uses `sendBeacon`, then `fetch(..., { keepalive: true })`; storage and network errors are swallowed by design. It preserves first touch in local storage and updates latest touch. If storage is blocked, it degrades to a best-effort current-page event. The stored page URL is canonicalized to path plus the allowed UTM/click-ID query fields; unrelated query data is discarded. Referrer query strings and fragments are also discarded.

## Endpoint and dashboard

`POST /api/landing-attribution/events` accepts only `landing_page_view`, `form_started`, and `form_submitted`; it strictly validates a fixed JSON contract, has a 64 KiB maximum request body, uses server receive timestamps, and applies a best-effort 120 event/minute per hashed-client burst limit. The platform edge should also rate-limit the route.

Before any cross-origin integration, set a narrow allowlist on the Insights service:

```bash
LANDING_ATTRIBUTION_ALLOWED_ORIGINS=https://engosoft-landing-page.vercel.app
```

Use a comma-separated list only for approved HTTPS origins. The route emits CORS headers only for configured matching origins; never use `*` for it.

`GET /api/landing-attribution/summary` supports `from`, `to`, `landingPageId`, `source`, `medium`, `campaign`, `content`, and `touch=first|latest`. It returns funnel KPIs, conversion rates, page/source/medium/campaign/content/referrer breakdowns, trend, and quality diagnostics. The **Landing pages** report is in Campaigns between Attribution and Website.

## Staging canary checklist

1. Deploy this branch to one Insights staging service with a disposable PostgreSQL database or dedicated schema/database.
2. Set the allowlist to the staging landing URL only.
3. Add the SDK beside the existing handler on one staging landing page; do not replace the handler.
4. Verify a complete UTM visit, `fb` normalization, and first/latest touch behavior.
5. Start and submit the original form once, retry it, and verify one conversion for the same `submission_id`.
6. Check referrer-only, empty-referrer, and blocked-analytics cases; the business form must still succeed when analytics is unavailable.
7. Review the Landing pages dashboard and diagnostics before requesting a production canary.
