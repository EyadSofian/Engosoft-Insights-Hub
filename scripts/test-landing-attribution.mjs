import assert from "node:assert/strict";
import {
  classifyReferrer,
  makeLandingTouch,
  parseLandingAttribution,
  resolveAttributionMethod,
  safeLandingPageUrl,
  safeLandingReferrer,
} from "../src/lib/landing-attribution.ts";
import { validateLandingEvent } from "../src/lib/landing-attribution.server.ts";

const parsed = parseLandingAttribution(
  "https://landing.engosoft.com/ai?utm_source=FB&utm_medium=Paid%20Social&utm_campaign=Launch&fbclid=abc",
);
assert.deepEqual(parsed.rawUtm, {
  source: "FB",
  medium: "Paid Social",
  campaign: "Launch",
  content: null,
  term: null,
});
assert.equal(parsed.normalizedUtm.source, "facebook");
assert.equal(parsed.normalizedUtm.medium, "paid social");
assert.equal(parsed.clickIds.fbclid, "abc");

const partial = parseLandingAttribution("https://landing.engosoft.com/?utm_source=ig");
assert.equal(partial.normalizedUtm.source, "instagram");
assert.equal(partial.rawUtm.campaign, null);
assert.equal(partial.normalizedUtm.campaign, null);
assert.equal(resolveAttributionMethod(partial.rawUtm, partial.clickIds, ""), "utm");
assert.equal(
  resolveAttributionMethod(
    { source: null, medium: null, campaign: null, content: null, term: null },
    { fbclid: null, gclid: "click", ttclid: null },
    "https://google.com/",
  ),
  "tracking_token",
);
assert.equal(classifyReferrer("https://www.google.com/search?q=engosoft"), "search");
assert.equal(classifyReferrer("https://www.linkedin.com/feed/"), "social");
assert.equal(classifyReferrer(""), "direct");
assert.equal(
  safeLandingPageUrl(
    "https://landing.engosoft.com/ai?utm_source=fb&email=private@example.com#form",
  ),
  "https://landing.engosoft.com/ai?utm_source=fb",
);
assert.equal(
  safeLandingReferrer("https://www.google.com/search?q=engosoft&private=1#top"),
  "https://www.google.com/search",
);

const touch = makeLandingTouch({
  landingPageId: "ai-services",
  landingPageName: "AI Services",
  landingPageSlug: "ai-services",
  landingPageUrl: "https://landing.engosoft.com/ai?utm_source=fb&utm_campaign=Fall",
  landingPagePath: "/ai",
  referrer: "",
});
const validEvent = {
  event_id: "event-1",
  event_type: "form_submitted",
  visitor_id: "visitor-1",
  session_id: "session-1",
  form_id: "contact",
  submission_id: "submission-1",
  first_touch: touch,
  latest_touch: touch,
};
assert.equal(validateLandingEvent(validEvent)?.eventType, "form_submitted");
assert.equal(validateLandingEvent({ ...validEvent, arbitrary: "no" }), undefined);
assert.equal(validateLandingEvent({ ...validEvent, submission_id: null }), undefined);
assert.equal(
  validateLandingEvent({
    ...validEvent,
    latest_touch: { ...touch, landingPageUrl: "javascript:alert(1)" },
  }),
  undefined,
);

console.log("landing attribution contract tests passed");
