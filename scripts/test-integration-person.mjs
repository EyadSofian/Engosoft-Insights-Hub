import assert from "node:assert/strict";
import {
  integrationPersonMatchScore,
  integrationPersonNamesMatch,
} from "../src/lib/integration-person.ts";

const accepted = [
  ["Menna Mostafa", "Menna Tullah Mustafa Ali Mustafa"],
  ["Basma Kamal", "Basma kamal ali Ibrahim alroby"],
  ["Hady Mahmoud Elhenawy", "Hady Mahmnoud Fahmy Elhenawy"],
  ["Sherif Waleed", "Sherif Waleed Ahmed Mohamed"],
  ["Sabreen Ibrahim", "Sabrin Ebrahim Ali"],
  ["Hessein abdullah", "Hessein Mohamed Abdullah"],
  ["Mahmoud Abdelnaser", "Mahmoud Abdel Naser sayed Mahmoud"],
];

for (const [shortName, legalName] of accepted) {
  assert.equal(integrationPersonNamesMatch(shortName, legalName), true, `${shortName} should match`);
}

assert.equal(integrationPersonNamesMatch("Ahmed", "Ahmed Ehab Hosny Ahmed"), false);
assert.equal(integrationPersonNamesMatch("Ahmed Ehab", "Ahmed Saeed Ahmed Ibrahim"), false);
assert.equal(integrationPersonNamesMatch("Sales Team", "Basma kamal ali Ibrahim alroby"), false);
assert.equal(
  integrationPersonMatchScore(
    "Abdullah Mohsen",
    "Abdullah Mohsen Abdelhamed Saeed Hassan eljamal",
  ),
  2,
);
assert.equal(
  integrationPersonMatchScore(
    "Abdullah Mohsen",
    "Mr.Mohamad Abdullah Mohamad Mohsen",
  ),
  1,
);

console.log("integration person matching passed");
