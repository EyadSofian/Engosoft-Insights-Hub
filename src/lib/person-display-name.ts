/**
 * How a person's name is written on screen: three parts, always.
 *
 * The employee tab draws its people from four systems that disagree about how
 * long a name is. Odoo's login carries whatever the account was created with
 * (`Nader Aziz`, `Mr.Mohamad Abdullah Mohamad Mohsen`), Odoo HR carries the
 * legal name (up to seven parts), and Yeastar and Chatwoot carry two. A table
 * that mixes those reads as a ragged list rather than a roster, so every name
 * is cut to the same length: given name, father, grandfather.
 *
 * Cutting is done on *name parts*, not on words. `Abdul Rahman Tarik Abdul
 * Wahab` is three names written in five words; taking three words would leave
 * `Abdul Rahman Tarik`, which drops a whole name and keeps half of another.
 * The binder list below is what glues `abdul`, `el`, `bin` and their Arabic
 * spellings to the word they qualify.
 *
 * This module is pure and knows nothing about Odoo. Choosing *which* spelling
 * to cut — the login name or the HR legal name — belongs to
 * `employee-directory.server.ts`.
 */

/** Honorifics Odoo users type into the name field itself, e.g. `Mr.Nader …`. */
const TITLES = new Set([
  "mr",
  "mrs",
  "ms",
  "miss",
  "dr",
  "eng",
  "engineer",
  "prof",
  "مهندس",
  "الاستاذ",
  "الأستاذ",
  "الاستاذه",
  "الأستاذة",
  "دكتور",
]);

/**
 * Words that are the first half of a name rather than a name of their own.
 * A part ends at the first word that is not one of these.
 */
const BINDERS = new Set([
  "abd",
  "abdu",
  "abdul",
  "abdel",
  "abdal",
  "abed",
  "abo",
  "abou",
  "aboul",
  "abu",
  "abul",
  "al",
  "el",
  "ul",
  "bin",
  "ben",
  "bn",
  "ibn",
  "bint",
  "um",
  "umm",
  "ummu",
  "عبد",
  "ابو",
  "أبو",
  "ال",
  "بن",
  "ابن",
  "بنت",
  "ام",
  "أم",
]);

/** Lower-cased letters and digits only, so `Mr.` and `Al-Gamal` compare cleanly. */
const bare = (token: string): string =>
  token.toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Splits a written name into its parts, preserving the source spelling and
 * casing of each. `Mr.Bahaa Ramadan El Sayed Salem Lashin` becomes
 * `["Bahaa", "Ramadan", "El Sayed", "Salem", "Lashin"]`.
 */
export function splitNameParts(value: string): string[] {
  const words = String(value ?? "")
    .replace(/[.,،]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  // A title is only a title when something follows it. A person recorded as
  // just `Mr` has no name left once it is dropped.
  const named = words.filter(
    (word, index) => !(TITLES.has(bare(word)) && index < words.length - 1),
  );

  const parts: string[] = [];
  let pending: string[] = [];
  for (const word of named) {
    pending.push(word);
    if (BINDERS.has(bare(word))) continue;
    parts.push(pending.join(" "));
    pending = [];
  }
  // A trailing binder with nothing to bind to is still part of the name.
  if (pending.length) parts.push(pending.join(" "));
  return parts;
}

/**
 * The first three parts of a name. A name already shorter than three parts is
 * returned whole: Odoo is the only place that could supply the missing part,
 * and inventing one would be worse than a short row.
 */
export function threePartName(value: string): string {
  const parts = splitNameParts(value);
  if (!parts.length) return String(value ?? "").trim();
  return parts.slice(0, 3).join(" ");
}

/** How many real names a spelling carries — used to report Odoo's short records. */
export function namePartCount(value: string): number {
  return splitNameParts(value).length;
}
