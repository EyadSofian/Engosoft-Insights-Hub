import assert from "node:assert/strict";
import {
  canonicalCourseValue,
  courseFromMarketingName,
  isKnownCourse,
  mainCategoryForCourse,
} from "../src/lib/course-taxonomy.ts";

/* --- the campaigns that were filed under the wrong course ------------------ */
// Read off the courses page on 2026-08-17, where the Automotive drilldown listed
// nine "campaigns eligible to run now" — four of which were PMP, Interior and
// website campaigns. Every one of them reported "Course match: ad name", spend
// above zero, and 0 leads / 0 won / $0 revenue, because spend followed the
// guessed name while leads and revenue followed the row's own course column.
const filedUnderAuto = [
  ["pmp-23-12-25-sayed t", "PMP"],
  ["pmp-11-8-25-sayed t", "PMP"],
  ["interior-23-12-25-sayed t", "Interior"],
  ["interior-31-5-26 sayed t", "Interior"],
  ["interior-auto-profile-16/8/26", "Interior"],
  ["cmrp-16/7/26-sayed-t", "CMRP"],
  ["web-sign-14/7/26", "Web"],
];
for (const [name, course] of filedUnderAuto)
  assert.equal(courseFromMarketingName(name), course, `${name} is a ${course} campaign`);

// The genuinely Automotive ones still resolve, including the `Lead ` prefix.
for (const name of [
  "Automotive riyadh-13/4/26-sa t-Team-B",
  "Automotive - Riyadh - 4/7/26 - CBO - sh",
  "Automotive - Riyadh - 13/8/26 - CBO - sh Scall",
  "Lead Automotive riyadh 27/10",
  "Automotive-riyadh-4/7/26-sayed-Team-B",
])
  assert.equal(courseFromMarketingName(name), "Auto", name);

/* --- `auto` is a course code, not the English word ------------------------- */
// These are creative and placement names, not Automotive courses. The old
// `/\bauto(?:mobile)?\b/` rule matched every one of them, and because the ad
// name outranked the campaign name, each pulled a whole campaign into Auto.
// No real campaign is named with a bare `auto`, so the token is simply gone.
for (const name of [
  "auto profile",
  "auto-profile-ad1",
  "auto-generated ad",
  "Auto CAD",
  "Auto Desk",
  "ad-auto-2026",
  "old auto dialer",
  "Auto-Ad-nov25",
])
  assert.equal(courseFromMarketingName(name), "", `${name} must not name a course`);

/* --- the course is the LEADING token, not any token ------------------------ */
// `Arch` and `Struc` here are creative angles inside a BIM campaign. The old
// whole-string search matched two rules and gave up, returning nothing; a
// naive first-match search would have called them Architecture campaigns.
assert.equal(courseFromMarketingName("BIm - CBO - Arch - 17/7/26"), "BIM");
assert.equal(courseFromMarketingName("BIm - CBO - Struc - 17/7/26"), "BIM");
assert.equal(courseFromMarketingName("Bim - MEP - 16/7/26 - CBO"), "BIM");
// `web` is a real course token, and also the commonest trailing modifier.
assert.equal(courseFromMarketingName("web-con-all-1/7/26-sa"), "Web");
assert.equal(courseFromMarketingName("pmp-1/4/26-sayed-web"), "PMP");
assert.equal(courseFromMarketingName("cfm-con-web-4/6/26"), "CFM");

/* --- names that declare no course stay unresolved -------------------------- */
// They must fall through to the CRM modal-course fallback rather than being
// resolved from a word buried later in the string. `Leads -hiring - sales` is
// a recruitment campaign; calling it a course would be worse than saying
// nothing.
for (const name of [
  "Leads -hiring - sales -11/5",
  "FB-Engagement-7/1/26-SAYED",
  "IG-traffic-11/1/26-SAYED",
  "Engagement Campaign 15/6/26",
  "real estate-6/7/26",
  "Traffic-1/6/26",
])
  assert.equal(courseFromMarketingName(name), "", name);

/* --- an authoritative column is never overwritten by product text ---------- */
// Each of these moved real money on the live workbook. `canonicalCourse` joined
// the course column, the product and the product category into one string and
// returned whichever rule sat earliest in the array — so 100% of Maint revenue
// was reported as CMRP and 100% of Marketing revenue as Tech.
assert.equal(
  canonicalCourseValue(
    "Maint",
    "[897] Individual Preparation CMRP",
    "revenue / engineering / maintenance",
  ),
  "Maint",
);
assert.equal(
  canonicalCourseValue(
    "Marketing",
    "[150] Technology - Digital Marketing - Recorded",
    "revenue / non-engineering / marketing",
  ),
  "Marketing",
);
assert.equal(
  canonicalCourseValue(
    "Mech",
    "[259] Mechanical - BIM - Recorded",
    "revenue / engineering / Mechanical",
  ),
  "Mech",
);
assert.equal(
  canonicalCourseValue(
    "Infra",
    "[198] Civil Structure - Technical Office - Recorded",
    "revenue / engineering / civil / infrastructure",
  ),
  "Infra",
);

// A blank course column still resolves from the category, which is what the
// Courses tab is for.
assert.equal(canonicalCourseValue("", "", "revenue / engineering / safety"), "Safety");
assert.equal(canonicalCourseValue("", "", "revenue / engineering / maintenance"), "Maint");
assert.equal(canonicalCourseValue("", "Interior Design - AutoCAD & 3ds Max", ""), "Interior");

// ...but an unrecognised product name is not a course. Discount lines used to
// create courses called "[841] 20% on specific products".
assert.equal(canonicalCourseValue("", "[841] 20% on specific products", "All"), "");
// ...while a product whose name does carry the course, behind an Odoo product
// code, must still resolve. Skipping the leading `[855]` is what makes both work.
assert.equal(canonicalCourseValue("", "[855] PMP Preparation Course - 8th Edition", "All"), "PMP");
assert.equal(canonicalCourseValue("", "[259] Mechanical - BIM - Recorded", ""), "Mech");

/* --- the Odoo category vocabulary maps to course codes --------------------- */
assert.equal(canonicalCourseValue("Facility Management"), "CFM");
assert.equal(canonicalCourseValue("Management"), "PMP");
assert.equal(canonicalCourseValue("Interior Design"), "Interior");
assert.equal(canonicalCourseValue("Technical / BIM MEP / Coordinator"), "BIM");
assert.equal(canonicalCourseValue("Technical / BIM Architecture"), "BIM");
assert.equal(canonicalCourseValue("Technical / Safety"), "Safety");
assert.equal(canonicalCourseValue("FMP"), "CFM");
// Already-canonical values resolve to themselves, including the ones the old
// twelve rules could not produce at all.
for (const code of [
  "Auto",
  "Safety",
  "Maint",
  "Steel",
  "Website",
  "Private",
  "Certificate",
  "Other",
])
  assert.equal(canonicalCourseValue(code), code);

/* --- main category comes from the same table ------------------------------- */
assert.equal(mainCategoryForCourse("PMP"), "Professional Certificate");
assert.equal(mainCategoryForCourse("Safety"), "Professional Certificate");
assert.equal(mainCategoryForCourse("Interior"), "Interior & Decor");
assert.equal(mainCategoryForCourse("Maint"), "Engineering");
assert.equal(mainCategoryForCourse("nonsense"), "");

/* --- the ads course column is a formula, and formulas break ---------------- */
// `Meta Ads Daily.Course` currently ships `#REF!` on some live rows. Accepting
// it as a course put $38 of spend under a course literally named "#REF!".
assert.equal(isKnownCourse("#REF!"), false);
assert.equal(isKnownCourse("#N/A"), false);
assert.equal(isKnownCourse(""), false);
for (const code of ["Auto", "Web", "PMP", "Interior", "Safety"])
  assert.equal(isKnownCourse(code), true);
// Odoo category spellings count as known, so a hint written as a category works.
assert.equal(isKnownCourse("Facility Management"), true);

console.log("course taxonomy: all assertions passed");
