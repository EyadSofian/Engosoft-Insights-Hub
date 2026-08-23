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
// Website is a reporting-purpose bucket: Engosoft's explicit `web` / `con`
// campaign tag wins wherever it appears, so Courses reconciles to Website.
assert.equal(courseFromMarketingName("web-con-all-1/7/26-sa"), "Web");
assert.equal(courseFromMarketingName("pmp-1/4/26-sayed-web"), "Web");
assert.equal(courseFromMarketingName("cfm-con-web-4/6/26"), "Web");
assert.equal(courseFromMarketingName("Traffic-all-web-20/7/26"), "Web");
assert.equal(courseFromMarketingName("CMRP-WEBINAR-20/8/26-lp"), "CMRP");

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

/* --- authoritative columns and deliberate business aliases ----------------- */
// Maintenance is sold inside CMRP. The authoritative `Maint` label, its product
// wording and its category must therefore resolve to the same bucket as CMRP so
// paid revenue and campaign spend cannot split into two dashboard rows.
assert.equal(
  canonicalCourseValue(
    "Maint",
    "[897] Individual Preparation CMRP",
    "revenue / engineering / maintenance",
  ),
  "CMRP",
);
assert.equal(courseFromMarketingName("maintenance-ksa-20/8/26"), "CMRP");
// An explicit Website tag wins for campaign reporting, even when the promoted
// course token is also present; revenue still follows its authoritative course.
assert.equal(courseFromMarketingName("maint-web-20/8/26"), "Web");

// Other authoritative courses remain protected from unrelated product text.
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
assert.equal(canonicalCourseValue("", "", "revenue / engineering / maintenance"), "CMRP");
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
for (const code of ["Auto", "Safety", "Steel", "Private", "Certificate", "Other"])
  assert.equal(canonicalCourseValue(code), code);
assert.equal(canonicalCourseValue("Website"), "Web");
assert.equal(canonicalCourseValue("revenue / miscellaneous / website"), "Web");
for (const maintenanceLabel of ["Maint", "Maintenance", "revenue / engineering / maintenance"])
  assert.equal(canonicalCourseValue(maintenanceLabel), "CMRP");

/* --- main category comes from the same table ------------------------------- */
assert.equal(mainCategoryForCourse("PMP"), "Professional Certificate");
assert.equal(mainCategoryForCourse("Safety"), "Professional Certificate");
assert.equal(mainCategoryForCourse("Interior"), "Interior & Decor");
assert.equal(mainCategoryForCourse("Maint"), "Professional Certificate");
assert.equal(mainCategoryForCourse("CMRP"), "Professional Certificate");
assert.equal(mainCategoryForCourse("Website"), "Non-Engineering");
assert.equal(mainCategoryForCourse("nonsense"), "");

/* --- the ads course column is a formula, and formulas break ---------------- */
// `Meta Ads Daily.Course` currently ships `#REF!` on some live rows. Accepting
// it as a course put $38 of spend under a course literally named "#REF!".
assert.equal(isKnownCourse("#REF!"), false);
assert.equal(isKnownCourse("#N/A"), false);
assert.equal(isKnownCourse(""), false);
for (const code of ["Auto", "Web", "PMP", "Interior", "Safety", "Maint"])
  assert.equal(isKnownCourse(code), true);
// Odoo category spellings count as known, so a hint written as a category works.
assert.equal(isKnownCourse("Facility Management"), true);

/* --- a product line written into a course column is not a course ----------- */
// `Full Invoiced Orders.Course` carries the product name on discount rows. The
// rule that keeps an unrecognised course value visible then produced two
// courses on the live dashboard, holding eight sales orders between them.
assert.equal(canonicalCourseValue("[851] 100% on The Freelance Masterclass"), "");
assert.equal(canonicalCourseValue("[841] 20% on specific products", "", "All"), "");
assert.equal(canonicalCourseValue("20% on specific products"), "");
assert.equal(canonicalCourseValue("Free Product - CFM notes"), "CFM");
// A product code in front of a real course still resolves to that course.
assert.equal(canonicalCourseValue("[855] PMP Preparation Course - 8th Edition"), "PMP");
// Unrecognised course values that are not product lines are still preserved,
// so a genuinely new course appears as itself rather than vanishing.
for (const value of ["Technical / Safety", "civil", "."])
  assert.equal(canonicalCourseValue(value), canonicalCourseValue(value));
assert.equal(canonicalCourseValue("Freelance Masterclass"), "Freelance Masterclass");

/* --- awareness campaigns are segmented by topic, and sell nothing ---------- */
// Their ad sets carry course words while the campaign does not. Reading a course
// off an ad set used to charge awareness spend to Interior and CFM merely because
// those topic names appeared underneath the campaign. `attributedAdCourse` no
// longer consults ad-set or ad names; names without an explicit Website tag or a
// leading course must therefore remain unresolved.
for (const name of [
  "IG-traffic-11/1/26-SAYED",
  "FB-Engagement-7/1/26-SAYED",
  "IG-Engagement-11/1/26-SAYED",
  "Video views-11/1/26-S",
  "Demand Gen - 2026-01-06-SAYED",
  "Demand Gen - 2026-07-16 - Kuwit",
  "QATAR -2",
])
  assert.equal(courseFromMarketingName(name), "", `${name} sells no course`);

// The ad-set names that used to leak, checked directly: they do name a course,
// which is exactly why they must never be consulted for one.
for (const [adset, course] of [
  ["interior", "Interior"],
  ["cfm", "CFM"],
  ["BIM", "BIM"],
  ["PMP", "PMP"],
])
  assert.equal(courseFromMarketingName(adset), course);

console.log("course taxonomy: all assertions passed");
