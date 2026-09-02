import assert from "node:assert/strict";
import { chromeScrollDecision } from "../src/lib/chrome-policy.ts";
import { compareDemand, normalizeDemandKey } from "../src/lib/pricing/catalog-demand.ts";
import {
  inferPackageSpecialization,
  mapTrainingPackages,
} from "../src/lib/pricing/packages.server.ts";

assert.equal(chromeScrollDecision(0), "reveal");
assert.equal(chromeScrollDecision(64), "reveal");
assert.equal(chromeScrollDecision(120), "keep");
assert.equal(chromeScrollDecision(181), "hide");
// Scrolling back from 181 to the middle zone keeps the chrome hidden; it does
// not reappear over the list until the reader reaches the top zone.
assert.equal(chromeScrollDecision(100), "keep");

assert.equal(
  normalizeDemandKey("  Interior   Design Professional Track  "),
  "interior design professional track",
);

const demandSorted = [
  { name: "Zero", demand: { orders: 0, units: 0 } },
  { name: "Package", demand: { orders: 2, units: 2 } },
  { name: "Course", demand: { orders: 3, units: 4 } },
].sort(compareDemand);
assert.deepEqual(
  demandSorted.map((item) => item.name),
  ["Course", "Package", "Zero"],
);

assert.equal(inferPackageSpecialization("BIM Manager Professional Track"), "BIM all");
assert.equal(
  inferPackageSpecialization("Interior Design Professional Track"),
  "Architecture & Decor",
);

const packages = mapTrainingPackages([
  {
    id: 5,
    name: "Interior Design Professional Track ",
    active: true,
    company_id: [2, "Egypt - Engoaad"],
    currency_id: [73, "EGP"],
    total_price: 23750,
    final_price: 12000.875,
    num_courses_display: 6,
    product_ids: [1, 2, 3, 4, 5, 6],
    attendee_product_ids: [7, 8, 9, 10],
    write_date: "2026-09-02 11:11:21",
  },
  { id: 99, name: "Archived", active: false },
]);
assert.deepEqual(packages, [
  {
    id: 5,
    name: "Interior Design Professional Track",
    active: true,
    specialization: "Architecture & Decor",
    companyId: 2,
    companyName: "Egypt - Engoaad",
    currency: "EGP",
    listPrice: 23750,
    finalPrice: 12000.88,
    courseCount: 6,
    recordedCourseCount: 6,
    attendanceCourseCount: 4,
    updatedAt: "2026-09-02",
  },
]);

console.log("pricing catalog demand, Odoo packages, and chrome scroll policy: ok");
