// What a seller is told to quote, and who is allowed to ask.
//
// The advisor tab and `/api/prices/advice` now read one module. These assertions
// are what stops them drifting apart again: the band, the suggestion and the
// verdict are pinned here, not in either caller.
import assert from "node:assert/strict";

const {
  buildAdvice,
  parseAsked,
  bandFor,
  bandForRoute,
  suggest,
  verdictFor,
  methodsFor,
  currencyFor,
  entryKey,
  activeOffers,
  isNegotiable,
  CASH_METHODS,
  EGYPT_METHODS,
} = await import("../src/lib/pricing/price-advice.ts");
const { authorizeService } = await import("../src/lib/admin-auth.server.ts");

const DAY = "2026-09-03";

const rule = (over = {}) => ({
  id: "rule-1",
  scope: "individual",
  bundleName: "",
  paymentMethod: "cash",
  currency: "SAR",
  exact: null,
  minimum: null,
  maximum: null,
  validFrom: "",
  validTo: "",
  active: true,
  requiresReview: false,
  note: "",
  ...over,
});

const entry = (prices, over = {}) => ({
  code: "CFM",
  courseName: "CFM Exam Simulator",
  deliveryType: "online",
  subcategory: "",
  level: "",
  onHold: false,
  prices,
  ...over,
});

/* --- the band -------------------------------------------------------------- */

// Several rules cover one route. The floor is the lowest published floor and the
// ceiling the highest published ceiling: narrowing it would invent breaches the
// audit does not see.
{
  const e = entry([
    rule({ id: "a", paymentMethod: "cash", minimum: 900, maximum: 1200 }),
    rule({ id: "b", paymentMethod: "cashier", minimum: 850, maximum: 1100 }),
  ]);
  const band = bandFor(e, CASH_METHODS, "SAR");
  assert.equal(band.floor, 850);
  assert.equal(band.ceiling, 1200);
  assert.equal(band.fixed, false);
}

// A single published number is a fixed price, not a one-wide range.
{
  const band = bandFor(entry([rule({ exact: 400 })]), CASH_METHODS, "SAR");
  assert.equal(band.floor, 400);
  assert.equal(band.ceiling, 400);
  assert.equal(band.fixed, true);
}

// A route nothing is published for has no band, rather than a band of nothing.
assert.equal(bandFor(entry([rule({ paymentMethod: "cash" })]), ["tabby"], "SAR"), undefined);

// Currencies never mix: an Egyptian price is not a Saudi floor.
{
  const e = entry([
    rule({ currency: "SAR", minimum: 850, maximum: 1200 }),
    rule({ currency: "EGP", paymentMethod: "any", minimum: 9000, maximum: 12000 }),
  ]);
  assert.equal(bandFor(e, CASH_METHODS, "SAR").floor, 850);
  assert.equal(bandFor(e, EGYPT_METHODS, "EGP").floor, 9000);
}

// `any` is the workbook's Egyptian column. It answers a route that asks for it
// and stays out of one that does not.
{
  const e = entry([rule({ paymentMethod: "any", currency: "SAR", minimum: 500, maximum: 500 })]);
  assert.equal(bandFor(e, CASH_METHODS, "SAR"), undefined, "cash must not absorb an `any` rule");
  assert.ok(bandFor(e, EGYPT_METHODS, "SAR"), "a route including `any` reads it");
}

// An inactive rule is not a price.
assert.equal(
  bandFor(entry([rule({ active: false, minimum: 1, maximum: 2 })]), CASH_METHODS, "SAR"),
  undefined,
);

// Negotiable means the band has room in it — a fixed price does not.
assert.equal(isNegotiable(entry([rule({ minimum: 850, maximum: 1200 })])), true);
assert.equal(isNegotiable(entry([rule({ exact: 400 })])), false);

/* --- the suggestion -------------------------------------------------------- */

{
  const band = { floor: 850, ceiling: 1200, currency: "SAR", fixed: false, requiresReview: false };
  assert.equal(suggest(band, "standard"), 1200, "no objection: open at the list price");
  assert.equal(suggest(band, "approved_floor"), 850, "an approved exception is the floor itself");
  // A third of a 350 band is 116.67, rounded to 125; 1200 - 125 = 1075.
  assert.equal(suggest(band, "discount"), 1075, "pushback steps down once inside the band");
}

// The step never walks through the floor, however narrow the band.
{
  const narrow = { floor: 300, ceiling: 310, currency: "SAR", fixed: false, requiresReview: false };
  assert.equal(suggest(narrow, "discount"), 300);
}

/* --- the verdict ----------------------------------------------------------- */

{
  const band = { floor: 850, ceiling: 1200, currency: "SAR", fixed: false, requiresReview: false };
  assert.equal(verdictFor(1200, band, "standard"), "safe");
  assert.equal(verdictFor(850, band, "standard"), "safe", "the floor itself is allowed");
  assert.equal(verdictFor(849, band, "standard"), "not_allowed");
  assert.equal(verdictFor(1201, band, "standard"), "above_list");
  assert.equal(verdictFor(1000, band, "approved_floor"), "needs_approval");
  assert.equal(verdictFor(null, band, "standard"), null);
  assert.equal(verdictFor(1000, undefined, "standard"), null, "no band, no verdict");
}

// A rule flagged for review needs a manager even at the list price — and a price
// under the floor is refused before that or anything else can soften it.
{
  const review = { floor: 850, ceiling: 1200, currency: "SAR", fixed: false, requiresReview: true };
  assert.equal(verdictFor(1200, review, "standard"), "needs_approval");
  assert.equal(verdictFor(800, review, "standard"), "not_allowed");
}

/* --- the whole advice ------------------------------------------------------ */

const full = entry([
  rule({ id: "cash", paymentMethod: "cash", minimum: 850, maximum: 1200 }),
  rule({ id: "cashier", paymentMethod: "cashier", minimum: 850, maximum: 1200 }),
  rule({ id: "tabby", paymentMethod: "tabby", minimum: 950, maximum: 1300 }),
  rule({ id: "eg", paymentMethod: "any", currency: "EGP", minimum: 9000, maximum: 12000 }),
  rule({
    id: "offer-live",
    scope: "offer",
    paymentMethod: "cash",
    exact: 799,
    validFrom: "2026-09-01",
    validTo: "2026-09-30",
    note: "عرض سبتمبر",
    sourceSheet: "Q3",
    sourceRow: 41,
  }),
  rule({
    id: "offer-expired",
    scope: "offer",
    paymentMethod: "cash",
    exact: 700,
    validFrom: "2026-07-01",
    validTo: "2026-07-31",
  }),
]);

{
  const advice = buildAdvice(full, { market: "sa", payment: "cash", state: "standard", day: DAY });
  assert.equal(advice.key, entryKey(full));
  assert.equal(advice.currency, "SAR");
  assert.equal(advice.suggested, 1200);
  assert.equal(advice.priceInQuestion, 1200);
  assert.equal(advice.verdict, "safe");
  assert.deepEqual(advice.reasons, ["list_price", "opens_at_list"]);

  // The route not taken, so the cost of the payment method is visible.
  assert.equal(advice.alternate.payment, "instalment");
  assert.equal(advice.alternate.band.floor, 950);
}

// The number the customer named is what gets judged, not the suggestion.
{
  const advice = buildAdvice(full, {
    market: "sa",
    payment: "cash",
    state: "standard",
    asked: 800,
    day: DAY,
  });
  assert.equal(advice.suggested, 1200, "the suggestion still stands");
  assert.equal(advice.priceInQuestion, 800);
  assert.equal(advice.verdict, "not_allowed");
}

{
  const advice = buildAdvice(full, { market: "sa", payment: "cash", state: "discount", day: DAY });
  assert.equal(advice.suggested, 1075);
  assert.deepEqual(advice.reasons, ["list_price", "stepped_down_for_discount"]);
}

// Egypt publishes one price for every method, so there is no alternate route.
{
  const advice = buildAdvice(full, { market: "eg", payment: "cash", state: "standard", day: DAY });
  assert.equal(advice.currency, "EGP");
  assert.equal(advice.band.floor, 9000);
  assert.equal(advice.suggested, 12000);
  assert.equal(advice.alternate, null);
}

// A course with nothing published on the chosen route answers honestly rather
// than inventing a band.
{
  const advice = buildAdvice(entry([rule({ paymentMethod: "cash", minimum: 1, maximum: 2 })]), {
    market: "eg",
    payment: "cash",
    state: "standard",
    day: DAY,
  });
  assert.equal(advice.band, null);
  assert.equal(advice.suggested, null);
  assert.equal(advice.verdict, null);
  assert.deepEqual(advice.reasons, []);
}

/* --- offers ---------------------------------------------------------------- */

{
  const advice = buildAdvice(full, { market: "sa", payment: "cash", state: "standard", day: DAY });
  assert.equal(advice.offers.length, 1, "an offer outside its window is not a live offer");
  assert.equal(advice.offers[0].id, "offer-live");
  assert.equal(advice.offers[0].note, "عرض سبتمبر", "the seller keeps the note written for them");

  // The allowlist is the point: a price rule also carries the workbook sheet and
  // row it was parsed from, which is a fact about maintaining the book. If this
  // assertion is ever loosened by spreading the rule, that leaks with it.
  assert.deepEqual(Object.keys(advice.offers[0]).sort(), [
    "currency",
    "exact",
    "id",
    "maximum",
    "minimum",
    "note",
    "paymentMethod",
    "validFrom",
    "validTo",
  ]);
}

// An offer on another route is not this route's offer.
{
  const advice = buildAdvice(full, {
    market: "sa",
    payment: "instalment",
    state: "standard",
    day: DAY,
  });
  assert.equal(advice.offers.length, 0);
}

assert.equal(activeOffers(full, "2026-07-15").length, 1, "the July offer was live in July");

/* --- one source ------------------------------------------------------------ */
// The assertion this whole change exists for: the band the advice reports is the
// band `bandFor` computes, not a second derivation that happens to agree today.

for (const market of ["sa", "eg"]) {
  for (const payment of ["cash", "instalment"]) {
    const advice = buildAdvice(full, { market, payment, state: "standard", day: DAY });
    const direct = bandFor(full, methodsFor(market, payment), currencyFor(market));
    assert.deepEqual(advice.band, direct ?? null, `${market}/${payment} band must be the one band`);
    assert.deepEqual(advice.band, bandForRoute(full, market, payment) ?? null);
  }
}

/* --- course scope vs bundle scope ------------------------------------------- */
// A bundle publishes no individual price. Reading it in course scope is not a
// cheaper answer, it is no answer — which is why the endpoint works the scope
// out rather than assuming "course".

{
  const bundle = entry(
    [rule({ id: "b", scope: "bundle", paymentMethod: "cash", minimum: 4000, maximum: 5000 })],
    { code: "PMP-BUNDLE", courseName: "PMP + Exam Simulator + PRIMAVERA" },
  );
  const asCourse = buildAdvice(bundle, {
    market: "sa",
    payment: "cash",
    state: "standard",
    day: DAY,
  });
  assert.equal(asCourse.band, null, "a bundle has no individual price");
  assert.equal(asCourse.mode, "course");

  const asPackage = buildAdvice(bundle, {
    market: "sa",
    payment: "cash",
    state: "standard",
    mode: "package",
    day: DAY,
  });
  assert.equal(asPackage.band.floor, 4000);
  assert.equal(asPackage.band.ceiling, 5000);
  assert.equal(asPackage.mode, "package", "the answer says which scope it came from");
}

// The reverse holds too: a plain course has no bundle price, so the fallback
// cannot invent one.
assert.equal(
  buildAdvice(full, { market: "sa", payment: "cash", state: "standard", mode: "package", day: DAY })
    .band,
  null,
);

/* --- the number the customer named ----------------------------------------- */
// `Number("")` is 0, so a lenient read of a typo quotes zero and reports it as a
// breach. Nothing typed is "no number"; something typed that holds no number is
// an error, and the two are not the same answer.

assert.deepEqual(parseAsked(""), { ok: true, value: null });
assert.deepEqual(parseAsked("   "), { ok: true, value: null });
assert.deepEqual(parseAsked("850"), { ok: true, value: 850 });
assert.deepEqual(
  parseAsked(" 1,200 ر.س "),
  { ok: true, value: 1200 },
  "sellers paste the currency",
);
assert.deepEqual(parseAsked("1099.50"), { ok: true, value: 1099.5 });
assert.deepEqual(parseAsked("abc"), { ok: false }, "a typo is refused, not read as zero");
assert.deepEqual(parseAsked("ر.س"), { ok: false });
assert.deepEqual(parseAsked("1.2.3"), { ok: false });

/* --- who may ask ----------------------------------------------------------- */

const SECRET = "workspace-service-secret-0123456789";
const ask = (headers = {}) => new Request("https://app.test/api/prices/advice?q=cfm", { headers });

// Nothing configured: there is no service caller, and the refusal says so once.
delete process.env.INTERNAL_API_SECRET;
{
  const result = authorizeService(ask({ "x-service-secret": SECRET }));
  assert.equal(result.ok, false);
  assert.equal(result.status, 503, "an opt-out deployment has no service access at all");
}

process.env.INTERNAL_API_SECRET = SECRET;

for (const headers of [
  {},
  { "x-service-secret": "" },
  { "x-service-secret": "not-the-secret" },
  { "x-service-secret": SECRET.slice(0, 12) },
  { authorization: "Bearer wrong" },
]) {
  const result = authorizeService(ask(headers));
  assert.equal(result.ok, false, `must refuse ${JSON.stringify(headers)}`);
  assert.equal(result.status, 401);
  assert.equal(result.error, "Unauthorized.", "a refusal never says which credential was missing");
}

{
  const result = authorizeService(ask({ "x-service-secret": SECRET }));
  assert.equal(result.ok, true);
  assert.equal(result.actor.via, "service");
  assert.equal(result.actor.id, "service", "a service call acts for nobody in particular");
}

// A script will reach for the bearer form.
assert.equal(authorizeService(ask({ authorization: `Bearer ${SECRET}` })).ok, true);

delete process.env.INTERNAL_API_SECRET;

console.log("price advice: band, suggestion, verdict, offers and service auth all hold");
