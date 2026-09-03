import assert from "node:assert/strict";
import { namePartCount, splitNameParts, threePartName } from "../src/lib/person-display-name.ts";
import { buildEmployeeDirectoryForTest } from "../src/lib/employee-directory.server.ts";

// Cases taken from the live Odoo roster, keeping the spelling Odoo holds.

// A part is a name, not a word: `Abdul Wahab` and `El Sayed` each count once.
assert.deepEqual(splitNameParts("Abdul Rahman Tarik Abdul Wahab"), [
  "Abdul Rahman",
  "Tarik",
  "Abdul Wahab",
]);
assert.deepEqual(splitNameParts("El Sayed Mohamed Mohamed El Sayed Awad"), [
  "El Sayed",
  "Mohamed",
  "Mohamed",
  "El Sayed",
  "Awad",
]);
assert.equal(threePartName("Abdul Rahman Tarik Abdul Wahab"), "Abdul Rahman Tarik Abdul Wahab");
assert.equal(threePartName("Amr Ahmed Abd ElHafiz"), "Amr Ahmed Abd ElHafiz");
assert.equal(namePartCount("Amr Ahmed Abd ElHafiz"), 3);

// Long legal names are cut to given / father / grandfather.
assert.equal(
  threePartName("Mr.Abdullah Mohsen Abdul Hamid Saeed Hassan Al-Gamal"),
  "Abdullah Mohsen Abdul Hamid",
);
assert.equal(threePartName("Dina Sharif Mohamed Fawzi Tawfik Al-Qadi"), "Dina Sharif Mohamed");
assert.equal(threePartName("منصور خالد بن دعيلج"), "منصور خالد بن دعيلج");

// A title is dropped, whether it is spaced or glued to the first name.
assert.equal(threePartName("Mr.Nader Refaat Aziz Naguib"), "Nader Refaat Aziz");
assert.equal(threePartName("Miss.Mennatallah walid Mohamed Fathy"), "Mennatallah walid Mohamed");
// …unless dropping it would leave nothing to show.
assert.equal(threePartName("Mr"), "Mr");

// A name Odoo records with fewer than three parts is shown as it stands. There
// is nowhere else to look for the missing part and inventing one is worse.
assert.equal(threePartName("MOATAZ SABRY"), "MOATAZ SABRY");
assert.equal(threePartName(""), "");

const users = [
  { id: 134, name: "Ahmed  El-Shiekh", share: false },
  { id: 15835, name: "Ahmed Ali Shaaban", share: false },
  { id: 432, name: "Mr.Mohamad Abdullah Mohamad Mohsen", share: false },
  { id: 24091, name: "MOATAZ SABRY", share: false },
  { id: 21642, name: "Mahmoud Mohamed Mahmoud", share: false },
  { id: 21643, name: "Mahmoud Mohamed Hassan", share: false },
  { id: 441, name: "Public user for KSA - Engosoft", share: true },
  { id: 16701, name: "منصور خالد بن دعيلج", share: true },
];
const employees = [
  {
    id: 3121,
    name: "Ahmed Shaaban Ali Muhammad",
    user_id: [134, "Ahmed  El-Shiekh"],
    active: true,
  },
  { id: 4119, name: "Ahmed Ali Shaaban", user_id: [15835, "Ahmed Ali Shaaban"], active: true },
  {
    id: 4050,
    name: "Mohamad Abdullah Mohamad Hassan",
    user_id: [432, "Mr.Mohamad Abdullah Mohamad Mohsen"],
    active: true,
  },
  { id: 4400, name: "MOATAZ SABRY", user_id: [24091, "MOATAZ SABRY"], active: false },
  {
    id: 4401,
    name: "Mahmoud Mohamed Mahmoud Salem",
    user_id: [21642, "Mahmoud Mohamed Mahmoud"],
    active: true,
  },
  {
    id: 4402,
    name: "Mahmoud Mohamed Hassan Amer",
    user_id: [21643, "Mahmoud Mohamed Hassan"],
    active: true,
  },
  // No Odoo user: the PBX still reports calls under this name.
  { id: 4125, name: "Abdelrahim Kamal Hassan Sayed", user_id: false, active: true },
];
const directory = buildEmployeeDirectoryForTest(users, employees);

// The login name is a nickname; HR holds the legal name, and both resolve to it.
assert.equal(directory.displayNameFor("Ahmed  El-Shiekh"), "Ahmed Shaaban Ali");
assert.equal(directory.displayNameFor("Ahmed Shaaban Ali Muhammad"), "Ahmed Shaaban Ali");
assert.equal(
  directory.displayNameFor("Mr.Mohamad Abdullah Mohamad Mohsen"),
  "Mohamad Abdullah Mohamad",
);
assert.equal(directory.displayNameFor("Abdelrahim Kamal Hassan Sayed"), "Abdelrahim Kamal Hassan");

// Yeastar and Chatwoot name people in two parts; a unique containment resolves.
assert.equal(directory.displayNameFor("Mohamad Mohsen"), "Mohamad Abdullah Mohamad");

// A short name that agrees on the prefix beats one that merely contains the
// same words later, so `Ahmed Shaaban` is the man whose name starts that way
// and not `Ahmed Ali Shaaban`.
assert.equal(directory.displayNameFor("Ahmed Shaaban"), "Ahmed Shaaban Ali");

// Two colleagues genuinely share a prefix. Neither can be picked, so the PBX
// spelling stands rather than one man's calls landing on the other's row.
assert.equal(directory.displayNameFor("Mahmoud Mohamed"), "Mahmoud Mohamed");
assert.equal(directory.displayNameFor("Mahmoud Mohamed Hassan"), "Mahmoud Mohamed Hassan");

// Portal accounts are customers who self-registered on a lead. They are not
// staff and their names are left exactly as they are.
assert.equal(
  directory.displayNameFor("Public user for KSA - Engosoft"),
  "Public user for KSA - Engosoft",
);
assert.equal(directory.displayNameFor("منصور خالد بن دعيلج"), "منصور خالد بن دعيلج");

// Anyone Odoo has never heard of passes through untouched.
assert.equal(directory.displayNameFor("Sales Data"), "Sales Data");
assert.equal(directory.displayNameFor(""), "");

// Odoo's own short records are reported, not silently padded.
assert.deepEqual(directory.shortInOdoo, ["MOATAZ SABRY"]);

console.log("employee display name passed");
